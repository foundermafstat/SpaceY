import assert from "node:assert/strict";
import test from "node:test";
import { HttpException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import {
  AesGcmAdminSecretCipher,
  createAdminSecretCipher,
} from "../src/auth/admin-secret-cipher.js";
import {
  type AdminRateLimitRedisClient,
  ValkeyAdminAuthRateLimiter,
} from "../src/auth/admin-auth-rate-limiter.js";
import { PostgresAdminRecoveryAuthentication } from "../src/auth/postgres-admin-recovery-authentication.js";
import { generateTotpCode, hashRecoveryCode, verifyRecoveryCode } from "../src/auth/totp-recovery-crypto.js";
import type { AdminApiConfig } from "../src/config.js";
import type { AdminDatabase, AdminSqlClient } from "../src/persistence/admin-database.js";

const ADMIN_ID = "01900000-0000-7000-8000-000000000301";
const SECRET = Buffer.from("JBSWY3DPEHPK3PXP", "ascii");
const NOW_MS = 1_800_000_000_000;

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

function queryResult(rows: readonly unknown[] = [], rowCount = rows.length) {
  return { rows, rowCount } as never;
}

test("versioned AES-256-GCM keeps TOTP secret encrypted and authenticates context", () => {
  const v1 = Buffer.alloc(32, 1);
  const v2 = Buffer.alloc(32, 2);
  const oldCipher = new AesGcmAdminSecretCipher("v1", new Map([["v1", v1]]));
  const encrypted = oldCipher.encrypt(`spacey-admin-totp:${ADMIN_ID}`, SECRET);
  assert.equal(encrypted.ciphertext.includes(SECRET), false);

  const rotated = new AesGcmAdminSecretCipher("v2", new Map([["v1", v1], ["v2", v2]]));
  assert.deepEqual(rotated.decrypt(`spacey-admin-totp:${ADMIN_ID}`, encrypted.keyVersion, encrypted.ciphertext), SECRET);
  assert.throws(
    () => rotated.decrypt("spacey-admin-totp:another-admin", encrypted.keyVersion, encrypted.ciphertext),
    ServiceUnavailableException,
  );
  assert.throws(() => createAdminSecretCipher({ NODE_ENV: "production" }));
});

test("recovery codes use salted scrypt hashes", async () => {
  const encoded = await hashRecoveryCode("ABCD-EFGH-IJKL-MNOP");
  assert.equal(encoded.includes("ABCDEFGHIJKLMNOP"), false);
  assert.equal(await verifyRecoveryCode("ABCD EFGH IJKL MNOP", encoded), true);
  assert.equal(await verifyRecoveryCode("WRONG-CODE-0000", encoded), false);
});

type MutableRecoveryState = {
  id: string;
  totp_secret_encrypted: Buffer;
  totp_secret_key_version: string;
  totp_last_accepted_step: string | null;
  totp_failed_attempts: number;
  totp_locked_until: Date | null;
  recovery_code_hashes: string[];
  db_now_ms: string;
};

function recoveryHarness(recoveryHashes: string[] = []) {
  const cipher = new AesGcmAdminSecretCipher("v1", new Map([["v1", Buffer.alloc(32, 7)]]));
  const encrypted = cipher.encrypt(`spacey-admin-totp:${ADMIN_ID}`, SECRET);
  const state: MutableRecoveryState = {
    id: ADMIN_ID,
    totp_secret_encrypted: encrypted.ciphertext,
    totp_secret_key_version: encrypted.keyVersion,
    totp_last_accepted_step: null,
    totp_failed_attempts: 0,
    totp_locked_until: null,
    recovery_code_hashes: [...recoveryHashes],
    db_now_ms: String(NOW_MS),
  };
  let sessions = 0;
  let audits = 0;
  const client: AdminSqlClient = {
    query: async (sql, values) => {
      if (sql.includes("FROM admin_users WHERE id") && sql.includes("FOR UPDATE")) return queryResult([{ ...state }]);
      if (sql.includes("SET totp_last_accepted_step")) {
        state.totp_last_accepted_step = String(values?.[1]);
        state.totp_failed_attempts = 0;
        state.totp_locked_until = null;
      } else if (sql.includes("SET recovery_code_hashes")) {
        state.recovery_code_hashes = [...(values?.[1] as string[])];
        state.totp_failed_attempts = 0;
        state.totp_locked_until = null;
      } else if (sql.includes("SET totp_failed_attempts")) {
        state.totp_failed_attempts = Number(values?.[1]);
        state.totp_locked_until = values?.[2] as Date | null;
      } else if (sql.includes("FROM admin_user_roles")) {
        return queryResult([{ role_key: "SuperAdmin", role_permissions: [] }]);
      } else if (sql.includes("INSERT INTO admin_sessions")) {
        sessions += 1;
      } else if (sql.includes("INSERT INTO admin_audit_logs")) {
        audits += 1;
      }
      return queryResult([], 1);
    },
  };
  const database: AdminDatabase = {
    query: async (sql) => {
      if (sql.includes("WHERE lower(email)")) return queryResult([{ ...state }]);
      return queryResult();
    },
    transaction: async (operation) => operation(client),
    close: async () => undefined,
  };
  const adapter = new PostgresAdminRecoveryAuthentication(database, config, cipher);
  return { adapter, state, get sessions() { return sessions; }, get audits() { return audits; } };
}

test("TOTP recovery accepts one timestep once and commits opaque session plus immutable audit", async () => {
  const harness = recoveryHarness();
  const step = Math.floor(NOW_MS / 30_000);
  const code = generateTotpCode(SECRET, step);
  const result = await harness.adapter.verifyTotp({
    loginHint: "admin@spacey.test",
    credential: code,
    correlationId: "01900000-0000-7000-8000-000000000302",
  });
  assert.equal(result.principal.authenticationMethod, "totp-recovery");
  assert.equal(harness.state.totp_last_accepted_step, String(step));
  assert.equal(harness.sessions, 1);
  assert.equal(harness.audits, 1);

  await assert.rejects(
    harness.adapter.verifyTotp({
      loginHint: "admin@spacey.test",
      credential: code,
      correlationId: "01900000-0000-7000-8000-000000000303",
    }),
    UnauthorizedException,
  );
  assert.equal(harness.sessions, 1);
  assert.equal(harness.state.totp_failed_attempts, 1);
});

test("five failed recovery attempts create a shared database lockout", async () => {
  const harness = recoveryHarness();
  for (let attempt = 0; attempt < config.totpMaxAttempts; attempt += 1) {
    await assert.rejects(
      harness.adapter.verifyTotp({
        loginHint: "admin@spacey.test",
        credential: "000000",
        correlationId: `01900000-0000-7000-8000-0000000003${10 + attempt}`,
      }),
      UnauthorizedException,
    );
  }
  assert.equal(harness.state.totp_failed_attempts, config.totpMaxAttempts);
  assert.ok(harness.state.totp_locked_until);
  assert.equal(harness.sessions, 0);
});

test("hashed recovery code is removed atomically and cannot be replayed", async () => {
  const stored = await hashRecoveryCode("RECOVERY-CODE-0001");
  const harness = recoveryHarness([stored]);
  await harness.adapter.verifyRecoveryCode({
    loginHint: "admin@spacey.test",
    credential: "RECOVERY CODE 0001",
    correlationId: "01900000-0000-7000-8000-000000000320",
  });
  assert.deepEqual(harness.state.recovery_code_hashes, []);
  assert.equal(harness.sessions, 1);
  await assert.rejects(
    harness.adapter.verifyRecoveryCode({
      loginHint: "admin@spacey.test",
      credential: "RECOVERY-CODE-0001",
      correlationId: "01900000-0000-7000-8000-000000000321",
    }),
    UnauthorizedException,
  );
  assert.equal(harness.sessions, 1);
});

test("Valkey limiter hashes identifiers and blocks across instances after the shared limit", async () => {
  const counters = new Map<string, number>();
  const observedKeys: string[] = [];
  const redis: AdminRateLimitRedisClient = {
    status: "ready",
    connect: async () => undefined,
    eval: async (_script, _count, key, max) => {
      observedKeys.push(key);
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return [next > Number(max) ? 0 : 1, 60_000];
    },
    ping: async () => "PONG",
    disconnect: () => undefined,
  };
  const key = Buffer.alloc(32, 9);
  const first = new ValkeyAdminAuthRateLimiter(2, 60, key, "redis://unused", redis);
  const second = new ValkeyAdminAuthRateLimiter(2, 60, key, "redis://unused", redis);
  await first.consume("203.0.113.8", "admin@spacey.test");
  await second.consume("203.0.113.8", "admin@spacey.test");
  await assert.rejects(first.consume("203.0.113.8", "admin@spacey.test"), HttpException);
  assert.equal(observedKeys.some((value) => value.includes("203.0.113.8") || value.includes("admin@spacey.test")), false);
  assert.equal(await first.probe(), true);
});
