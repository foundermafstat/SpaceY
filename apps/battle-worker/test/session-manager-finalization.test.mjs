import assert from "node:assert/strict";
import test from "node:test";

import { BattleSessionManager } from "../src/session-manager.ts";

class TestConnection {
  messages = [];
  #closeHandler = async () => {};

  constructor(id) { this.id = id; }
  async send(message) { this.messages.push(message); }
  close() {}
  onMessage() { return () => {}; }
  onClose(handler) { this.#closeHandler = handler; return () => {}; }
  disconnect() { return this.#closeHandler(); }
}

function definition() {
  return {
    kind: "pve",
    userId: "user-1",
    simulationConfig: {
      sessionId: "session-1",
      attemptId: "attempt-1",
      missionId: "mission-1",
      mode: "pve",
      seed: 1,
      contentVersion: "content-1",
      simulationVersion: "2.0.0",
      shipBuildRevisionId: "build-1",
      durationSeconds: 1,
      objective: { type: "destroy_all", targetKills: 1 },
      arenaWidthUnits: 1_000,
      arenaHeightUnits: 1_000,
      enemyCount: 1,
      player: {
        hull: 100,
        speedUnitsPerSecond: 100,
        weaponDamage: 10,
        weaponRangeUnits: 100,
        weaponCooldownTicks: 10,
        projectileSpeedUnitsPerSecond: 200,
      },
      enemy: {
        hull: 10,
        speedUnitsPerSecond: 10,
        collisionRadiusUnits: 10,
        attackDamage: 1,
        attackRangeUnits: 20,
        attackCooldownTicks: 30,
      },
    },
  };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail("Timed out waiting for asynchronous PvE finalization.");
}

test("PvE commits result before S3 replay and retries attachment exactly once", async () => {
  let nowMs = 1_000;
  let replayAttempts = 0;
  let cleanupAttempts = 0;
  const finalizations = [];
  const replayAttachments = [];
  const checkpoints = new Map();
  const routes = new Set();
  const manager = new BattleSessionManager(
    {
      async load(sessionId) { return structuredClone(checkpoints.get(sessionId) ?? null); },
      async save(checkpoint) { checkpoints.set(checkpoint.sessionId, structuredClone(checkpoint)); },
      async delete(sessionId) { checkpoints.delete(sessionId); },
    },
    {
      async finalizeOnce(request) {
        finalizations.push(structuredClone(request));
        return { resultId: "result-1" };
      },
      async finalizeDuelOnce() { throw new Error("unexpected PvP finalization"); },
      async attachReplayOnce(request) { replayAttachments.push(structuredClone(request)); },
      async ping() {},
      async close() {},
    },
    { nowMs: () => nowMs },
    { info() {}, warn() {}, error() {} },
    {
      lifecycle: { async markConnected() {}, async markDisconnected() {} },
      definitions: {
        async load() { return definition(); },
        async save() {},
        async delete() {
          cleanupAttempts += 1;
          if (cleanupAttempts === 1) throw new Error("temporary cleanup outage");
        },
      },
      inputJournal: {
        async append() {},
        async readAfter() { return []; },
        async readAll() { return []; },
        async delete() {},
      },
      router: {
        async claim(sessionId) { if (routes.has(sessionId)) return false; routes.add(sessionId); return true; },
        async refresh(sessionId) { return routes.has(sessionId); },
        async release(sessionId) { routes.delete(sessionId); },
      },
      replayStorage: {
        async store(request) {
          replayAttempts += 1;
          if (replayAttempts === 1) throw new Error("temporary S3 outage");
          return {
            storageKey: "replays/pve/attempt-1.jsonl.gz",
            checksumSha256: "a".repeat(64),
            compression: "gzip",
            sizeBytes: 100,
            tickCount: request.outcome.finalTick,
            expiresAt: new Date(request.completedAtMs + 86_400_000).toISOString(),
          };
        },
        async ping() {},
      },
      routeLease: { workerId: "worker-1", endpoint: "ws://worker-1" },
      routeTtlSeconds: 30,
    },
  );

  await manager.createSession(definition());
  const connection = new TestConnection("connection-1");
  assert.equal(await manager.attachConnection({
    mode: "pve",
    sessionId: "session-1",
    attemptId: "attempt-1",
    userId: "user-1",
  }, connection), true);
  for (let tick = 0; tick < 30; tick += 1) await manager.advanceOneTick();
  await waitFor(() => finalizations.length === 1 && replayAttempts === 1);
  assert.equal(finalizations[0].replay, null);
  assert.equal(connection.messages.findLast((message) => message.type === "battle.ended").resultId, "result-1");
  assert.equal(replayAttachments.length, 0);

  nowMs = 2_000;
  await manager.advanceOneTick();
  await waitFor(() => replayAttachments.length === 1);
  assert.equal(finalizations.length, 1);
  assert.equal(replayAttempts, 2);
  assert.equal(replayAttachments[0].kind, "pve");

  await waitFor(() => cleanupAttempts === 1);
  assert.equal(manager.activeSessionCount, 1);
  nowMs = 4_000;
  await manager.advanceOneTick();
  await waitFor(() => manager.activeSessionCount === 0);
  assert.equal(cleanupAttempts, 2);
  assert.equal(finalizations.length, 1);
  assert.equal(replayAttempts, 2);
  assert.equal(replayAttachments.length, 1);
});
