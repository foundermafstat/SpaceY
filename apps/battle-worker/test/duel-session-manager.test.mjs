import assert from "node:assert/strict";
import test from "node:test";

import { DuelSessionManager } from "../src/duel-session-manager.ts";

const alpha = {
  userId: "user-alpha",
  attemptId: "attempt-alpha",
  participantId: "participant-alpha",
  side: 0,
};
const beta = {
  userId: "user-beta",
  attemptId: "attempt-beta",
  participantId: "participant-beta",
  side: 1,
};

function buildStats() {
  return {
    hull: 300,
    speedUnitsPerSecond: 240,
    weaponDamage: 40,
    weaponRangeUnits: 600,
    weaponCooldownTicks: 6,
    projectileSpeedUnitsPerSecond: 900,
    collisionRadiusUnits: 30,
  };
}

function definition() {
  return {
    kind: "pvp",
    participants: [alpha, beta],
    simulationConfig: {
      matchId: "match-1",
      sessionId: "session-1",
      seed: 12345,
      contentVersion: "content-1",
      simulationVersion: "2.0.0",
      durationSeconds: 90,
      arenaWidthUnits: 600,
      arenaHeightUnits: 300,
      participants: [
        { ...alpha, side: "alpha", shipBuildRevisionId: "build-alpha", buildStats: buildStats() },
        { ...beta, side: "beta", shipBuildRevisionId: "build-beta", buildStats: buildStats() },
      ],
    },
  };
}

class TestConnection {
  messages = [];
  closed = null;
  #messageHandler = async () => {};
  #closeHandler = async () => {};

  constructor(id) { this.id = id; }
  async send(message) { this.messages.push(message); }
  close(code, reason) { this.closed = { code, reason }; }
  onMessage(handler) { this.#messageHandler = handler; return () => {}; }
  onClose(handler) { this.#closeHandler = handler; return () => {}; }
  receive(message) { return this.#messageHandler(message); }
  disconnect() { return this.#closeHandler(); }
}

function harness({ finalizationFailures = 0, replayFailures = 0, cleanupFailures = 0 } = {}) {
  let nowMs = 1_000;
  const checkpoints = new Map();
  const journals = new Map();
  const definitions = new Map([["session-1", definition()]]);
  const lifecycle = [];
  const finalizations = [];
  const finalizationAttempts = [];
  const replayRequests = [];
  const replayAttachments = [];
  let cleanupAttempts = 0;
  const errors = [];
  const routes = new Set();
  const infrastructure = {
    lifecycle: {
      async markConnected(input) { lifecycle.push({ type: "connected", ...input }); },
      async markDisconnected(input) { lifecycle.push({ type: "disconnected", ...input }); },
    },
    definitions: {
      async load(sessionId) { return definitions.get(sessionId) ?? null; },
      async save(request) { definitions.set(request.simulationConfig.sessionId, request); },
      async delete(sessionId) {
        cleanupAttempts += 1;
        if (cleanupAttempts <= cleanupFailures) throw new Error("temporary cleanup outage");
        definitions.delete(sessionId);
      },
    },
    inputJournal: {
      async append(sessionId, userId, input) {
        const entries = journals.get(sessionId) ?? [];
        entries.push({ userId, input: structuredClone(input) });
        journals.set(sessionId, entries);
      },
      async readAfter(sessionId, userId, sequence) {
        return (journals.get(sessionId) ?? [])
          .filter((entry) => entry.userId === userId && entry.input.seq > sequence)
          .map((entry) => structuredClone(entry.input));
      },
      async readAll(sessionId) { return structuredClone(journals.get(sessionId) ?? []); },
      async delete(sessionId) { journals.delete(sessionId); },
    },
    router: {
      async claim(sessionId) { if (routes.has(sessionId)) return false; routes.add(sessionId); return true; },
      async refresh(sessionId) { return routes.has(sessionId); },
      async release(sessionId) { routes.delete(sessionId); },
    },
    replayStorage: {
      async store(request) {
        replayRequests.push(structuredClone(request));
        if (replayRequests.length <= replayFailures) throw new Error("temporary replay storage outage");
        return {
          storageKey: `replays/pvp/${request.simulationConfig.matchId}.jsonl.gz`,
          checksumSha256: "a".repeat(64),
          compression: "gzip",
          sizeBytes: 100,
          tickCount: request.finalCheckpoint.state.tick,
          expiresAt: new Date(nowMs + 86_400_000).toISOString(),
        };
      },
      async ping() {},
    },
    routeLease: { workerId: "worker-1", endpoint: "ws://worker-1" },
    routeTtlSeconds: 30,
  };
  const finalizer = {
    async finalizeOnce() { throw new Error("unexpected PvE finalization"); },
    async finalizeDuelOnce(request) {
      finalizationAttempts.push(request);
      if (finalizationAttempts.length <= finalizationFailures) throw new Error("temporary finalizer outage");
      finalizations.push(request);
      return { resultIds: { [alpha.userId]: "result-alpha", [beta.userId]: "result-beta" } };
    },
    async attachReplayOnce(request) { replayAttachments.push(structuredClone(request)); },
    async ping() {},
    async close() {},
  };
  const checkpointStore = {
    async load(sessionId) { return structuredClone(checkpoints.get(sessionId) ?? null); },
    async save(checkpoint) { checkpoints.set(checkpoint.sessionId, structuredClone(checkpoint)); },
    async delete(sessionId) { checkpoints.delete(sessionId); },
  };
  const logger = { info() {}, warn() {}, error(message, context) { errors.push({ message, context }); } };
  const manager = () => new DuelSessionManager(
    checkpointStore,
    finalizer,
    { nowMs: () => nowMs },
    logger,
    infrastructure,
  );
  return {
    manager,
    checkpoints,
    finalizations,
    finalizationAttempts,
    journals,
    lifecycle,
    replayRequests,
    replayAttachments,
    get cleanupAttempts() { return cleanupAttempts; },
    errors,
    routes,
    setNow(value) { nowMs = value; },
  };
}

function claims(participant) {
  return {
    mode: "pvp",
    sessionId: "session-1",
    matchId: "match-1",
    ...participant,
  };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail("Timed out waiting for asynchronous session work.");
}

test("two PvP participants have isolated inputs, reconnect state and exactly-once forfeit finalization", async () => {
  const state = harness();
  const manager = state.manager();
  await manager.createSession(definition());
  const alphaConnection = new TestConnection("connection-alpha");
  const betaConnection = new TestConnection("connection-beta");
  assert.equal(await manager.attachConnection(claims(alpha), alphaConnection), true);
  await manager.advanceOneTick();
  assert.equal(alphaConnection.messages.length, 0);
  assert.equal(await manager.attachConnection(claims(beta), betaConnection), true);

  assert.equal(alphaConnection.messages[0].participant.side, 0);
  assert.equal(betaConnection.messages[0].participant.side, 1);
  assert.equal(alphaConnection.messages[0].snapshot.entities.filter((entity) => entity.kind === "player").length, 1);
  assert.equal(alphaConnection.messages[0].snapshot.entities.filter((entity) => entity.kind === "enemy").length, 1);

  await alphaConnection.receive({
    type: "input.command",
    command: { seq: 1, targetTick: 1, moveX: 1000, moveY: 0, aimX: 1000, aimY: 0, actionFlags: 0 },
  });
  await betaConnection.receive({
    type: "input.command",
    command: { seq: 1, targetTick: 1, moveX: 0, moveY: 1000, aimX: -1000, aimY: 0, actionFlags: 0 },
  });
  await manager.advanceOneTick();
  await manager.advanceOneTick();
  await manager.advanceOneTick();
  const alphaSnapshot = alphaConnection.messages.findLast((message) => message.type === "battle.snapshot");
  const betaSnapshot = betaConnection.messages.findLast((message) => message.type === "battle.snapshot");
  assert.equal(alphaSnapshot.snapshot.lastProcessedInputSequence, 1);
  assert.equal(betaSnapshot.snapshot.lastProcessedInputSequence, 1);

  await alphaConnection.disconnect();
  assert.equal(state.lifecycle.filter((entry) => entry.type === "disconnected").length, 1);
  state.setNow(30_000);
  await manager.advanceOneTick();
  assert.equal(state.finalizations.length, 0);

  const resumedAlpha = new TestConnection("connection-alpha-resumed");
  assert.equal(await manager.attachConnection(claims(alpha), resumedAlpha), true);
  await resumedAlpha.disconnect();
  state.setNow(90_000);
  await manager.advanceOneTick();
  await waitFor(() => state.finalizations.length === 1);
  assert.equal(state.finalizations.length, 1);
  assert.equal(state.finalizations[0].outcome.winnerUserId, beta.userId);
  assert.equal(state.finalizations[0].outcome.results.find((result) => result.userId === alpha.userId).outcome, "forfeit");
  assert.equal(betaConnection.messages.findLast((message) => message.type === "battle.ended").outcome, "victory");
  await manager.advanceOneTick();
  assert.equal(state.finalizations.length, 1);
});

test("PvP checkpoint restore replays each participant journal independently", async () => {
  const state = harness();
  const first = state.manager();
  await first.createSession(definition());
  const alphaConnection = new TestConnection("alpha-before-crash");
  const betaConnection = new TestConnection("beta-before-crash");
  await first.attachConnection(claims(alpha), alphaConnection);
  await first.attachConnection(claims(beta), betaConnection);
  await alphaConnection.receive({
    type: "input.command",
    command: { seq: 1, targetTick: 1, moveX: 1000, moveY: 0, aimX: 1000, aimY: 0, actionFlags: 0 },
  });
  await betaConnection.receive({
    type: "input.command",
    command: { seq: 1, targetTick: 1, moveX: 0, moveY: 1000, aimX: -1000, aimY: 0, actionFlags: 0 },
  });
  await waitFor(() => state.journals.get("session-1")?.length === 2);
  await first.advanceOneTick();
  await first.flushCheckpoints();
  assert.equal(state.checkpoints.get("session-1").kind, "pvp");

  state.routes.clear();
  const restored = state.manager();
  assert.equal(await restored.restoreSession("session-1"), true);
  const alphaAfterCrash = new TestConnection("alpha-after-crash");
  const betaAfterCrash = new TestConnection("beta-after-crash");
  await restored.attachConnection(claims(alpha), alphaAfterCrash);
  await restored.attachConnection(claims(beta), betaAfterCrash);
  assert.equal(alphaAfterCrash.messages[0].snapshot.lastProcessedInputSequence, 1);
  assert.equal(betaAfterCrash.messages[0].snapshot.lastProcessedInputSequence, 1);
});

test("PvP input is rejected before journaling after the 45-command burst", async () => {
  const state = harness();
  const manager = state.manager();
  await manager.createSession(definition());
  const alphaConnection = new TestConnection("alpha-rate-limit");
  const betaConnection = new TestConnection("beta-rate-limit");
  await manager.attachConnection(claims(alpha), alphaConnection);
  await manager.attachConnection(claims(beta), betaConnection);

  for (let seq = 1; seq <= 46; seq += 1) {
    await alphaConnection.receive({
      type: "input.command",
      command: { seq, targetTick: seq, moveX: 0, moveY: 0, aimX: 1000, aimY: 0, actionFlags: 0 },
    });
  }

  await waitFor(() => state.journals.get("session-1")?.length === 45);
  assert.equal(state.journals.get("session-1").length, 45);
  assert.equal(alphaConnection.messages.at(-1).type, "session.error");
  assert.equal(alphaConnection.messages.at(-1).code, "INPUT_RATE_LIMITED");
});

test("failed finalization retries once after exponential backoff instead of every tick", async () => {
  const state = harness({ finalizationFailures: 1 });
  const manager = state.manager();
  await manager.createSession(definition());
  const alphaConnection = new TestConnection("alpha-finalization-retry");
  const betaConnection = new TestConnection("beta-finalization-retry");
  await manager.attachConnection(claims(alpha), alphaConnection);
  await manager.attachConnection(claims(beta), betaConnection);
  await alphaConnection.disconnect();

  state.setNow(70_000);
  await manager.advanceOneTick();
  await waitFor(() => state.finalizationAttempts.length === 1);
  for (let tick = 0; tick < 20; tick += 1) await manager.advanceOneTick();
  assert.equal(state.finalizationAttempts.length, 1);

  state.setNow(70_999);
  await manager.advanceOneTick();
  assert.equal(state.finalizationAttempts.length, 1);
  state.setNow(71_000);
  await manager.advanceOneTick();
  await waitFor(() => state.finalizations.length === 1);
  assert.equal(state.finalizationAttempts.length, 2);
});

test("one PvP no-show forfeits after 20 seconds without replay or combat damage path", async () => {
  const state = harness();
  const manager = state.manager();
  await manager.createSession(definition());
  const alphaConnection = new TestConnection("alpha-ready");
  await manager.attachConnection(claims(alpha), alphaConnection);

  state.setNow(21_000);
  await manager.advanceOneTick();
  await waitFor(() => state.finalizations.length === 1 || state.errors.length > 0);
  assert.deepEqual(state.errors, []);

  assert.equal(state.finalizations[0].cancellation, "no_show_forfeit");
  assert.equal(state.finalizations[0].replay, null);
  assert.equal(state.finalizations[0].outcome.finalTick, 0);
  assert.equal(state.finalizations[0].outcome.loserUserId, beta.userId);
  assert.equal(state.replayRequests.length, 0);
  assert.equal(state.replayAttachments.length, 0);
  assert.equal(alphaConnection.messages.at(-1).type, "battle.ended");
  assert.equal(alphaConnection.messages.at(-1).outcome, "victory");
});

test("two PvP no-shows finalize as no contest without winner, MMR replay, or combat path", async () => {
  const state = harness();
  const manager = state.manager();
  await manager.createSession(definition());

  state.setNow(21_000);
  await manager.advanceOneTick();
  await waitFor(() => state.finalizations.length === 1 || state.errors.length > 0);
  assert.deepEqual(state.errors, []);

  assert.equal(state.finalizations[0].cancellation, "no_contest");
  assert.equal(state.finalizations[0].replay, null);
  assert.equal(state.finalizations[0].outcome.reason, "no_contest");
  assert.equal(state.finalizations[0].outcome.winnerUserId, null);
  assert.equal(state.finalizations[0].outcome.loserUserId, null);
  assert.deepEqual(state.finalizations[0].outcome.results.map((result) => result.outcome), ["draw", "draw"]);
  assert.equal(state.replayRequests.length, 0);
  assert.equal(state.replayAttachments.length, 0);
});

test("a broker-owned duel uses the materialization deadline and finalizes zero-attach as no contest", async () => {
  const state = harness();
  const manager = state.manager();
  const pending = { ...definition(), readyDeadlineAtMs: 5_000 };
  assert.equal(await manager.ensureSession(pending), true);

  state.setNow(5_001);
  await manager.advanceOneTick();
  await waitFor(() => state.finalizations.length === 1 || state.errors.length > 0);
  assert.deepEqual(state.errors, []);
  assert.equal(state.finalizations[0].cancellation, "no_contest");
  assert.equal(state.finalizations[0].outcome.finalTick, 0);
});

test("timed PvP draw reaches both clients with a neutral authoritative result", async () => {
  const state = harness();
  const manager = state.manager();
  const timed = definition();
  timed.simulationConfig.durationSeconds = 1;
  await manager.createSession(timed);
  const alphaConnection = new TestConnection("alpha-draw");
  const betaConnection = new TestConnection("beta-draw");
  await manager.attachConnection(claims(alpha), alphaConnection);
  await manager.attachConnection(claims(beta), betaConnection);

  for (let tick = 0; tick < 930; tick += 1) await manager.advanceOneTick();
  await waitFor(() => state.finalizations.length === 1);

  assert.equal(state.finalizations[0].cancellation, null);
  assert.equal(state.finalizations[0].outcome.reason, "draw");
  assert.equal(state.replayRequests.length, 1);
  assert.equal(state.replayAttachments.length, 1);
  assert.equal(alphaConnection.messages.findLast((message) => message.type === "battle.snapshot").snapshot.status, "draw");
  assert.equal(betaConnection.messages.findLast((message) => message.type === "battle.ended").outcome, "draw");
});

test("S3 outage leaves authoritative result committed and retries replay without duplicate finalization", async () => {
  const state = harness({ replayFailures: 1 });
  const manager = state.manager();
  await manager.createSession(definition());
  const alphaConnection = new TestConnection("alpha-replay-outage");
  const betaConnection = new TestConnection("beta-replay-outage");
  await manager.attachConnection(claims(alpha), alphaConnection);
  await manager.attachConnection(claims(beta), betaConnection);
  await alphaConnection.disconnect();

  state.setNow(70_000);
  await manager.advanceOneTick();
  await waitFor(() => state.finalizations.length === 1 && state.replayRequests.length === 1);
  assert.equal(state.finalizations[0].replay, null);
  assert.equal(state.replayAttachments.length, 0);
  assert.equal(betaConnection.messages.findLast((message) => message.type === "battle.ended").outcome, "victory");

  state.setNow(71_000);
  await manager.advanceOneTick();
  await waitFor(() => state.replayAttachments.length === 1);
  assert.equal(state.finalizations.length, 1);
  assert.equal(state.replayRequests.length, 2);
});

test("PvP cleanup outage retries cleanup without replay upload or DB finalization", async () => {
  const state = harness({ cleanupFailures: 1 });
  const manager = state.manager();
  await manager.createSession(definition());
  const alphaConnection = new TestConnection("alpha-cleanup-retry");
  const betaConnection = new TestConnection("beta-cleanup-retry");
  await manager.attachConnection(claims(alpha), alphaConnection);
  await manager.attachConnection(claims(beta), betaConnection);
  await alphaConnection.disconnect();

  state.setNow(70_000);
  await manager.advanceOneTick();
  await waitFor(() => state.cleanupAttempts === 1);
  assert.equal(manager.activeSessionCount, 1);
  assert.equal(state.finalizations.length, 1);
  assert.equal(state.replayRequests.length, 1);
  assert.equal(state.replayAttachments.length, 1);

  state.setNow(71_000);
  await manager.advanceOneTick();
  await waitFor(() => manager.activeSessionCount === 0);
  assert.equal(state.cleanupAttempts, 2);
  assert.equal(state.finalizations.length, 1);
  assert.equal(state.replayRequests.length, 1);
  assert.equal(state.replayAttachments.length, 1);
});

test("worker crash after DB finalization resumes replay attachment without calling reward finalization again", async () => {
  const state = harness({ replayFailures: 1 });
  const first = state.manager();
  await first.createSession(definition());
  const alphaConnection = new TestConnection("alpha-before-finalize-crash");
  const betaConnection = new TestConnection("beta-before-finalize-crash");
  await first.attachConnection(claims(alpha), alphaConnection);
  await first.attachConnection(claims(beta), betaConnection);
  await alphaConnection.disconnect();

  state.setNow(70_000);
  await first.advanceOneTick();
  await waitFor(() => state.finalizations.length === 1 && state.replayRequests.length === 1);
  assert.equal(state.finalizationAttempts.length, 1);
  assert.ok(state.checkpoints.has("session-1"));

  state.routes.clear();
  const recovered = state.manager();
  assert.equal(await recovered.ensureSession({ ...definition(), databaseFinalized: true }), true);
  state.setNow(71_000);
  await recovered.advanceOneTick();
  await waitFor(() => state.replayAttachments.length === 1);

  assert.equal(state.finalizationAttempts.length, 1);
  assert.equal(state.replayRequests.length, 2);
  assert.equal(state.replayAttachments.length, 1);
});
