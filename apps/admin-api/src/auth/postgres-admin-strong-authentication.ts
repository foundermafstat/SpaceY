import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { createUuidV7 } from "@spacey/db";
import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from "@simplewebauthn/server";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AdminApiConfig } from "../config.js";
import { ADMIN_API_CONFIG, ADMIN_DATABASE, type AdminDatabase } from "../persistence/admin-database.js";
import type { AdminPrincipal } from "../security/admin-security.js";
import {
  type AdminAuthenticationResult,
  type AdminStrongAuthenticationPort,
  type WebAuthnAssertion,
  type WebAuthnChallenge,
} from "./admin-auth.port.js";
import { hashAdminSessionToken, principalFromSessionRows } from "./postgres-admin-session-authenticator.js";
import { ADMIN_WEBAUTHN_SERVER, type AdminWebAuthnServer } from "./webauthn-server.js";

type AdminCredentialRow = Readonly<{
  admin_id: string;
  email: string;
  display_name: string;
  credential_db_id: string;
  credential_id: Buffer;
  public_key: Buffer;
  sign_count: string;
  transports: string[];
}>;

type AdminIdentityRow = Readonly<{
  admin_id: string;
  email: string;
  display_name: string;
}>;

type ChallengeRow = Readonly<{
  id: string;
  admin_user_id: string;
  challenge_hash: string;
  expires_at: Date;
}>;

const TRANSPORTS = new Set<AuthenticatorTransportFuture>([
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart-card",
  "usb",
]);

function challengeHash(challenge: string): string {
  return createHash("sha256").update(challenge, "utf8").digest("hex");
}

function challengeMatches(expectedHash: string, challenge: string): boolean {
  const expected = Buffer.from(expectedHash, "hex");
  const actual = Buffer.from(challengeHash(challenge), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function transports(values: readonly string[]): AuthenticatorTransportFuture[] {
  return values.filter((value): value is AuthenticatorTransportFuture => TRANSPORTS.has(value as AuthenticatorTransportFuture));
}

function authenticationResponse(value: Record<string, unknown>): AuthenticationResponseJSON {
  if (typeof value.id !== "string" || typeof value.rawId !== "string" || value.type !== "public-key") {
    throw new BadRequestException("Malformed WebAuthn authentication response");
  }
  return value as unknown as AuthenticationResponseJSON;
}

function registrationResponse(value: Record<string, unknown>): RegistrationResponseJSON {
  if (typeof value.id !== "string" || typeof value.rawId !== "string" || value.type !== "public-key") {
    throw new BadRequestException("Malformed WebAuthn registration response");
  }
  return value as unknown as RegistrationResponseJSON;
}

function pgErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

@Injectable()
export class PostgresAdminStrongAuthentication implements AdminStrongAuthenticationPort {
  constructor(
    @Inject(ADMIN_DATABASE) private readonly database: AdminDatabase,
    @Inject(ADMIN_API_CONFIG) private readonly config: AdminApiConfig,
    @Inject(ADMIN_WEBAUTHN_SERVER) private readonly webAuthn: AdminWebAuthnServer,
  ) {}

  async beginWebAuthnRegistration(adminId: string): Promise<WebAuthnChallenge> {
    const identityResult = await this.database.query<AdminIdentityRow>(
      `SELECT id AS admin_id, email, display_name
       FROM admin_users WHERE id = $1::uuid AND status = 'ACTIVE'`,
      [adminId],
    );
    const identity = identityResult.rows[0];
    if (!identity) throw new UnauthorizedException();

    const credentials = await this.credentialsForAdmin(adminId);
    const options = await this.webAuthn.generateRegistrationOptions({
      rpName: this.config.webAuthnRpName,
      rpID: this.config.webAuthnRpId,
      userID: new TextEncoder().encode(adminId),
      userName: identity.email,
      userDisplayName: identity.display_name,
      timeout: this.config.webAuthnChallengeTtlSeconds * 1_000,
      attestationType: "none",
      excludeCredentials: credentials.map((credential) => ({
        id: credential.credential_id.toString("base64url"),
        transports: transports(credential.transports),
      })),
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
      supportedAlgorithmIDs: [-7, -257],
    });
    return this.persistChallenge(adminId, "REGISTRATION", options.challenge, options);
  }

  async finishWebAuthnRegistration(adminId: string, assertion: WebAuthnAssertion): Promise<void> {
    const challenge = await this.activeChallenge(assertion.challengeId, "REGISTRATION", adminId);
    const response = registrationResponse(assertion.credential);

    let verification;
    try {
      verification = await this.webAuthn.verifyRegistrationResponse({
        response,
        expectedChallenge: (candidate) => challengeMatches(challenge.challenge_hash, candidate),
        expectedOrigin: this.config.webAuthnOrigin,
        expectedRPID: this.config.webAuthnRpId,
        requireUserVerification: true,
        supportedAlgorithmIDs: [-7, -257],
      });
    } catch {
      throw new UnauthorizedException("WebAuthn registration verification failed");
    }
    if (!verification.verified) throw new UnauthorizedException("WebAuthn registration verification failed");

    const info = verification.registrationInfo;
    try {
      await this.database.transaction(async (client) => {
        const consumed = await client.query(
          `UPDATE admin_webauthn_challenges SET consumed_at = now()
           WHERE id = $1::uuid AND admin_user_id = $2::uuid
             AND purpose = 'REGISTRATION' AND consumed_at IS NULL AND expires_at > now()`,
          [assertion.challengeId, adminId],
        );
        if (consumed.rowCount !== 1) throw new UnauthorizedException("WebAuthn challenge is expired or already used");

        await client.query(
          `INSERT INTO webauthn_credentials
             (id, admin_user_id, credential_id, public_key, sign_count, transports, aaguid,
              backup_eligible, backup_state)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5::bigint, $6::text[], $7, $8, $9)`,
          [
            createUuidV7(),
            adminId,
            Buffer.from(info.credential.id, "base64url"),
            Buffer.from(info.credential.publicKey),
            String(info.credential.counter),
            info.credential.transports ?? [],
            info.aaguid || null,
            info.credentialDeviceType === "multiDevice",
            info.credentialBackedUp,
          ],
        );
      });
    } catch (error) {
      if (pgErrorCode(error) === "23505") throw new ConflictException("WebAuthn credential is already registered");
      throw error;
    }
  }

  async beginWebAuthnAuthentication(loginHint?: string): Promise<WebAuthnChallenge> {
    if (!loginHint?.trim()) throw new BadRequestException("Admin login hint is required");
    const result = await this.database.query<AdminCredentialRow>(
      `SELECT
         u.id AS admin_id, u.email, u.display_name,
         c.id AS credential_db_id, c.credential_id, c.public_key,
         c.sign_count::text, c.transports
       FROM admin_users u
       JOIN webauthn_credentials c ON c.admin_user_id = u.id AND c.revoked_at IS NULL
       WHERE lower(u.email) = lower($1) AND u.status = 'ACTIVE'
       ORDER BY c.created_at, c.id`,
      [loginHint.trim()],
    );
    const first = result.rows[0];
    if (!first) throw new UnauthorizedException("WebAuthn authentication is unavailable");

    const options = await this.webAuthn.generateAuthenticationOptions({
      rpID: this.config.webAuthnRpId,
      timeout: this.config.webAuthnChallengeTtlSeconds * 1_000,
      userVerification: "required",
      allowCredentials: result.rows.map((credential) => ({
        id: credential.credential_id.toString("base64url"),
        transports: transports(credential.transports),
      })),
    });
    return this.persistChallenge(first.admin_id, "AUTHENTICATION", options.challenge, options);
  }

  async finishWebAuthnAuthentication(assertion: WebAuthnAssertion): Promise<AdminAuthenticationResult> {
    const challenge = await this.activeChallenge(assertion.challengeId, "AUTHENTICATION");
    const response = authenticationResponse(assertion.credential);
    const credentials = await this.credentialsForAdmin(challenge.admin_user_id);
    const credential = credentials.find((candidate) => candidate.credential_id.toString("base64url") === response.id);
    if (!credential) throw new UnauthorizedException("WebAuthn credential was not found");

    const webAuthnCredential: WebAuthnCredential = {
      id: response.id,
      publicKey: new Uint8Array(credential.public_key),
      counter: Number(credential.sign_count),
      transports: transports(credential.transports),
    };
    if (!Number.isSafeInteger(webAuthnCredential.counter)) throw new UnauthorizedException("Invalid WebAuthn counter");

    let verification;
    try {
      verification = await this.webAuthn.verifyAuthenticationResponse({
        response,
        expectedChallenge: (candidate) => challengeMatches(challenge.challenge_hash, candidate),
        expectedOrigin: this.config.webAuthnOrigin,
        expectedRPID: this.config.webAuthnRpId,
        credential: webAuthnCredential,
        requireUserVerification: true,
      });
    } catch {
      throw new UnauthorizedException("WebAuthn authentication verification failed");
    }
    if (!verification.verified) throw new UnauthorizedException("WebAuthn authentication verification failed");

    const sessionToken = randomBytes(32).toString("base64url");
    const sessionId = createUuidV7();
    const expiresAt = new Date(Date.now() + this.config.adminSessionTtlSeconds * 1_000);
    let principal: AdminPrincipal | null = null;
    await this.database.transaction(async (client) => {
      const consumed = await client.query(
        `UPDATE admin_webauthn_challenges SET consumed_at = now()
         WHERE id = $1::uuid AND admin_user_id = $2::uuid
           AND purpose = 'AUTHENTICATION' AND consumed_at IS NULL AND expires_at > now()`,
        [assertion.challengeId, challenge.admin_user_id],
      );
      if (consumed.rowCount !== 1) throw new UnauthorizedException("WebAuthn challenge is expired or already used");

      const counter = await client.query(
        `UPDATE webauthn_credentials
         SET sign_count = $2::bigint, backup_eligible = $3, backup_state = $4, last_used_at = now()
         WHERE id = $1::uuid AND sign_count = $5::bigint AND revoked_at IS NULL`,
        [
          credential.credential_db_id,
          String(verification.authenticationInfo.newCounter),
          verification.authenticationInfo.credentialDeviceType === "multiDevice",
          verification.authenticationInfo.credentialBackedUp,
          credential.sign_count,
        ],
      );
      if (counter.rowCount !== 1) throw new UnauthorizedException("WebAuthn credential changed during verification");

      await client.query(
        `INSERT INTO admin_sessions
           (id, admin_user_id, webauthn_credential_id, token_hash, authentication_method, expires_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'WEBAUTHN', $5::timestamptz)`,
        [sessionId, challenge.admin_user_id, credential.credential_db_id, hashAdminSessionToken(sessionToken), expiresAt],
      );
      await client.query("UPDATE admin_users SET last_login_at = now(), updated_at = now() WHERE id = $1::uuid", [
        challenge.admin_user_id,
      ]);
      const roles = await client.query<{ role_key: string | null; role_permissions: string[] | null }>(
        `SELECT r.key AS role_key, r.permissions AS role_permissions
         FROM admin_user_roles assignment
         JOIN admin_roles r ON r.id = assignment.admin_role_id
         WHERE assignment.admin_user_id = $1::uuid
         ORDER BY r.key`,
        [challenge.admin_user_id],
      );
      principal = principalFromSessionRows(roles.rows.map((role) => ({
        session_id: sessionId,
        admin_id: challenge.admin_user_id,
        authentication_method: "WEBAUTHN" as const,
        webauthn_credential_id: credential.credential_db_id,
        credential_revoked_at: null,
        role_key: role.role_key,
        role_permissions: role.role_permissions,
      })));
      if (!principal) throw new UnauthorizedException("Admin has no active RBAC role");
    });

    if (!principal) throw new ServiceUnavailableException("Admin principal could not be loaded after WebAuthn verification");
    return { principal, sessionToken, expiresAt: expiresAt.toISOString() };
  }

  async revokeSessionFamily(adminId: string, sessionId: string): Promise<void> {
    await this.database.query(
      "UPDATE admin_sessions SET revoked_at = now(), updated_at = now() WHERE id = $1::uuid AND admin_user_id = $2::uuid",
      [sessionId, adminId],
    );
  }

  async probe(): Promise<boolean> {
    await this.database.query(
      `SELECT challenge.id, credential.id, session.id
       FROM admin_webauthn_challenges challenge
       LEFT JOIN webauthn_credentials credential ON credential.admin_user_id = challenge.admin_user_id
       LEFT JOIN admin_sessions session ON session.admin_user_id = challenge.admin_user_id
       LIMIT 0`,
    );
    return true;
  }

  private async credentialsForAdmin(adminId: string): Promise<AdminCredentialRow[]> {
    const result = await this.database.query<AdminCredentialRow>(
      `SELECT
         u.id AS admin_id, u.email, u.display_name,
         c.id AS credential_db_id, c.credential_id, c.public_key,
         c.sign_count::text, c.transports
       FROM admin_users u
       JOIN webauthn_credentials c ON c.admin_user_id = u.id AND c.revoked_at IS NULL
       WHERE u.id = $1::uuid AND u.status = 'ACTIVE'
       ORDER BY c.created_at, c.id`,
      [adminId],
    );
    return result.rows;
  }

  private async activeChallenge(
    challengeId: string,
    purpose: "AUTHENTICATION" | "REGISTRATION",
    adminId?: string,
  ): Promise<ChallengeRow> {
    const result = await this.database.query<ChallengeRow>(
      `SELECT id, admin_user_id, challenge_hash, expires_at
       FROM admin_webauthn_challenges
       WHERE id = $1::uuid AND purpose = $2::admin_webauthn_challenge_purpose
         AND consumed_at IS NULL AND expires_at > now()
         AND ($3::uuid IS NULL OR admin_user_id = $3::uuid)`,
      [challengeId, purpose, adminId ?? null],
    );
    const challenge = result.rows[0];
    if (!challenge) throw new UnauthorizedException("WebAuthn challenge is expired or already used");
    return challenge;
  }

  private async persistChallenge(
    adminId: string,
    purpose: "AUTHENTICATION" | "REGISTRATION",
    challenge: string,
    publicKeyOptions: object,
  ): Promise<WebAuthnChallenge> {
    const challengeId = createUuidV7();
    const expiresAt = new Date(Date.now() + this.config.webAuthnChallengeTtlSeconds * 1_000);
    await this.database.query(
      `INSERT INTO admin_webauthn_challenges
         (id, admin_user_id, purpose, challenge_hash, expires_at)
       VALUES ($1::uuid, $2::uuid, $3::admin_webauthn_challenge_purpose, $4, $5::timestamptz)`,
      [challengeId, adminId, purpose, challengeHash(challenge), expiresAt],
    );
    return { challengeId, publicKeyOptions, expiresAt: expiresAt.toISOString() };
  }
}
