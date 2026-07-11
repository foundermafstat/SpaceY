import { Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { createUuidV7 } from "@spacey/db";
import { createHash, randomBytes } from "node:crypto";
import type { AdminApiConfig } from "../config.js";
import { ADMIN_API_CONFIG, ADMIN_DATABASE, type AdminDatabase, type AdminSqlClient } from "../persistence/admin-database.js";
import type { AdminPrincipal } from "../security/admin-security.js";
import {
  type AdminAuthenticationResult,
  type AdminRecoveryAuthenticationCommand,
  type AdminRecoveryAuthenticationPort,
} from "./admin-auth.port.js";
import { ADMIN_SECRET_CIPHER, type AdminSecretCipher } from "./admin-secret-cipher.js";
import { hashAdminSessionToken, principalFromSessionRows } from "./postgres-admin-session-authenticator.js";
import { verifyRecoveryCode, verifyTotpCode } from "./totp-recovery-crypto.js";

type RecoveryAdminRow = Readonly<{
  id: string;
  totp_secret_encrypted: Buffer | null;
  totp_secret_key_version: string | null;
  totp_last_accepted_step: string | null;
  totp_failed_attempts: number;
  totp_locked_until: Date | null;
  recovery_code_hashes: string[];
  db_now_ms: string;
}>;

type RecoveryMode = Readonly<{
  action: "admin.authentication.totp_recovery" | "admin.authentication.recovery_code";
  acceptedStep?: number;
  matchedRecoveryHash?: string;
  expectedCiphertext?: Buffer;
  expectedKeyVersion?: string;
}>;

@Injectable()
export class PostgresAdminRecoveryAuthentication implements AdminRecoveryAuthenticationPort {
  constructor(
    @Inject(ADMIN_DATABASE) private readonly database: AdminDatabase,
    @Inject(ADMIN_API_CONFIG) private readonly config: AdminApiConfig,
    @Inject(ADMIN_SECRET_CIPHER) private readonly cipher: AdminSecretCipher,
  ) {}

  async verifyTotp(command: AdminRecoveryAuthenticationCommand): Promise<AdminAuthenticationResult> {
    const admin = await this.findAdmin(command.loginHint);
    if (!admin || this.isLocked(admin) || !admin.totp_secret_encrypted || !admin.totp_secret_key_version) {
      throw new UnauthorizedException("Recovery authentication failed");
    }

    const plaintext = this.cipher.decrypt(
      `spacey-admin-totp:${admin.id}`,
      admin.totp_secret_key_version,
      admin.totp_secret_encrypted,
    );
    let acceptedStep: number | null;
    try {
      acceptedStep = verifyTotpCode(plaintext, command.credential, Number(admin.db_now_ms), this.config.totpWindow);
    } finally {
      plaintext.fill(0);
    }
    if (acceptedStep === null) {
      await this.recordFailure(admin.id);
      throw new UnauthorizedException("Recovery authentication failed");
    }

    const result = await this.completeRecovery(command, admin.id, {
      action: "admin.authentication.totp_recovery",
      acceptedStep,
      expectedCiphertext: admin.totp_secret_encrypted,
      expectedKeyVersion: admin.totp_secret_key_version,
    });
    if (!result) throw new UnauthorizedException("Recovery authentication failed");
    return result;
  }

  async verifyRecoveryCode(command: AdminRecoveryAuthenticationCommand): Promise<AdminAuthenticationResult> {
    const admin = await this.findAdmin(command.loginHint);
    if (!admin || this.isLocked(admin)) throw new UnauthorizedException("Recovery authentication failed");

    let matched: string | undefined;
    for (const hash of admin.recovery_code_hashes) {
      if (await verifyRecoveryCode(command.credential, hash)) {
        matched = hash;
        break;
      }
    }
    if (!matched) {
      await this.recordFailure(admin.id);
      throw new UnauthorizedException("Recovery authentication failed");
    }

    const result = await this.completeRecovery(command, admin.id, {
      action: "admin.authentication.recovery_code",
      matchedRecoveryHash: matched,
    });
    if (!result) throw new UnauthorizedException("Recovery authentication failed");
    return result;
  }

  async probe(): Promise<boolean> {
    if (!this.cipher.ready()) return false;
    await this.database.query(
      `SELECT totp_secret_encrypted, totp_secret_key_version, totp_last_accepted_step,
              totp_failed_attempts, totp_locked_until, recovery_code_hashes
       FROM admin_users LIMIT 0`,
    );
    return true;
  }

  private async findAdmin(loginHint: string): Promise<RecoveryAdminRow | null> {
    const result = await this.database.query<RecoveryAdminRow>(
      `SELECT id, totp_secret_encrypted, totp_secret_key_version,
              totp_last_accepted_step::text, totp_failed_attempts, totp_locked_until,
              recovery_code_hashes,
              floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text AS db_now_ms
       FROM admin_users
       WHERE lower(email) = lower($1) AND status = 'ACTIVE'`,
      [loginHint.trim()],
    );
    return result.rows[0] ?? null;
  }

  private isLocked(admin: RecoveryAdminRow): boolean {
    return Boolean(admin.totp_locked_until && admin.totp_locked_until.getTime() > Number(admin.db_now_ms));
  }

  private async recordFailure(adminId: string): Promise<void> {
    await this.database.transaction(async (client) => {
      const result = await this.lockAdmin(client, adminId);
      const admin = result.rows[0];
      if (admin) await this.incrementFailure(client, admin);
    });
  }

  private async completeRecovery(
    command: AdminRecoveryAuthenticationCommand,
    adminId: string,
    mode: RecoveryMode,
  ): Promise<AdminAuthenticationResult | null> {
    return this.database.transaction(async (client) => {
      const locked = await this.lockAdmin(client, adminId);
      const admin = locked.rows[0];
      if (!admin || this.isLocked(admin)) return null;

      if (mode.acceptedStep !== undefined) {
        const sameSecret = admin.totp_secret_encrypted
          && mode.expectedCiphertext
          && admin.totp_secret_encrypted.equals(mode.expectedCiphertext)
          && admin.totp_secret_key_version === mode.expectedKeyVersion;
        const lastStep = admin.totp_last_accepted_step === null ? -1n : BigInt(admin.totp_last_accepted_step);
        if (!sameSecret || BigInt(mode.acceptedStep) <= lastStep) {
          await this.incrementFailure(client, admin);
          return null;
        }
        await client.query(
          `UPDATE admin_users
           SET totp_last_accepted_step = $2::bigint, totp_failed_attempts = 0,
               totp_locked_until = NULL, last_login_at = now(), updated_at = now()
           WHERE id = $1::uuid`,
          [adminId, String(mode.acceptedStep)],
        );
      } else if (mode.matchedRecoveryHash) {
        const index = admin.recovery_code_hashes.indexOf(mode.matchedRecoveryHash);
        if (index < 0) {
          await this.incrementFailure(client, admin);
          return null;
        }
        const remaining = admin.recovery_code_hashes.filter((_, candidate) => candidate !== index);
        await client.query(
          `UPDATE admin_users
           SET recovery_code_hashes = $2::text[], totp_failed_attempts = 0,
               totp_locked_until = NULL, last_login_at = now(), updated_at = now()
           WHERE id = $1::uuid`,
          [adminId, remaining],
        );
      } else {
        throw new ServiceUnavailableException("Recovery authentication mode is invalid");
      }

      const sessionId = createUuidV7();
      const sessionToken = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + this.config.adminSessionTtlSeconds * 1_000);
      const principal = await this.principal(client, adminId, sessionId);
      if (!principal) throw new UnauthorizedException("Admin has no active RBAC role");

      await client.query(
        `INSERT INTO admin_sessions
           (id, admin_user_id, webauthn_credential_id, token_hash, authentication_method, expires_at)
         VALUES ($1::uuid, $2::uuid, NULL, $3, 'TOTP_RECOVERY', $4::timestamptz)`,
        [sessionId, adminId, hashAdminSessionToken(sessionToken), expiresAt],
      );

      const auditIdempotencyKey = createHash("sha256")
        .update(`${command.correlationId}:${mode.action}:${adminId}`, "utf8")
        .digest("hex");
      await client.query(
        `INSERT INTO admin_audit_logs
           (id, admin_user_id, admin_session_id, authentication_method, actor_role,
            action, resource_type, resource_id, before_state, after_state, reason,
            correlation_id, idempotency_key)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'TOTP_RECOVERY', $4, $5,
                 'admin-session', $3, $6::jsonb, $7::jsonb,
                 'Recovery-only administrator authentication', $8::uuid, $9)`,
        [
          createUuidV7(),
          adminId,
          sessionId,
          principal.role,
          mode.action,
          JSON.stringify({
            failedAttempts: admin.totp_failed_attempts,
            lockedUntil: admin.totp_locked_until?.toISOString() ?? null,
            lastAcceptedStep: admin.totp_last_accepted_step,
            remainingRecoveryCodes: admin.recovery_code_hashes.length,
          }),
          JSON.stringify({
            sessionId,
            authenticationMethod: "totp-recovery",
            remainingRecoveryCodes: mode.matchedRecoveryHash
              ? admin.recovery_code_hashes.length - 1
              : admin.recovery_code_hashes.length,
          }),
          command.correlationId,
          auditIdempotencyKey,
        ],
      );
      return { principal, sessionToken, expiresAt: expiresAt.toISOString() };
    });
  }

  private lockAdmin(client: AdminSqlClient, adminId: string) {
    return client.query<RecoveryAdminRow>(
      `SELECT id, totp_secret_encrypted, totp_secret_key_version,
              totp_last_accepted_step::text, totp_failed_attempts, totp_locked_until,
              recovery_code_hashes,
              floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text AS db_now_ms
       FROM admin_users WHERE id = $1::uuid AND status = 'ACTIVE' FOR UPDATE`,
      [adminId],
    );
  }

  private async incrementFailure(client: AdminSqlClient, admin: RecoveryAdminRow): Promise<void> {
    const now = Number(admin.db_now_ms);
    if (admin.totp_locked_until && admin.totp_locked_until.getTime() > now) return;
    const attempts = (admin.totp_locked_until ? 0 : admin.totp_failed_attempts) + 1;
    const lockedUntil = attempts >= this.config.totpMaxAttempts
      ? new Date(now + this.config.totpLockoutSeconds * 1_000)
      : null;
    await client.query(
      `UPDATE admin_users
       SET totp_failed_attempts = $2, totp_locked_until = $3::timestamptz, updated_at = now()
       WHERE id = $1::uuid`,
      [admin.id, attempts, lockedUntil],
    );
  }

  private async principal(client: AdminSqlClient, adminId: string, sessionId: string): Promise<AdminPrincipal | null> {
    const roles = await client.query<{ role_key: string | null; role_permissions: string[] | null }>(
      `SELECT r.key AS role_key, r.permissions AS role_permissions
       FROM admin_user_roles assignment
       JOIN admin_roles r ON r.id = assignment.admin_role_id
       WHERE assignment.admin_user_id = $1::uuid ORDER BY r.key`,
      [adminId],
    );
    return principalFromSessionRows(roles.rows.map((role) => ({
      session_id: sessionId,
      admin_id: adminId,
      authentication_method: "TOTP_RECOVERY" as const,
      webauthn_credential_id: null,
      credential_revoked_at: null,
      role_key: role.role_key,
      role_permissions: role.role_permissions,
    })));
  }
}
