import { createHash } from "node:crypto";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ContentReleaseStatus,
  MissionRisk,
  MissionType,
  SeasonStatus,
} from "../generated/client.js";
import { createPrismaClient } from "../src/client.js";

const packageDir = fileURLToPath(new URL("..", import.meta.url));
const workspaceRoot = resolve(packageDir, "../..");
loadEnv({ path: resolve(workspaceRoot, ".env") });

const seedEnvironment = process.env.SPACEY_SEED_ENV;
if (seedEnvironment !== "local" && seedEnvironment !== "staging") {
  throw new Error("Refusing to seed: set SPACEY_SEED_ENV=local or staging explicitly");
}

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Set DIRECT_URL or DATABASE_URL before seeding");
}

const RELEASE_ID = "01900000-0000-7000-8000-000000000101";
const DROP_TABLE_ID = "01900000-0000-7000-8000-000000000102";
const MISSION_ID = "01900000-0000-7000-8000-000000000103";
const CONVOY_MISSION_ID = "01900000-0000-7000-8000-000000000104";
const SALVAGE_MISSION_ID = "01900000-0000-7000-8000-000000000105";
const PVP_MISSION_ID = "01900000-0000-7000-8000-000000000106";
const SEASON_ID = "01900000-0000-7000-8000-000000000005";
const RELEASE_VERSION = "2026.07.vertical-v2";

const matchmakingRules = {
  matchmakingQueues: {
    "ranked-eu": {
      region: "eu",
      missionId: "ranked-duel",
      baseMmrWindow: 100,
      expansionPerSecond: 5,
      maxMmrWindow: 500,
      ticketTtlSeconds: 300,
      mmrKFactor: 32,
    },
  },
};

const moduleSeeds = [
  {
    id: "01900000-0000-7000-8000-000000000110",
    key: "starter-core",
    category: "structure",
    kind: "core",
    rarity: "common",
    shape: { cells: [[0, 0]] },
    stats: { hp: 240, mass: 40, powerOutput: 120, energyCapacity: 1200, heatCapacity: 300, heatDissipationPerSecond: 120, collisionRadius: 24, repairCostCredits: 240 },
  },
  {
    id: "01900000-0000-7000-8000-000000000111",
    key: "starter-blaster",
    category: "weapons",
    kind: "projectile-weapon",
    rarity: "common",
    shape: { cells: [[0, 0]] },
    stats: { hp: 90, mass: 18, powerDraw: 18, damage: 14, range: 420, cooldownMs: 420, projectileSpeed: 620, energyCost: 18, heatPerShot: 28, collisionRadius: 12, repairCostCredits: 140 },
  },
  {
    id: "01900000-0000-7000-8000-000000000112",
    key: "starter-engine",
    category: "engines",
    kind: "engine",
    rarity: "common",
    shape: { cells: [[0, 0]] },
    stats: { hp: 110, mass: 22, powerDraw: 12, enginePowerPerSecond: 12, thrust: 80, collisionRadius: 14, repairCostCredits: 160 },
  },
  {
    id: "01900000-0000-7000-8000-000000000113",
    key: "starter-thruster",
    category: "engines",
    kind: "maneuver-thruster",
    rarity: "common",
    shape: { cells: [[0, 0]] },
    stats: { hp: 75, mass: 12, powerDraw: 8, enginePowerPerSecond: 8, maneuverThrust: 45, collisionRadius: 10, repairCostCredits: 100 },
  },
  {
    id: "01900000-0000-7000-8000-000000000114",
    key: "starter-shield",
    category: "power",
    kind: "shield-generator",
    rarity: "common",
    shape: { cells: [[0, 0]] },
    stats: { hp: 80, mass: 16, powerDraw: 20, shieldPowerPerSecond: 20, shieldCapacity: 80, shieldRegenPerSecond: 30, shieldRegenDelayMs: 3000, collisionRadius: 12, repairCostCredits: 180 },
  },
  {
    id: "01900000-0000-7000-8000-000000000130",
    key: "core_mk1",
    category: "structure",
    kind: "core",
    rarity: "common",
    shape: { cells: [[0, 0]] },
    stats: { hp: 240, mass: 40, powerOutput: 100, repairCostCredits: 240 },
  },
  {
    id: "01900000-0000-7000-8000-000000000131",
    key: "small_reactor",
    category: "power",
    kind: "reactor",
    rarity: "common",
    shape: { cells: [[0, 0]] },
    stats: { hp: 100, mass: 18, powerOutput: 80, repairCostCredits: 150 },
  },
  {
    id: "01900000-0000-7000-8000-000000000132",
    key: "ion_engine",
    category: "engines",
    kind: "engine",
    rarity: "common",
    shape: { cells: [[0, 0]] },
    stats: { hp: 100, mass: 20, powerDraw: 14, thrust: 70, repairCostCredits: 150 },
  },
  {
    id: "01900000-0000-7000-8000-000000000133",
    key: "autocannon",
    category: "weapons",
    kind: "projectile-weapon",
    rarity: "common",
    shape: { cells: [[0, 0]] },
    stats: { hp: 90, mass: 16, powerDraw: 10, damage: 12, range: 420, cooldownMs: 450, projectileSpeed: 620, repairCostCredits: 140 },
  },
  {
    id: "01900000-0000-7000-8000-000000000134",
    key: "laser_turret",
    category: "weapons",
    kind: "energy-weapon",
    rarity: "common",
    shape: { cells: [[0, 0]] },
    stats: { hp: 80, mass: 14, powerDraw: 18, damage: 10, range: 460, cooldownMs: 380, projectileSpeed: 800, repairCostCredits: 160 },
  },
  {
    id: "01900000-0000-7000-8000-000000000135",
    key: "shield_generator",
    category: "power",
    kind: "shield-generator",
    rarity: "common",
    shape: { cells: [[0, 0]] },
    stats: { hp: 80, mass: 16, powerDraw: 20, shieldCapacity: 80, repairCostCredits: 180 },
  },
  {
    id: "01900000-0000-7000-8000-000000000136",
    key: "hull_block",
    category: "structure",
    kind: "hull",
    rarity: "common",
    shape: { cells: [[0, 0]] },
    stats: { hp: 160, mass: 28, repairCostCredits: 120 },
  },
] as const;

const starterDefinitionKeys = new Set<string>([
  "starter-core",
  "starter-blaster",
  "starter-engine",
  "starter-thruster",
  "starter-shield",
]);

const bootstrapConfig = {
  simulationVersion: "2.0.0",
  starterMissionKey: "starter-scout",
  starterInventory: moduleSeeds
    .filter(({ key }) => starterDefinitionKeys.has(key))
    .map(({ key }) => ({ definitionKey: key, quantity: 1 })),
  starterBuildTemplate: {
    name: "Starter Scout",
    schemaVersion: 3,
    modules: [
      { definitionKey: "starter-core", x: 0, y: 0, rotation: 0 },
      { definitionKey: "starter-blaster", x: 0, y: -1, rotation: 0 },
      { definitionKey: "starter-engine", x: 0, y: 1, rotation: 0 },
      { definitionKey: "starter-thruster", x: -1, y: 1, rotation: 0 },
      { definitionKey: "starter-shield", x: 1, y: 0, rotation: 0 },
    ],
  },
};

const missionSeeds = [
  {
    id: MISSION_ID,
    key: "starter-scout",
    type: MissionType.SALVAGE,
    risk: MissionRisk.GREEN,
    title: "Starter Scout",
    description: "Clear a mixed rival salvage wing and recover the navigation core.",
    objective: { type: "destroy_all", target: 4, label: "Clear all 4 rival salvagers" },
    enemyRoster: [
      { definitionKey: "starter-rival-scout", count: 3 },
      { definitionKey: "starter-rival-bruiser", count: 1 },
    ],
    rewardDefinition: { dropTableKey: "starter-salvage" },
    durationSeconds: 90,
    dropTable: true,
  },
  {
    id: CONVOY_MISSION_ID,
    key: "convoy-guard",
    type: MissionType.ESCORT,
    risk: MissionRisk.YELLOW,
    title: "Convoy Guard",
    description: "Protect the civilian convoy until it clears the raider lane.",
    objective: {
      type: "protect_target",
      target: 60,
      targetHull: 600,
      collisionRadiusUnits: 48,
      label: "Protect the convoy for 60 seconds",
    },
    enemyRoster: [
      { definitionKey: "starter-rival-scout", count: 3 },
      { definitionKey: "starter-rival-bruiser", count: 1 },
    ],
    rewardDefinition: { dropTableKey: "starter-salvage" },
    durationSeconds: 120,
    dropTable: true,
  },
  {
    id: SALVAGE_MISSION_ID,
    key: "salvage-sweep",
    type: MissionType.MINING,
    risk: MissionRisk.GREEN,
    title: "Salvage Sweep",
    description: "Collect five marked scrap caches while rival scouts contest the field.",
    objective: {
      type: "collect_scrap",
      target: 5,
      scrapCount: 7,
      collectionRadiusUnits: 36,
      label: "Collect 5 scrap caches",
    },
    enemyRoster: [{ definitionKey: "starter-rival-scout", count: 2 }],
    rewardDefinition: { dropTableKey: "starter-salvage" },
    durationSeconds: 120,
    dropTable: true,
  },
  {
    id: PVP_MISSION_ID,
    key: "ranked-duel",
    type: MissionType.INTERCEPT,
    risk: MissionRisk.YELLOW,
    title: "Ranked Duel",
    description: "Server-authoritative one-versus-one duel.",
    objective: { type: "destroy_opponent", target: 1, label: "Destroy the opposing ship" },
    enemyRoster: [],
    rewardDefinition: {},
    durationSeconds: 180,
    dropTable: false,
  },
] as const;

const enemySeeds = [
  {
    id: "01900000-0000-7000-8000-000000000120",
    key: "starter-rival-scout",
    archetype: "scout",
    stats: { hp: 80, speed: 210, collisionRadius: 20, damage: 8, attackRange: 260, attackCooldownTicks: 30 },
    behavior: { profile: "orbit-and-fire", preferredRange: 260 },
    loadout: { weapon: "starter-blaster" },
  },
  {
    id: "01900000-0000-7000-8000-000000000121",
    key: "starter-rival-bruiser",
    archetype: "bruiser",
    stats: { hp: 180, speed: 120, collisionRadius: 32, damage: 16, attackRange: 220, attackCooldownTicks: 42 },
    behavior: { profile: "close-and-pressure", preferredRange: 180 },
    loadout: { weapon: "autocannon" },
  },
] as const;

const starterDropTableEntries = [
  { kind: "currency", currency: "CREDITS", amount: 300, weight: 1 },
  { kind: "currency", currency: "SCRAP", amount: 12, weight: 1 },
  { kind: "experience", amount: 25, weight: 1 },
  { kind: "item", definitionKey: "starter-core", chanceBps: 3500 },
] as const;

const configHash = createHash("sha256")
  .update(JSON.stringify({
    bootstrapConfig,
    matchmakingRules,
    moduleSeeds,
    missionSeeds,
    enemySeeds,
    dropTables: [{ key: "starter-salvage", entries: starterDropTableEntries }],
  }))
  .digest("hex");

const prisma = createPrismaClient(connectionString);

try {
  await prisma.$transaction(async (tx) => {
    const existingRelease = await tx.contentRelease.findUnique({ where: { version: RELEASE_VERSION } });
    if (existingRelease?.status === ContentReleaseStatus.RETIRED) {
      throw new Error(`Seed release ${RELEASE_VERSION} is retired and immutable; use a new release version.`);
    }
    if (existingRelease?.status === ContentReleaseStatus.PUBLISHED && existingRelease.configHash !== configHash) {
      throw new Error(`Seed release ${RELEASE_VERSION} is published with different content; use a new release version.`);
    }

    if (!existingRelease || existingRelease.status === ContentReleaseStatus.DRAFT) {
      const release = await tx.contentRelease.upsert({
      where: { version: RELEASE_VERSION },
      create: {
        id: RELEASE_ID,
        version: RELEASE_VERSION,
        status: ContentReleaseStatus.DRAFT,
        configHash,
        schemaVersion: 1,
        bootstrapConfig,
        notes: "Repeatable local/staging starter content",
      },
      update: {
        status: ContentReleaseStatus.DRAFT,
        configHash,
        schemaVersion: 1,
        bootstrapConfig,
        notes: "Repeatable local/staging starter content",
      },
    });

    const dropTable = await tx.dropTable.upsert({
      where: { contentReleaseId_key: { contentReleaseId: release.id, key: "starter-salvage" } },
      create: {
        id: DROP_TABLE_ID,
        contentReleaseId: release.id,
        key: "starter-salvage",
        entries: [...starterDropTableEntries],
      },
      update: {
        entries: [...starterDropTableEntries],
        enabled: true,
      },
    });

    for (const moduleSeed of moduleSeeds) {
      await tx.moduleDefinition.upsert({
        where: {
          contentReleaseId_key: { contentReleaseId: release.id, key: moduleSeed.key },
        },
        create: {
          ...moduleSeed,
          contentReleaseId: release.id,
          damageStates: { thresholdsBps: { light: 7500, heavy: 3500, destroyed: 0 } },
        },
        update: {
          category: moduleSeed.category,
          kind: moduleSeed.kind,
          rarity: moduleSeed.rarity,
          shape: moduleSeed.shape,
          stats: moduleSeed.stats,
          damageStates: { thresholdsBps: { light: 7500, heavy: 3500, destroyed: 0 } },
          enabled: true,
        },
      });
    }

    for (const missionSeed of missionSeeds) {
      const { id, dropTable: usesDropTable, ...definition } = missionSeed;
      await tx.missionDefinition.upsert({
        where: { contentReleaseId_key: { contentReleaseId: release.id, key: definition.key } },
        create: {
          id,
          contentReleaseId: release.id,
          dropTableId: usesDropTable ? dropTable.id : null,
          ...definition,
        },
        update: {
          dropTableId: usesDropTable ? dropTable.id : null,
          ...definition,
          enabled: true,
        },
      });
    }

    for (const enemySeed of enemySeeds) {
      await tx.enemyDefinition.upsert({
        where: { contentReleaseId_key: { contentReleaseId: release.id, key: enemySeed.key } },
        create: { ...enemySeed, contentReleaseId: release.id },
        update: {
          archetype: enemySeed.archetype,
          stats: enemySeed.stats,
          behavior: enemySeed.behavior,
          loadout: enemySeed.loadout,
          enabled: true,
        },
      });
    }

      if (seedEnvironment === "local") {
        await tx.contentRelease.updateMany({
          where: { status: ContentReleaseStatus.PUBLISHED, version: { not: RELEASE_VERSION } },
          data: { status: ContentReleaseStatus.RETIRED },
        });
        await tx.contentRelease.update({
          where: { id: release.id },
          data: { status: ContentReleaseStatus.PUBLISHED, publishedAt: new Date() },
        });
      }
    }

    await tx.season.updateMany({
      where: { status: SeasonStatus.ACTIVE, id: { not: SEASON_ID } },
      data: { status: SeasonStatus.COMPLETED },
    });
    await tx.season.upsert({
      where: { key: "local-ranked-2026" },
      create: {
        id: SEASON_ID,
        key: "local-ranked-2026",
        status: SeasonStatus.ACTIVE,
        rules: matchmakingRules,
        startsAt: new Date("2026-01-01T00:00:00.000Z"),
        endsAt: new Date("2030-01-01T00:00:00.000Z"),
      },
      update: {
        status: SeasonStatus.ACTIVE,
        rules: matchmakingRules,
        startsAt: new Date("2026-01-01T00:00:00.000Z"),
        endsAt: new Date("2030-01-01T00:00:00.000Z"),
      },
    });
  });
} finally {
  await prisma.$disconnect();
}
