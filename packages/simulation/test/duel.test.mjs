import assert from "node:assert/strict";
import test from "node:test";

import {
  DuelSimulation,
  SIMULATION_VERSION,
  seedFromString
} from "../dist/index.js";

const alphaUserId = "user-alpha";
const betaUserId = "user-beta";

function buildStats(overrides = {}) {
  return {
    hull: 300,
    speedUnitsPerSecond: 240,
    weaponDamage: 40,
    weaponRangeUnits: 600,
    weaponCooldownTicks: 6,
    projectileSpeedUnitsPerSecond: 900,
    collisionRadiusUnits: 30,
    ...overrides
  };
}

function duelConfig(overrides = {}) {
  return {
    matchId: "match-1",
    sessionId: "duel-session-1",
    seed: seedFromString("duel-seed"),
    contentVersion: "content-1",
    simulationVersion: SIMULATION_VERSION,
    durationSeconds: 90,
    arenaWidthUnits: 600,
    arenaHeightUnits: 300,
    participants: [
      {
        participantId: "participant-alpha",
        userId: alphaUserId,
        side: "alpha",
        shipBuildRevisionId: "build-alpha-1",
        buildStats: buildStats()
      },
      {
        participantId: "participant-beta",
        userId: betaUserId,
        side: "beta",
        shipBuildRevisionId: "build-beta-1",
        buildStats: buildStats()
      }
    ],
    ...overrides
  };
}

const alphaCommands = [
  { seq: 1, targetTick: 1, moveX: 500, moveY: -200, aimX: 1000, aimY: 0, actionFlags: 1 },
  { seq: 2, targetTick: 12, moveX: 0, moveY: 500, aimX: 1000, aimY: 0, actionFlags: 0 }
];

const betaCommands = [
  { seq: 1, targetTick: 1, moveX: -300, moveY: 400, aimX: -1000, aimY: 0, actionFlags: 1 },
  { seq: 2, targetTick: 18, moveX: 0, moveY: -500, aimX: -1000, aimY: 0, actionFlags: 0 }
];

test("same duel config and per-user input streams produce identical hashes", () => {
  const left = new DuelSimulation(duelConfig());
  const right = new DuelSimulation(duelConfig());

  for (const command of alphaCommands) left.enqueueInput(alphaUserId, command);
  for (const command of betaCommands) left.enqueueInput(betaUserId, command);
  for (const command of [betaCommands[1], betaCommands[0]]) right.enqueueInput(betaUserId, command);
  for (const command of [alphaCommands[1], alphaCommands[0]]) right.enqueueInput(alphaUserId, command);

  for (let tick = 0; tick < 40; tick += 1) {
    assert.equal(left.advanceOneTick().stateHash, right.advanceOneTick().stateHash);
  }
  assert.deepEqual(left.createCheckpoint(), right.createCheckpoint());
});

test("input sequence and buffering are independent for each user", () => {
  const simulation = new DuelSimulation(duelConfig());
  assert.equal(simulation.enqueueInput(alphaUserId, alphaCommands[1]).accepted, true);
  assert.equal(simulation.enqueueInput(betaUserId, betaCommands[0]).accepted, true);
  simulation.advanceOneTick();

  assert.equal(simulation.lastProcessedInputSequence(alphaUserId), 0);
  assert.equal(simulation.lastProcessedInputSequence(betaUserId), 1);

  assert.equal(simulation.enqueueInput(alphaUserId, alphaCommands[0]).accepted, true);
  simulation.advanceTicks(11);
  assert.equal(simulation.lastProcessedInputSequence(alphaUserId), 2);
  assert.equal(simulation.lastProcessedInputSequence(betaUserId), 1);
});

test("neutral input applies to one participant without changing the other", () => {
  const simulation = new DuelSimulation(duelConfig());
  simulation.enqueueInput(alphaUserId, {
    seq: 1,
    targetTick: 1,
    moveX: 1000,
    moveY: 0,
    aimX: 1000,
    aimY: 0,
    actionFlags: 0
  });
  simulation.enqueueInput(betaUserId, {
    seq: 1,
    targetTick: 1,
    moveX: 0,
    moveY: 1000,
    aimX: -1000,
    aimY: 0,
    actionFlags: 0
  });
  simulation.enqueueInput(alphaUserId, {
    seq: 2,
    targetTick: 3,
    moveX: -1000,
    moveY: 0,
    aimX: -1000,
    aimY: 0,
    actionFlags: 0
  });
  simulation.advanceOneTick();
  simulation.setNeutralInput(alphaUserId);
  simulation.advanceTicks(2);

  const ships = simulation.createSnapshot().entities.filter((entity) => entity.kind === "ship");
  const alpha = ships.find((entity) => entity.ownerUserId === alphaUserId);
  const beta = ships.find((entity) => entity.ownerUserId === betaUserId);
  assert.equal(alpha.velocityXMilliPerTick, 0);
  assert.equal(alpha.velocityYMilliPerTick, 0);
  assert.equal(simulation.lastProcessedInputSequence(alphaUserId), 1);
  assert.ok(beta.velocityYMilliPerTick > 0);
});

test("projectiles deterministically damage and destroy the opposing ship", () => {
  const config = duelConfig({
    participants: [
      {
        participantId: "participant-alpha",
        userId: alphaUserId,
        side: "alpha",
        shipBuildRevisionId: "build-alpha-1",
        buildStats: buildStats({ weaponDamage: 200, projectileSpeedUnitsPerSecond: 3_000 })
      },
      {
        participantId: "participant-beta",
        userId: betaUserId,
        side: "beta",
        shipBuildRevisionId: "build-beta-1",
        buildStats: buildStats({ hull: 100 })
      }
    ]
  });
  const simulation = new DuelSimulation(config);
  simulation.enqueueInput(alphaUserId, {
    seq: 1,
    targetTick: 1,
    moveX: 0,
    moveY: 0,
    aimX: 1000,
    aimY: 0,
    actionFlags: 1
  });

  const results = simulation.advanceTicks(10);
  const final = results.at(-1);
  assert.equal(final.outcome?.reason, "ship_destroyed");
  assert.equal(final.outcome?.winnerUserId, alphaUserId);
  assert.equal(final.outcome?.loserUserId, betaUserId);
  assert.equal(final.outcome?.results.find((result) => result.userId === betaUserId)?.outcome, "defeat");
  assert.ok(results.flatMap((result) => result.events).some((event) => event.type === "entity_damaged"));
});

test("checkpoint restore preserves pending input and replay-equivalent hashes", () => {
  const original = new DuelSimulation(duelConfig());
  original.enqueueInput(alphaUserId, alphaCommands[0]);
  original.enqueueInput(alphaUserId, alphaCommands[1]);
  original.enqueueInput(betaUserId, betaCommands[0]);
  original.advanceTicks(4);

  const checkpoint = original.createCheckpoint();
  const resumed = DuelSimulation.fromCheckpoint(checkpoint);
  assert.deepEqual(resumed.createCheckpoint(), checkpoint);
  for (let tick = 0; tick < 30; tick += 1) {
    const expected = original.advanceOneTick();
    const actual = resumed.advanceOneTick();
    assert.equal(actual.stateHash, expected.stateHash);
    assert.deepEqual(actual.snapshot, expected.snapshot);
    assert.deepEqual(actual.outcome, expected.outcome);
  }
});

test("forceForfeit records per-user victory and forfeit outcomes", () => {
  const simulation = new DuelSimulation(duelConfig());
  const outcome = simulation.forceForfeit(betaUserId);

  assert.equal(outcome.winnerUserId, alphaUserId);
  assert.equal(outcome.loserUserId, betaUserId);
  assert.equal(outcome.reason, "disconnect_forfeit");
  assert.deepEqual(outcome.results, [
    { userId: alphaUserId, outcome: "victory", reason: "disconnect_forfeit" },
    { userId: betaUserId, outcome: "forfeit", reason: "disconnect_forfeit" }
  ]);
  assert.equal(simulation.advanceOneTick().tick, 0);
});

test("time expiry resolves exact ties deterministically from the match seed", () => {
  const even = new DuelSimulation(duelConfig({ durationSeconds: 1, seed: 2 }));
  const odd = new DuelSimulation(duelConfig({ durationSeconds: 1, seed: 3 }));
  const evenFinal = even.advanceTicks(30).at(-1);
  const oddFinal = odd.advanceTicks(30).at(-1);
  assert.equal(evenFinal.outcome?.reason, "time_expired");
  assert.equal(oddFinal.outcome?.reason, "time_expired");
  assert.equal(evenFinal.outcome?.winnerUserId, alphaUserId);
  assert.equal(oddFinal.outcome?.winnerUserId, betaUserId);
});
