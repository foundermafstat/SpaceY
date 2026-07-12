import assert from "node:assert/strict";
import test from "node:test";

import { PendingPvpSessionBroker } from "../src/pending-pvp-session-broker.ts";

function definition(overrides = {}) {
  return {
    kind: "pvp",
    participants: [],
    simulationConfig: { sessionId: "session-1", matchId: "match-1" },
    readyDeadlineAtMs: 20_000,
    ...overrides,
  };
}

function harness({ queued = ["session-1"], storedDefinition = definition(), sourceSessions = [] } = {}) {
  let nowMs = 10_000;
  const released = [];
  const completed = [];
  const ensured = [];
  const errors = [];
  const broker = new PendingPvpSessionBroker(
    {
      async claimBatch(workerId, claimedAtMs, limit, leaseMs) {
        assert.equal(workerId, "worker-1");
        assert.equal(claimedAtMs, nowMs);
        assert.equal(limit, 8);
        assert.equal(leaseMs, 5_000);
        return queued;
      },
      async release(sessionId, workerId, availableAtMs) { released.push({ sessionId, workerId, availableAtMs }); },
      async complete(sessionId, workerId) { completed.push({ sessionId, workerId }); },
    },
    { async load() { return storedDefinition; }, async save() {}, async delete() {} },
    {
      async listPendingPvpSessions() {
        return { sessions: sourceSessions, nextCursor: null };
      },
    },
    { async ensureSession(request) { ensured.push(request); return true; } },
    { nowMs: () => nowMs },
    { info() {}, warn() {}, error(message, context) { errors.push({ message, context }); } },
    {
      workerId: "worker-1",
      pollIntervalMs: 250,
      claimLeaseMs: 5_000,
      retryDelayMs: 1_000,
      activeRecheckMs: 4_000,
      reconciliationIntervalMs: 2_000,
      batchSize: 8,
    },
  );
  return { broker, completed, ensured, errors, released, setNow(value) { nowMs = value; } };
}

test("durable pending claim materializes a PvP session without a WebSocket attach and remains recoverable", async () => {
  const state = harness();
  await state.broker.pollOnce();
  assert.equal(state.ensured.length, 1);
  assert.equal(state.ensured[0].simulationConfig.sessionId, "session-1");
  assert.deepEqual(state.released, [{ sessionId: "session-1", workerId: "worker-1", availableAtMs: 14_000 }]);
  assert.deepEqual(state.completed, []);
  assert.deepEqual(state.errors, []);
});

test("PostgreSQL reconciliation restores a finalized replay-pending session after worker crash", async () => {
  const replayPending = definition({ databaseFinalized: true });
  const state = harness({ queued: [], sourceSessions: [replayPending] });
  await state.broker.pollOnce();
  assert.equal(state.ensured.length, 1);
  assert.equal(state.ensured[0].databaseFinalized, true);
  assert.deepEqual(state.errors, []);
});

test("a queue entry is removed only after its immutable definition was cleaned up", async () => {
  const state = harness({ storedDefinition: null });
  await state.broker.pollOnce();
  assert.deepEqual(state.ensured, []);
  assert.deepEqual(state.completed, [{ sessionId: "session-1", workerId: "worker-1" }]);
  assert.deepEqual(state.released, []);
});
