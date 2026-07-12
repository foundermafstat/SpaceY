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
    enemyRoster: [{
      definitionKey: "scout",
      count: 3,
      stats: {
        hull: 100,
        speedUnitsPerSecond: 90,
        collisionRadiusUnits: 40,
        attackDamage: 8,
        attackRangeUnits: 130,
        attackCooldownTicks: 20
      }
    }],
    player: {
      hull: 600,
      speedUnitsPerSecond: 240,
      weaponDamage: 35,
      weaponRangeUnits: 600,
      weaponCooldownTicks: 8,
      projectileSpeedUnitsPerSecond: 720
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

test("rich ship systems deterministically apply energy, heat, and independent weapon cooldowns", () => {
  const simulation = new MissionSimulation({
    ...config(),
    enemyRoster: [],
    objective: { type: "survive_seconds", targetSeconds: 10 },
    player: {
      ...config().player,
      energyCapacity: 50,
      energyInitial: 50,
      energyGenerationPerTick: 0,
      heatCapacity: 50,
      heatDissipationPerTick: 0,
      overheatRecoveryHeat: 10,
      weapons: [
        {
          id: "left-cannon",
          damage: 20,
          rangeUnits: 500,
          cooldownTicks: 6,
          projectileSpeedUnitsPerSecond: 600,
          energyCost: 30,
          heatPerShot: 30,
          actionFlag: 1
        },
        {
          id: "right-cannon",
          damage: 20,
          rangeUnits: 500,
          cooldownTicks: 6,
          projectileSpeedUnitsPerSecond: 600,
          energyCost: 30,
          heatPerShot: 30,
          actionFlag: 2
        }
      ]
    }
  });
  simulation.enqueueInput({
    seq: 1,
    targetTick: 1,
    moveX: 0,
    moveY: 0,
    aimX: 1000,
    aimY: 0,
    actionFlags: 3
  });

  const results = simulation.advanceTicks(3);
  const fired = results.flatMap((result) => result.events).filter((event) => event.type === "weapon_fired");
  assert.deepEqual(fired.map((event) => event.weaponId), ["left-cannon"]);
  const player = simulation.createSnapshot().entities.find((entity) => entity.kind === "player");
  assert.equal(player.shipSystems.energy, 20);
  assert.equal(player.shipSystems.heat, 30);
  assert.equal(player.shipSystems.weapons[0].cooldownRemaining, 4);
  assert.equal(player.shipSystems.weapons[1].cooldownRemaining, 0);
});

test("shield damage, module disable, and topology detach are authoritative", () => {
  const simulation = new MissionSimulation({
    ...config(),
    enemyRoster: [{
      definitionKey: "siege-drone",
      count: 1,
      stats: {
        ...config().enemyRoster[0].stats,
        attackDamage: 100,
        attackRangeUnits: 2_000,
        attackCooldownTicks: 1
      }
    }],
    objective: { type: "survive_seconds", targetSeconds: 10 },
    player: {
      ...config().player,
      shieldCapacity: 30,
      shieldInitial: 30,
      shieldRegenPerTick: 0,
      shieldRegenDelayTicks: 10,
      modules: [
        { id: "core", inventoryItemId: "inventory-core", category: "core", hp: 50, gridX: 0, gridY: 0 },
        { id: "wing", inventoryItemId: "inventory-wing", category: "weapon", hp: 100, gridX: 1, gridY: 0, parentModuleId: "core" }
      ]
    }
  });

  const result = simulation.advanceOneTick();
  assert.equal(result.outcome?.reason, "player_destroyed");
  assert.ok(result.events.some((event) => event.type === "shield_hit" && event.value === 30));
  assert.ok(result.events.some((event) => event.type === "part_damaged" && event.moduleIds?.[0] === "core"));
  assert.ok(result.events.some((event) => event.type === "module_detached" && event.moduleIds?.includes("wing")));
  const player = result.snapshot.entities.find((entity) => entity.kind === "player");
  assert.equal(player.shipSystems.modules.find((module) => module.id === "core").enabled, false);
  assert.equal(player.shipSystems.modules.find((module) => module.id === "wing").detached, true);
  assert.deepEqual(result.outcome?.moduleDamage, [
    {
      moduleId: "core",
      inventoryItemId: "inventory-core",
      hpBefore: 50,
      hpAfter: 0,
      hpLoss: 50,
      detached: false
    },
    {
      moduleId: "wing",
      inventoryItemId: "inventory-wing",
      hpBefore: 100,
      hpAfter: 100,
      hpLoss: 0,
      detached: true
    }
  ]);
});

test("heterogeneous enemy roster is authoritative and affects the replay hash", () => {
  const heterogeneous = {
    ...config(),
    enemyRoster: [
      { ...config().enemyRoster[0], definitionKey: "scout", count: 2 },
      {
        definitionKey: "bruiser",
        count: 1,
        stats: {
          ...config().enemyRoster[0].stats,
          hull: 240,
          speedUnitsPerSecond: 55,
          collisionRadiusUnits: 55
        }
      }
    ]
  };
  const simulation = new MissionSimulation(heterogeneous);
  const enemies = simulation.createSnapshot().entities.filter((entity) => entity.kind === "enemy");
  assert.deepEqual(enemies.map((enemy) => enemy.hullMax), [100, 100, 240]);
  assert.deepEqual(
    simulation.createCheckpoint().state.enemies.map((enemy) => enemy.definitionKey),
    ["scout", "scout", "bruiser"]
  );

  const changed = new MissionSimulation({
    ...heterogeneous,
    enemyRoster: heterogeneous.enemyRoster.map((entry) => entry.definitionKey === "bruiser"
      ? { ...entry, stats: { ...entry.stats, hull: 241 } }
      : entry)
  });
  assert.notEqual(simulation.getStateHash(), changed.getStateHash());
});

test("protect_target is won by survival and lost when the authoritative convoy is destroyed", () => {
  const base = {
    ...config(),
    durationSeconds: 2,
    arenaWidthUnits: 201,
    arenaHeightUnits: 201,
    objective: {
      type: "protect_target",
      targetSeconds: 1,
      targetHull: 10,
      collisionRadiusUnits: 10
    },
    enemyRoster: []
  };
  const victory = new MissionSimulation(base);
  const victoryResult = victory.advanceTicks(30).at(-1);
  assert.equal(victoryResult.outcome?.outcome, "victory");
  assert.equal(victoryResult.snapshot.objective.type, "protect_target");
  assert.ok(victoryResult.snapshot.entities.some((entity) => entity.id === "objective-convoy"));

  const defeat = new MissionSimulation({
    ...base,
    enemyRoster: [{
      definitionKey: "raider",
      count: 1,
      stats: {
        hull: 50,
        speedUnitsPerSecond: 1,
        collisionRadiusUnits: 1,
        attackDamage: 20,
        attackRangeUnits: 500,
        attackCooldownTicks: 1
      }
    }]
  });
  const defeatResult = defeat.advanceOneTick();
  assert.equal(defeatResult.outcome?.reason, "objective_failed");
  assert.ok(defeatResult.events.some((event) => event.type === "entity_destroyed" && event.entityIds[0] === "objective-convoy"));
});

test("collect_scrap progress and objective entities are deterministic and checkpointed", () => {
  const scrapConfig = {
    ...config(),
    durationSeconds: 10,
    arenaWidthUnits: 205,
    arenaHeightUnits: 205,
    objective: {
      type: "collect_scrap",
      targetScrap: 2,
      scrapCount: 2,
      collectionRadiusUnits: 100
    },
    enemyRoster: []
  };
  const left = new MissionSimulation(scrapConfig);
  const right = new MissionSimulation(scrapConfig);
  const leftResult = left.advanceOneTick();
  const rightResult = right.advanceOneTick();
  assert.equal(leftResult.stateHash, rightResult.stateHash);
  assert.equal(leftResult.outcome?.outcome, "victory");
  assert.equal(leftResult.snapshot.objective.progress, 2);
  assert.equal(leftResult.events.filter((event) => event.type === "objective_collected").length, 2);
  assert.deepEqual(left.createCheckpoint(), right.createCheckpoint());
});
