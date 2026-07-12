import assert from "node:assert/strict";
import test from "node:test";
import { ConflictException, UnprocessableEntityException } from "@nestjs/common";
import {
  hashAdminSessionToken,
  PostgresAdminSessionAuthenticator,
  principalFromSessionRows,
} from "../src/auth/postgres-admin-session-authenticator.js";
import { correlationIdForRequest } from "../src/mutations/admin-mutations.js";
import type { AdminDatabase, AdminSqlClient } from "../src/persistence/admin-database.js";
import {
  PostgresAdminMutationUnitOfWork,
  validateContentPayload,
} from "../src/persistence/postgres-admin-mutation-unit-of-work.js";
import { PostgresAdminReadinessProbe } from "../src/system.controller.js";

const ADMIN_ID = "01900000-0000-7000-8000-000000000101";
const SESSION_ID = "01900000-0000-7000-8000-000000000102";
const PLAYER_ID = "01900000-0000-7000-8000-000000000103";

function queryResult(rows: readonly unknown[] = [], rowCount = rows.length) {
  return { rows, rowCount } as never;
}

function fakeDatabase(overrides: Partial<AdminDatabase> = {}): AdminDatabase {
  return {
    query: async () => queryResult(),
    transaction: async (operation) => operation({ query: async () => queryResult() }),
    close: async () => undefined,
    ...overrides,
  };
}

test("DB-backed admin session requires an active WebAuthn credential and maps RBAC", async () => {
  const token = "a".repeat(48);
  let tokenHash = "";
  const database = fakeDatabase({
    query: async (_text, values) => {
      tokenHash = String(values?.[0]);
      return queryResult([
        {
          session_id: SESSION_ID,
          admin_id: ADMIN_ID,
          authentication_method: "WEBAUTHN",
          webauthn_credential_id: "01900000-0000-7000-8000-000000000105",
          credential_revoked_at: null,
          role_key: "ContentEditor",
          role_permissions: ["content:read", "content:write"],
        },
      ]);
    },
  });
  const authenticator = new PostgresAdminSessionAuthenticator(database);

  const principal = await authenticator.authenticate({ cookies: { "__Host-spacey_admin_session": token } } as never);
  assert.equal(tokenHash, hashAdminSessionToken(token));
  assert.equal(principal?.adminId, ADMIN_ID);
  assert.equal(principal?.role, "ContentEditor");
  assert.equal(principal?.authenticationMethod, "webauthn");

  assert.equal(principalFromSessionRows([{
    session_id: SESSION_ID,
    admin_id: ADMIN_ID,
    authentication_method: "WEBAUTHN",
    webauthn_credential_id: "01900000-0000-7000-8000-000000000105",
    credential_revoked_at: new Date(),
    role_key: "SuperAdmin",
    role_permissions: [],
  }]), null);
});

test("economy adjustment, ledger and audit execute inside one database transaction", async () => {
  const sql: string[] = [];
  const client: AdminSqlClient = {
    query: async (text) => {
      sql.push(text);
      if (text.includes("spacey_admin_adjust_wallet")) {
        return queryResult([{ before_balance: "100", after_balance: "125", wallet_version: "5", idempotent: false }]);
      }
      return queryResult([], 1);
    },
  };
  let transactionCount = 0;
  const database = fakeDatabase({
    transaction: async (operation) => {
      transactionCount += 1;
      return operation(client);
    },
  });
  const unitOfWork = new PostgresAdminMutationUnitOfWork(database);

  const result = await unitOfWork.transaction(async (transaction) => {
    const record = await transaction.applyEconomyAdjustment({
      playerId: PLAYER_ID,
      currency: "credits",
      amount: 25,
      idempotencyKey: "01900000-0000-7000-8000-000000000106",
      caseId: "SUP-42",
      reason: "Support compensation",
      actor: {
        adminId: ADMIN_ID,
        sessionId: SESSION_ID,
        role: "EconomyOperator",
        authenticationMethod: "webauthn",
      },
    });
    await transaction.appendAudit({
      action: "economy.wallet.adjusted",
      resourceType: "player-wallet",
      resourceId: PLAYER_ID,
      reason: "Support compensation",
      caseId: "SUP-42",
      correlationId: "01900000-0000-7000-8000-000000000107",
      before: record.before,
      after: record.after,
      actor: {
        adminId: ADMIN_ID,
        sessionId: SESSION_ID,
        role: "EconomyOperator",
        authenticationMethod: "webauthn",
      },
    });
    return record;
  });

  assert.equal(transactionCount, 1);
  assert.equal(result.revision, 5);
  assert.deepEqual(result.after, { currency: "CREDITS", balance: "125", version: 5 });
  assert.ok(sql.some((statement) => statement.includes("spacey_admin_adjust_wallet")));
  assert.equal(sql.some((statement) => statement.includes("UPDATE wallet_balances")), false);
  assert.ok(sql.some((statement) => statement.includes("INSERT INTO admin_audit_logs")));
});

test("content revision rejects stale optimistic revision before update", async () => {
  const sql: string[] = [];
  const client: AdminSqlClient = {
    query: async (text) => {
      sql.push(text);
      if (text.includes("COALESCE(max(revision)")) return queryResult([{ revision: 3 }]);
      return queryResult([], 1);
    },
  };
  const unitOfWork = new PostgresAdminMutationUnitOfWork(fakeDatabase({
    transaction: async (operation) => operation(client),
  }));

  await assert.rejects(
    unitOfWork.transaction((transaction) => transaction.applyContentRevision({
      resourceType: "mission",
      resourceId: "01900000-0000-7000-8000-000000000108",
      expectedRevision: 2,
      payload: { title: "Updated title" },
      reason: "Balance pass",
      actor: {
        adminId: ADMIN_ID,
        sessionId: SESSION_ID,
        role: "ContentEditor",
        authenticationMethod: "webauthn",
      },
    })),
    ConflictException,
  );
  assert.equal(sql.some((statement) => statement.startsWith("UPDATE mission_definitions")), false);
});

test("content revision rejects resources outside a draft release", async () => {
  const sql: string[] = [];
  const client: AdminSqlClient = {
    query: async (text) => {
      sql.push(text);
      if (text.includes("COALESCE(max(revision)")) return queryResult([{ revision: 0 }]);
      if (text.includes("JOIN content_releases")) {
        return queryResult([{ state: { id: "01900000-0000-7000-8000-000000000108" }, release_status: "PUBLISHED" }]);
      }
      return queryResult([], 1);
    },
  };
  const unitOfWork = new PostgresAdminMutationUnitOfWork(fakeDatabase({
    transaction: async (operation) => operation(client),
  }));

  await assert.rejects(
    unitOfWork.transaction((transaction) => transaction.applyContentRevision({
      resourceType: "mission",
      resourceId: "01900000-0000-7000-8000-000000000108",
      expectedRevision: 0,
      payload: { title: "Must clone first" },
      reason: "Attempted live edit",
      actor: {
        adminId: ADMIN_ID,
        sessionId: SESSION_ID,
        role: "ContentEditor",
        authenticationMethod: "webauthn",
      },
    })),
    (error: unknown) => error instanceof ConflictException
      && (error.getResponse() as { code?: string }).code === "CONTENT_RELEASE_IMMUTABLE",
  );
  assert.equal(sql.some((statement) => statement.startsWith("UPDATE mission_definitions")), false);
});

test("content semantic validation rejects unknown and malformed fields", () => {
  assert.throws(
    () => validateContentPayload({ resourceType: "enemy", payload: { clientReward: 999 } }),
    UnprocessableEntityException,
  );
  assert.throws(
    () => validateContentPayload({ resourceType: "mission", payload: { durationSeconds: 0 } }),
    UnprocessableEntityException,
  );
});

test("readiness is true only when persistence and WebAuthn/session probe succeed", async () => {
  const database = fakeDatabase({ query: async () => queryResult([{ persistence_ready: true }]) });
  const ready = new PostgresAdminReadinessProbe(
    database,
    { probe: async () => true } as never,
    { probe: async () => true } as never,
    { probe: async () => true } as never,
    { probe: async () => true } as never,
  );
  assert.deepEqual(await ready.check(), {
    ready: true,
    checks: { persistence: true, webauthn: true, session: true, totpRecovery: true, valkey: true },
  });

  const unavailable = new PostgresAdminReadinessProbe(
    fakeDatabase({ query: async () => { throw new Error("database unavailable"); } }),
    { probe: async () => true } as never,
    { probe: async () => true } as never,
    { probe: async () => true } as never,
    { probe: async () => true } as never,
  );
  assert.equal((await unavailable.check()).ready, false);
});

test("non-UUID Fastify request ids are replaced before immutable audit insert", () => {
  assert.match(correlationIdForRequest("req-1"), /^[0-9a-f-]{36}$/i);
  const correlationId = "01900000-0000-7000-8000-000000000109";
  assert.equal(correlationIdForRequest(correlationId), correlationId);
});
