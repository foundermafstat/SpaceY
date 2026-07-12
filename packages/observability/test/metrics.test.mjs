import assert from "node:assert/strict";
import test from "node:test";
import { BattleWorkerMetrics, JobsMetrics } from "../dist/index.js";

class FakeInstrument {
  calls = [];
  callbacks = [];

  add(value, attributes) {
    this.calls.push({ value, attributes });
  }

  record(value, attributes) {
    this.calls.push({ value, attributes });
  }

  addCallback(callback) {
    this.callbacks.push(callback);
  }
}

class FakeMeter {
  instruments = new Map();

  createCounter(name) {
    return this.create(name);
  }

  createUpDownCounter(name) {
    return this.create(name);
  }

  createHistogram(name) {
    return this.create(name);
  }

  createObservableGauge(name) {
    return this.create(name);
  }

  create(name) {
    const instrument = new FakeInstrument();
    this.instruments.set(name, instrument);
    return instrument;
  }
}

test("battle metrics de-duplicate active and pending lifecycle transitions", () => {
  const meter = new FakeMeter();
  const metrics = new BattleWorkerMetrics(meter, () => 12_000);

  metrics.websocketOpened("connection-1");
  metrics.websocketOpened("connection-1");
  metrics.websocketClosed("connection-1");
  metrics.websocketClosed("connection-1");
  metrics.sessionActivated("session-1", "pvp");
  metrics.sessionActivated("session-1", "pvp");
  metrics.replayPendingStarted("session-1", "pvp");
  metrics.replayPendingStarted("session-1", "pvp");
  metrics.replayPendingResolved("session-1", "pvp");
  metrics.replayPendingResolved("session-1", "pvp");
  metrics.sessionDeactivated("session-1");
  metrics.sessionDeactivated("session-1");

  assert.deepEqual(meter.instruments.get("spacey.battle.ws.connections.active").calls, [
    { value: 1, attributes: undefined },
    { value: -1, attributes: undefined },
  ]);
  assert.deepEqual(meter.instruments.get("spacey.battle.sessions.active").calls, [
    { value: 1, attributes: { mode: "pvp" } },
    { value: -1, attributes: { mode: "pvp" } },
  ]);
  assert.deepEqual(meter.instruments.get("spacey.battle.duels.active").calls, [
    { value: 1, attributes: undefined },
    { value: -1, attributes: undefined },
  ]);
  assert.deepEqual(meter.instruments.get("spacey.battle.replay.pending").calls, [
    { value: 1, attributes: { mode: "pvp" } },
    { value: -1, attributes: { mode: "pvp" } },
  ]);
});

test("checkpoint gauge reports the oldest real checkpoint by mode without session IDs", () => {
  const meter = new FakeMeter();
  const metrics = new BattleWorkerMetrics(meter, () => 12_000);
  metrics.sessionActivated("pve-a", "pve");
  metrics.sessionActivated("pve-b", "pve");
  metrics.sessionActivated("pvp-a", "pvp");
  metrics.checkpointSaved("pve-a", "pve", 8_000);
  metrics.checkpointSaved("pve-b", "pve", 10_000);
  metrics.checkpointSaved("pvp-a", "pvp", 11_000);

  const observations = [];
  const gauge = meter.instruments.get("spacey.battle.checkpoint.age");
  gauge.callbacks[0]({ observe: (value, attributes) => observations.push({ value, attributes }) });

  assert.deepEqual(observations, [
    { value: 4, attributes: { mode: "pve" } },
    { value: 1, attributes: { mode: "pvp" } },
  ]);
});

test("battle event metrics export only bounded operational attributes", () => {
  const meter = new FakeMeter();
  const metrics = new BattleWorkerMetrics(meter, () => 12_000);
  metrics.recordTickLag(18.5);
  metrics.inputReceived("pve");
  metrics.inputWasRejected("pve", "rate_limited");
  metrics.snapshotDropped();
  metrics.reconnected("pvp");
  metrics.noShow("no_contest");
  metrics.finalizationCompleted("pvp", 920);
  metrics.finalizationRetry("pvp", "replay");
  metrics.ledgerConflict("mission_reward", "40001");

  assert.deepEqual(meter.instruments.get("spacey.battle.tick.lag").calls, [
    { value: 18.5, attributes: undefined },
  ]);
  assert.deepEqual(meter.instruments.get("spacey.battle.input.commands").calls, [
    { value: 1, attributes: { mode: "pve" } },
  ]);
  assert.deepEqual(meter.instruments.get("spacey.battle.input.rejected").calls, [
    { value: 1, attributes: { mode: "pve", reason: "rate_limited" } },
  ]);
  assert.deepEqual(meter.instruments.get("spacey.battle.ws.snapshots.dropped").calls, [
    { value: 1, attributes: { reason: "backpressure" } },
  ]);
  assert.deepEqual(meter.instruments.get("spacey.battle.finalization.retries").calls, [
    { value: 1, attributes: { mode: "pvp", stage: "replay" } },
  ]);
  assert.deepEqual(meter.instruments.get("spacey.economy.ledger.conflicts").calls, [
    { value: 1, attributes: { operation: "mission_reward", code: "40001" } },
  ]);
});

test("jobs metric records claim age rather than estimating queue depth", () => {
  const meter = new FakeMeter();
  const metrics = new JobsMetrics(meter, () => 15_000);
  metrics.outboxEventClaimed(new Date(12_500));
  assert.deepEqual(meter.instruments.get("spacey.jobs.outbox.event.age").calls, [
    { value: 2.5, attributes: undefined },
  ]);
});
