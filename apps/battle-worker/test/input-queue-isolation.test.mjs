import assert from "node:assert/strict";
import test from "node:test";

import { BattleSessionManager } from "../src/session-manager.ts";
import { BoundedOrderedQueue } from "../src/bounded-ordered-queue.ts";

class TestConnection {
  messages = [];
  #handler = async () => {};
  #closeHandler = async () => {};
  constructor(id) { this.id = id; }
  send(message) { this.messages.push(message); }
  close() {}
  onMessage(handler) { this.#handler = handler; return () => {}; }
  onClose(handler) { this.#closeHandler = handler; return () => {}; }
  receive(message) { return this.#handler(message); }
  disconnect() { return this.#closeHandler(); }
}

function definition(id) {
  return {
    kind: "pve",
    userId: `user-${id}`,
    simulationConfig: {
      sessionId: `session-${id}`,
      attemptId: `attempt-${id}`,
      missionId: "mission-isolation",
      mode: "pve",
      seed: 10,
      contentVersion: "content-1",
      simulationVersion: "2.0.0",
      shipBuildRevisionId: `build-${id}`,
      durationSeconds: 60,
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
        hull: 100,
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
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail("Timed out waiting for durable input queue.");
}

test("ordered input work queue fails closed at its configured bound", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const order = [];
  const queue = new BoundedOrderedQueue(1, (error) => { throw error; });
  assert.equal(queue.enqueue(async () => { await gate; order.push(1); }), true);
  assert.equal(queue.enqueue(async () => { order.push(2); }), false);
  assert.equal(queue.size, 1);
  release();
  await queue.drain();
  assert.deepEqual(order, [1]);
  assert.equal(queue.size, 0);
});

test("slow lifecycle PostgreSQL and Valkey input I/O in one session do not block another session tick", async () => {
  let releaseSlowJournal;
  const slowJournal = new Promise((resolve) => { releaseSlowJournal = resolve; });
  let releaseSlowConnected;
  const slowConnected = new Promise((resolve) => { releaseSlowConnected = resolve; });
  let releaseSlowDisconnected;
  const slowDisconnected = new Promise((resolve) => { releaseSlowDisconnected = resolve; });
  const journaled = [];
  const lifecycle = [];
  const routes = new Set();
  const manager = new BattleSessionManager(
    { async load() { return null; }, async save() {}, async delete() {} },
    {
      async finalizeOnce() { throw new Error("unexpected finalization"); },
      async finalizeDuelOnce() { throw new Error("unexpected duel finalization"); },
      async attachReplayOnce() {}, async ping() {}, async close() {},
    },
    { nowMs: () => 1_000 },
    { info() {}, warn() {}, error() {} },
    {
      lifecycle: {
        async markConnected(input) {
          if (input.attemptId === "attempt-slow") await slowConnected;
          lifecycle.push({ type: "connected", ...input });
        },
        async markDisconnected(input) {
          if (input.attemptId === "attempt-slow") await slowDisconnected;
          lifecycle.push({ type: "disconnected", ...input });
        },
      },
      definitions: { async load() { return null; }, async save() {}, async delete() {} },
      inputJournal: {
        async append(sessionId, userId, input) {
          if (sessionId === "session-slow") await slowJournal;
          journaled.push({ sessionId, userId, input });
        },
        async readAfter() { return []; }, async readAll() { return []; }, async delete() {},
      },
      router: {
        async claim(sessionId) { if (routes.has(sessionId)) return false; routes.add(sessionId); return true; },
        async refresh(sessionId) { return routes.has(sessionId); },
        async release(sessionId) { routes.delete(sessionId); },
      },
      replayStorage: { async store() { throw new Error("unexpected replay"); }, async ping() {} },
      routeLease: { workerId: "worker-1", endpoint: "ws://worker-1" },
      routeTtlSeconds: 30,
    },
  );

  await manager.createSession(definition("slow"));
  await manager.createSession(definition("fast"));
  const slow = new TestConnection("connection-slow");
  const fast = new TestConnection("connection-fast");
  const slowAttachCompleted = await Promise.race([
    manager.attachConnection({ mode: "pve", sessionId: "session-slow", attemptId: "attempt-slow", userId: "user-slow" }, slow),
    new Promise((resolve) => setTimeout(() => resolve(false), 20)),
  ]);
  assert.equal(slowAttachCompleted, true);
  await manager.attachConnection({ mode: "pve", sessionId: "session-fast", attemptId: "attempt-fast", userId: "user-fast" }, fast);

  const lifecycleTickCompleted = await Promise.race([
    manager.advanceOneTick().then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 20)),
  ]);
  assert.equal(lifecycleTickCompleted, true);
  assert.equal(lifecycle.some((entry) => entry.attemptId === "attempt-slow"), false);
  releaseSlowConnected();
  await waitFor(() => lifecycle.some((entry) => entry.type === "connected" && entry.attemptId === "attempt-slow"));

  const handlerCompleted = await Promise.race([
    slow.receive({
      type: "input.command",
      command: { seq: 1, targetTick: 5, moveX: 1_000, moveY: 0, aimX: 1_000, aimY: 0, actionFlags: 0 },
    }).then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 20)),
  ]);
  assert.equal(handlerCompleted, true);

  const tickCompleted = await Promise.race([
    (async () => {
      await manager.advanceOneTick();
      await manager.advanceOneTick();
      await manager.advanceOneTick();
      return true;
    })(),
    new Promise((resolve) => setTimeout(() => resolve(false), 20)),
  ]);
  assert.equal(tickCompleted, true);
  assert.ok(fast.messages.some((message) => message.type === "battle.snapshot"));
  assert.equal(journaled.length, 0);

  releaseSlowJournal();
  await waitFor(() => journaled.length === 1);
  await manager.advanceOneTick();
  await manager.advanceOneTick();
  await manager.advanceOneTick();
  assert.equal(
    slow.messages.findLast((message) => message.type === "battle.snapshot")?.snapshot.lastProcessedInputSequence,
    1,
  );

  const slowCloseCompleted = await Promise.race([
    slow.disconnect().then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 20)),
  ]);
  assert.equal(slowCloseCompleted, true);
  const disconnectTickCompleted = await Promise.race([
    manager.advanceOneTick().then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 20)),
  ]);
  assert.equal(disconnectTickCompleted, true);
  assert.equal(lifecycle.some((entry) => entry.type === "disconnected" && entry.attemptId === "attempt-slow"), false);
  releaseSlowDisconnected();
  await waitFor(() => lifecycle.some((entry) => entry.type === "disconnected" && entry.attemptId === "attempt-slow"));
});
