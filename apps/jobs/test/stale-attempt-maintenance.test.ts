import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { DomainEventJob } from "../src/domain.js";
import { loadJobsConfig } from "../src/config.js";
import {
  PostgresStaleAttemptMaintenance,
  StaleAttemptCleanupHandler,
  STALE_ATTEMPT_EVENT_TYPE,
  type StaleAttemptRouteCleanup,
  type StaleAttemptRouteStore,
} from "../src/stale-attempt-maintenance.js";

const attemptId = "01900000-0000-7000-8000-000000000001";
const sessionId = "01900000-0000-7000-8000-000000000002";
const userId = "01900000-0000-7000-8000-000000000003";
const ticketHash = "a".repeat(64);

test("stale attempt sweep cadence and batch stay bounded", () => {
  const config = loadJobsConfig({
    DATABASE_URL: "postgresql://local",
    VALKEY_URL: "redis://localhost:6379",
    NODE_ENV: "test",
  });
  assert.equal(config.staleAttemptSweepIntervalMs, 5_000);
  assert.equal(config.staleAttemptSweepBatchSize, 100);
  assert.throws(() => loadJobsConfig({
    DATABASE_URL: "postgresql://local",
    VALKEY_URL: "redis://localhost:6379",
    NODE_ENV: "test",
    STALE_ATTEMPT_SWEEP_INTERVAL_MS: "999",
  }), /STALE_ATTEMPT_SWEEP_INTERVAL_MS is invalid/);
  assert.throws(() => loadJobsConfig({
    DATABASE_URL: "postgresql://local",
    VALKEY_URL: "redis://localhost:6379",
    NODE_ENV: "test",
    STALE_ATTEMPT_SWEEP_BATCH_SIZE: "1001",
  }), /STALE_ATTEMPT_SWEEP_BATCH_SIZE is invalid/);
});

test("stale CONNECTING sweep is transactional and emits one durable cleanup event", async () => {
  const statements: Array<{ sql: string; parameters?: unknown[] }> = [];
  const client = {
    query: async (sql: string, parameters?: unknown[]) => {
      statements.push({ sql, parameters });
      if (sql.includes("spacey_jobs_abandon_stale_connecting_attempts")) {
        return { rows: [{ attemptId, sessionId, userId, ticketHash }] };
      }
      return { rows: [], rowCount: 1 };
    },
    release: () => undefined,
  };
  const maintenance = new PostgresStaleAttemptMaintenance({
    connect: async () => client,
    query: async () => ({ rows: [{ ready: true }] }),
  } as never, 100);

  assert.equal(await maintenance.runOnce(), 1);
  assert.equal(statements[0]?.sql, "BEGIN");
  assert.match(statements[1]?.sql ?? "", /spacey_jobs_abandon_stale_connecting_attempts/);
  assert.match(statements[2]?.sql ?? "", /INSERT INTO outbox_events/);
  assert.equal(statements[2]?.parameters?.[2], STALE_ATTEMPT_EVENT_TYPE);
  assert.deepEqual(JSON.parse(String(statements[2]?.parameters?.[3])), { attemptId, sessionId, userId, ticketHash });
  assert.equal(statements.at(-1)?.sql, "COMMIT");
});

test("cleanup event is idempotently delegated with validated identifiers", async () => {
  const cleaned: StaleAttemptRouteCleanup[] = [];
  const store: StaleAttemptRouteStore = { cleanup: async (input) => { cleaned.push(input); } };
  const handler = new StaleAttemptCleanupHandler(store);
  const job: DomainEventJob = {
    outboxEventId: "01900000-0000-7000-8000-000000000004",
    idempotencyKey: `mission-attempt:${attemptId}:stale-abandoned`,
    eventType: STALE_ATTEMPT_EVENT_TYPE,
    aggregateType: "mission_attempt",
    aggregateId: attemptId,
    payload: { attemptId, sessionId, userId, ticketHash },
    occurredAt: "2026-07-12T00:00:00.000Z",
  };

  assert.deepEqual(await handler.handle(job), { cleaned: true });
  assert.deepEqual(cleaned, [{ attemptId, sessionId, userId, ticketHash }]);
  await assert.rejects(() => handler.handle({ ...job, payload: { ...job.payload as object, ticketHash: "bad" } }), /payload is invalid/);
});

test("migration locks a bounded PVE batch without waiting and leaves PvP to its no-show policy", async () => {
  const migration = await readFile(new URL(
    "../../../packages/db/prisma/migrations/20260711290000_stale_connecting_attempt_sweeper/migration.sql",
    import.meta.url,
  ), "utf8");
  assert.match(migration, /FOR UPDATE OF attempt SKIP LOCKED/);
  assert.match(migration, /attempt\.type = 'PVE'/);
  assert.match(migration, /INTERVAL '60 seconds'/);
  assert.match(migration, /status = 'ABANDONED'/);
  assert.match(migration, /ws_ticket_hash = NULL/);
});
