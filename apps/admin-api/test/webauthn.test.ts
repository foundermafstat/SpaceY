import assert from "node:assert/strict";
import test from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { AdminAuthController } from "../src/auth/admin-auth.controller.js";
import { PostgresAdminStrongAuthentication } from "../src/auth/postgres-admin-strong-authentication.js";
import type { AdminWebAuthnServer } from "../src/auth/webauthn-server.js";
import type { AdminApiConfig } from "../src/config.js";
import type { AdminDatabase, AdminSqlClient } from "../src/persistence/admin-database.js";

const ADMIN_ID = "01900000-0000-7000-8000-000000000201";
const CREDENTIAL_DB_ID = "01900000-0000-7000-8000-000000000202";
const CHALLENGE_ID = "01900000-0000-7000-8000-000000000203";
const RAW_CHALLENGE = "challenge-value-from-server";
const CREDENTIAL_ID = Buffer.from("credential-one").toString("base64url");

const config: AdminApiConfig = {
  port: 3101,
  host: "127.0.0.1",
  allowedOrigins: ["https://admin.spacey.test"],
  databaseUrl: "postgresql://placeholder:placeholder@127.0.0.1:1/spacey",
  databasePoolMax: 2,
  webAuthnRpId: "spacey.test",
  webAuthnRpName: "SpaceY Admin",
  webAuthnOrigin: "https://admin.spacey.test",
  webAuthnChallengeTtlSeconds: 300,
  adminSessionTtlSeconds: 28_800,
  totpMaxAttempts: 5,
  totpLockoutSeconds: 900,
  totpWindow: 1,
  authRateLimitMax: 10,
  authRateLimitWindowSeconds: 300,
};

const principal = {
  adminId: ADMIN_ID,
  sessionId: "01900000-0000-7000-8000-000000000204",
  role: "SuperAdmin" as const,
  permissions: [] as const,
  authenticationMethod: "webauthn" as const,
};

function queryResult(rows: readonly unknown[] = [], rowCount = rows.length) {
  return { rows, rowCount } as never;
}

function challengeHash(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function authenticationCredential() {
  return {
    id: CREDENTIAL_ID,
    rawId: CREDENTIAL_ID,
    type: "public-key",
    response: { clientDataJSON: "client", authenticatorData: "auth", signature: "signature" },
    clientExtensionResults: {},
  };
}

test("begin authentication persists a hashed, expiring challenge with required UV", async () => {
  let persistedValues: readonly unknown[] = [];
  let generatedOptions: Record<string, unknown> | undefined;
  const database: AdminDatabase = {
    query: async (sql, values) => {
      if (sql.includes("JOIN webauthn_credentials")) {
        return queryResult([{
          admin_id: ADMIN_ID,
          email: "admin@spacey.test",
          display_name: "SpaceY Admin",
          credential_db_id: CREDENTIAL_DB_ID,
          credential_id: Buffer.from(CREDENTIAL_ID, "base64url"),
          public_key: Buffer.from("public-key"),
          sign_count: "7",
          transports: ["internal"],
        }]);
      }
      if (sql.includes("INSERT INTO admin_webauthn_challenges")) persistedValues = values ?? [];
      return queryResult([], 1);
    },
    transaction: async (operation) => operation({ query: async () => queryResult() }),
    close: async () => undefined,
  };
  const webAuthn: AdminWebAuthnServer = {
    generateAuthenticationOptions: async (options) => {
      generatedOptions = options as unknown as Record<string, unknown>;
      return { challenge: RAW_CHALLENGE, rpId: config.webAuthnRpId, timeout: 300_000 } as never;
    },
    generateRegistrationOptions: async () => ({} as never),
    verifyAuthenticationResponse: async () => ({} as never),
    verifyRegistrationResponse: async () => ({} as never),
  };
  const adapter = new PostgresAdminStrongAuthentication(
    database,
    config,
    webAuthn,
  );

  const result = await adapter.beginWebAuthnAuthentication("admin@spacey.test");
  assert.equal(generatedOptions?.rpID, config.webAuthnRpId);
  assert.equal(generatedOptions?.userVerification, "required");
  assert.equal(persistedValues[2], "AUTHENTICATION");
  assert.equal(persistedValues[3], challengeHash(RAW_CHALLENGE));
  assert.notEqual(persistedValues[3], RAW_CHALLENGE);
  assert.equal((result.publicKeyOptions as { challenge: string }).challenge, RAW_CHALLENGE);
  assert.equal(new Date(result.expiresAt).getTime() > Date.now(), true);
});

function finishHarness(challengeConsumeCount = 1) {
  const transactionSql: string[] = [];
  let sessionInsertValues: readonly unknown[] = [];
  let counterUpdateValues: readonly unknown[] = [];
  const database: AdminDatabase = {
    query: async (sql) => {
      if (sql.includes("FROM admin_webauthn_challenges")) {
        return queryResult([{
          id: CHALLENGE_ID,
          admin_user_id: ADMIN_ID,
          challenge_hash: challengeHash(RAW_CHALLENGE),
          expires_at: new Date(Date.now() + 60_000),
        }]);
      }
      if (sql.includes("JOIN webauthn_credentials")) {
        return queryResult([{
          admin_id: ADMIN_ID,
          email: "admin@spacey.test",
          display_name: "SpaceY Admin",
          credential_db_id: CREDENTIAL_DB_ID,
          credential_id: Buffer.from(CREDENTIAL_ID, "base64url"),
          public_key: Buffer.from("public-key"),
          sign_count: "7",
          transports: ["internal"],
        }]);
      }
      return queryResult();
    },
    transaction: async (operation) => {
      const client: AdminSqlClient = {
        query: async (sql, values) => {
          transactionSql.push(sql);
          if (sql.includes("UPDATE admin_webauthn_challenges")) return queryResult([], challengeConsumeCount);
          if (sql.includes("UPDATE webauthn_credentials")) {
            counterUpdateValues = values ?? [];
            return queryResult([], 1);
          }
          if (sql.includes("INSERT INTO admin_sessions")) {
            sessionInsertValues = values ?? [];
            return queryResult([], 1);
          }
          if (sql.includes("FROM admin_user_roles")) {
            return queryResult([{ role_key: "SuperAdmin", role_permissions: [] }]);
          }
          return queryResult([], 1);
        },
      };
      return operation(client);
    },
    close: async () => undefined,
  };
  let verifyOptions: Parameters<AdminWebAuthnServer["verifyAuthenticationResponse"]>[0] | undefined;
  const webAuthn: AdminWebAuthnServer = {
    generateAuthenticationOptions: async () => ({} as never),
    generateRegistrationOptions: async () => ({} as never),
    verifyAuthenticationResponse: async (options) => {
      verifyOptions = options;
      const expected = options.expectedChallenge;
      assert.equal(typeof expected, "function");
      assert.equal(await (expected as (candidate: string) => boolean | Promise<boolean>)(RAW_CHALLENGE), true);
      assert.equal(await (expected as (candidate: string) => boolean | Promise<boolean>)("replayed-challenge"), false);
      return {
        verified: true,
        authenticationInfo: {
          credentialID: CREDENTIAL_ID,
          newCounter: 9,
          userVerified: true,
          credentialDeviceType: "singleDevice",
          credentialBackedUp: false,
          origin: config.webAuthnOrigin,
          rpID: config.webAuthnRpId,
        },
      };
    },
    verifyRegistrationResponse: async () => ({} as never),
  };
  const adapter = new PostgresAdminStrongAuthentication(
    database,
    config,
    webAuthn,
  );
  return {
    adapter,
    transactionSql,
    get sessionInsertValues() { return sessionInsertValues; },
    get counterUpdateValues() { return counterUpdateValues; },
    get verifyOptions() { return verifyOptions; },
  };
}

test("finish authentication verifies RP/origin, CAS-updates signCount and issues only a hashed opaque session", async () => {
  const harness = finishHarness();
  const result = await harness.adapter.finishWebAuthnAuthentication({
    challengeId: CHALLENGE_ID,
    credential: authenticationCredential(),
  });

  assert.equal(harness.verifyOptions?.expectedOrigin, config.webAuthnOrigin);
  assert.equal(harness.verifyOptions?.expectedRPID, config.webAuthnRpId);
  assert.equal(harness.verifyOptions?.requireUserVerification, true);
  assert.equal(harness.counterUpdateValues[1], "9");
  assert.equal(harness.counterUpdateValues[4], "7");
  assert.equal(harness.sessionInsertValues[3], challengeHash(result.sessionToken));
  assert.notEqual(harness.sessionInsertValues[3], result.sessionToken);
  assert.equal(result.principal.adminId, ADMIN_ID);
  assert.ok(harness.transactionSql.some((sql) => sql.includes("consumed_at IS NULL")));
});

test("authentication challenge is single-use even after a valid signature", async () => {
  const harness = finishHarness(0);
  await assert.rejects(
    harness.adapter.finishWebAuthnAuthentication({
      challengeId: CHALLENGE_ID,
      credential: authenticationCredential(),
    }),
    UnauthorizedException,
  );
  assert.equal(harness.transactionSql.some((sql) => sql.includes("INSERT INTO admin_sessions")), false);
});

test("authentication endpoint sets host-only secure session and double-submit CSRF cookies", async () => {
  const cookies: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
  const controller = new AdminAuthController({
    finishWebAuthnAuthentication: async () => ({
      principal,
      sessionToken: "opaque-session-token",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }),
  } as never, { consume: async () => undefined } as never);
  const reply = {
    setCookie(name: string, value: string, options: Record<string, unknown>) {
      cookies.push({ name, value, options });
      return this;
    },
  };

  const response = await controller.finishAuthentication(
    { challengeId: CHALLENGE_ID, credential: authenticationCredential() },
    { ip: "127.0.0.1" } as never,
    reply as never,
  );
  const session = cookies.find((cookie) => cookie.name === "__Host-spacey_admin_session");
  const csrf = cookies.find((cookie) => cookie.name === "__Host-spacey_admin_csrf");
  assert.equal(session?.options.httpOnly, true);
  assert.equal(session?.options.secure, true);
  assert.equal(session?.options.path, "/");
  assert.equal(csrf?.options.httpOnly, false);
  assert.equal(typeof response.csrfToken, "string");
  assert.equal("sessionToken" in response, false);
});
