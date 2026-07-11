import assert from "node:assert/strict";
import test from "node:test";

import {
  MissionSimulation,
  SIMULATION_VERSION,
  seedFromString
} from "../dist/index.js";

function config(seed = seedFromString("determinism-seed")) {
  return {
    sessionId: "session-1",
    attemptId: "attempt-1",
    missionId: "credit-sweep",
    mode: "pve",
    seed,
    contentVersion: "content-1",
    simulationVersion: SIMULATION_VERSION,
    shipBuildRevisionId: "build-revision-1",
    durationSeconds: 90,
    objective: { type: "destroy_all", targetKills: 3 },
    arenaWidthUnits: 1_200,
    arenaHeightUnits: 900,
    enemyCount: 3,
    player: {
      hull: 600,
      speedUnitsPerSecond: 240,
      weaponDamage: 35,
      weaponRangeUnits: 600,
      weaponCooldownTicks: 8,
      projectileSpeedUnitsPerSecond: 720
    },
    enemy: {
      hull: 100,
      speedUnitsPerSecond: 90,
      collisionRadiusUnits: 40,
      attackDamage: 8,
      attackRangeUnits: 130,
      attackCooldownTicks: 20
    }
  };
}

const commands = [
  { seq: 1, targetTick: 1, moveX: 500, moveY: -200, aimX: 800, aimY: -400, actionFlags: 1 },
  { seq: 2, targetTick: 15, moveX: -300, moveY: 700, aimX: 1000, aimY: 0, actionFlags: 1 },
  { seq: 3, targetTick: 45, moveX: 0, moveY: 0, aimX: -500, aimY: -500, actionFlags: 0 }
];

test("same seed and input stream produce identical hashes and checkpoints", () => {
  const left = new MissionSimulation(config());
  const right = new MissionSimulation(config());
  for (const command of commands) {
    assert.equal(left.enqueueInput(command).accepted, true);
    assert.equal(right.enqueueInput(command).accepted, true);
  }

  for (let tick = 0; tick < 120; tick += 1) {
    assert.equal(left.advanceOneTick().stateHash, right.advanceOneTick().stateHash);
  }
  assert.deepEqual(left.createCheckpoint(), right.createCheckpoint());

  const resumed = MissionSimulation.fromCheckpoint(left.createCheckpoint());
  for (let tick = 0; tick < 60; tick += 1) {
    assert.equal(left.advanceOneTick().stateHash, resumed.advanceOneTick().stateHash);
  }
});

test("input reordering is normalized by contiguous sequence", () => {
  const ordered = new MissionSimulation(config());
  const reordered = new MissionSimulation(config());
  for (const command of commands) ordered.enqueueInput(command);
  for (const command of [commands[2], commands[0], commands[1]]) reordered.enqueueInput(command);

  ordered.advanceTicks(80);
  reordered.advanceTicks(80);
  assert.equal(ordered.lastProcessedInputSequence, 3);
  assert.equal(reordered.lastProcessedInputSequence, 3);
  assert.equal(ordered.getStateHash(), reordered.getStateHash());
});

test("duplicate and already processed inputs cannot mutate the stream", () => {
  const simulation = new MissionSimulation(config());
  assert.deepEqual(simulation.enqueueInput(commands[0]), { accepted: true, scheduledTick: 1 });
  assert.deepEqual(simulation.enqueueInput(commands[0]), { accepted: false, reason: "duplicate" });
  simulation.advanceOneTick();
  assert.deepEqual(simulation.enqueueInput(commands[0]), { accepted: false, reason: "already_processed" });
});

test("different seeds produce different initial authoritative hashes", () => {
  const left = new MissionSimulation(config(1));
  const right = new MissionSimulation(config(2));
  assert.notEqual(left.getStateHash(), right.getStateHash());
});
