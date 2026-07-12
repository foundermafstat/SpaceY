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
        buildStats: buildStats({
          hull: 100,
          modules: [{
            id: "beta-core",
            inventoryItemId: "beta-inventory-core",
            category: "core",
            hp: 100,
            gridX: 0,
            gridY: 0
          }]
        })
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
  assert.deepEqual(
    final.outcome?.results.find((result) => result.userId === betaUserId)?.moduleDamage,
    [{
      moduleId: "beta-core",
      inventoryItemId: "beta-inventory-core",
      hpBefore: 100,
      hpAfter: 0,
      hpLoss: 100,
      detached: false
    }]
  );
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
    { userId: alphaUserId, outcome: "victory", reason: "disconnect_forfeit", moduleDamage: [] },
    { userId: betaUserId, outcome: "forfeit", reason: "disconnect_forfeit", moduleDamage: [] }
  ]);
  assert.equal(simulation.advanceOneTick().tick, 0);
});

test("forceNoContest ends an unstarted duel without winner or loser", () => {
  const simulation = new DuelSimulation(duelConfig());
  const outcome = simulation.forceNoContest();

  assert.equal(outcome.finalTick, 0);
  assert.equal(outcome.reason, "no_contest");
  assert.equal(outcome.winnerUserId, null);
  assert.equal(outcome.loserUserId, null);
  assert.deepEqual(outcome.results.map((result) => result.outcome), ["draw", "draw"]);
  assert.equal(simulation.createCheckpoint().state.outcomeReason, "no_contest");
});

test("base timer enters sudden death and resolves as a neutral draw after 30 seconds", () => {
  const simulation = new DuelSimulation(duelConfig({ durationSeconds: 1 }));
  const results = simulation.advanceTicks(930);
  const final = results.at(-1);
  assert.ok(results.flatMap((result) => result.events).some((event) => event.type === "sudden_death_started"));
  assert.equal(final.outcome?.reason, "draw");
  assert.equal(final.outcome?.winnerUserId, null);
  assert.equal(final.outcome?.loserUserId, null);
  assert.deepEqual(final.outcome?.results.map((result) => result.outcome), ["draw", "draw"]);
});

test("simultaneous destruction in one tick is a draw", () => {
  const lethalStats = buildStats({
    hull: 100,
    weaponDamage: 200,
    projectileSpeedUnitsPerSecond: 1_800
  });
  const simulation = new DuelSimulation(duelConfig({
    arenaWidthUnits: 120,
    arenaHeightUnits: 100,
    participants: [
      {
        participantId: "participant-alpha",
        userId: alphaUserId,
        side: "alpha",
        shipBuildRevisionId: "build-alpha-1",
        buildStats: lethalStats
      },
      {
        participantId: "participant-beta",
        userId: betaUserId,
        side: "beta",
        shipBuildRevisionId: "build-beta-1",
        buildStats: lethalStats
      }
    ]
  }));
  simulation.enqueueInput(alphaUserId, {
    seq: 1, targetTick: 1, moveX: 0, moveY: 0, aimX: 1000, aimY: 0, actionFlags: 1
  });
  simulation.enqueueInput(betaUserId, {
    seq: 1, targetTick: 1, moveX: 0, moveY: 0, aimX: -1000, aimY: 0, actionFlags: 1
  });

  const final = simulation.advanceOneTick();
  assert.equal(final.outcome?.reason, "draw");
  assert.equal(final.outcome?.winnerUserId, null);
  assert.equal(final.events.filter((event) => event.type === "entity_destroyed").length, 2);
});

test("duel snapshots expose independent weapons and shield absorption", () => {
  const alphaStats = buildStats({
    energyCapacity: 100,
    energyInitial: 100,
    energyGenerationPerTick: 0,
    weapons: [
      {
        id: "port",
        damage: 20,
        rangeUnits: 300,
        cooldownTicks: 6,
        projectileSpeedUnitsPerSecond: 1_800,
        energyCost: 10,
        heatPerShot: 5,
        actionFlag: 1
      },
      {
        id: "starboard",
        damage: 20,
        rangeUnits: 300,
        cooldownTicks: 6,
        projectileSpeedUnitsPerSecond: 1_800,
        energyCost: 10,
        heatPerShot: 5,
        actionFlag: 2
      }
    ]
  });
  const betaStats = buildStats({ hull: 100, shieldCapacity: 25, shieldInitial: 25 });
  const simulation = new DuelSimulation(duelConfig({
    arenaWidthUnits: 120,
    arenaHeightUnits: 100,
    participants: [
      {
        participantId: "participant-alpha",
        userId: alphaUserId,
        side: "alpha",
        shipBuildRevisionId: "build-alpha-1",
        buildStats: alphaStats
      },
      {
        participantId: "participant-beta",
        userId: betaUserId,
        side: "beta",
        shipBuildRevisionId: "build-beta-1",
        buildStats: betaStats
      }
    ]
  }));
  simulation.enqueueInput(alphaUserId, {
    seq: 1, targetTick: 1, moveX: 0, moveY: 0, aimX: 1000, aimY: 0, actionFlags: 3
  });

  const results = simulation.advanceTicks(3);
  const events = results.flatMap((result) => result.events);
  assert.deepEqual(
    events.filter((event) => event.type === "weapon_fired").map((event) => event.weaponId),
    ["port", "starboard"]
  );
  assert.ok(events.some((event) => event.type === "shield_hit"));
  const ships = simulation.createSnapshot().entities.filter((entity) => entity.kind === "ship");
  const alpha = ships.find((entity) => entity.ownerUserId === alphaUserId);
  const beta = ships.find((entity) => entity.ownerUserId === betaUserId);
  assert.equal(alpha.shipSystems.energy, 80);
  assert.equal(alpha.shipSystems.weapons.length, 2);
  assert.equal(beta.shipSystems.shield, 0);
  assert.equal(beta.hull, 85);
});
