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

const RELEASE_ID = "01900000-0000-7000-8000-000000000001";
const DROP_TABLE_ID = "01900000-0000-7000-8000-000000000002";
const MISSION_ID = "01900000-0000-7000-8000-000000000003";
const PVP_MISSION_ID = "01900000-0000-7000-8000-000000000004";
const SEASON_ID = "01900000-0000-7000-8000-000000000005";
const RELEASE_VERSION = "2026.07.starter-v1";

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
    id: "01900000-0000-7000-8000-000000000010",
    key: "starter-core",
    category: "structure",
    kind: "core",
    rarity: "common",
    shape: { cells: [[0, 0]] },
    stats: { hp: 240, mass: 40, powerOutput: 120 },
  },
  {
    id: "01900000-0000-7000-8000-000000000011",
    key: "starter-blaster",
    category: "weapons",
    kind: "projectile-weapon",
    rarity: "common",
    shape: { cells: [[0, 0]] },
    stats: { hp: 90, mass: 18, powerDraw: 18, damage: 14, cooldownMs: 420 },
  },
  {
    id: "01900000-0000-7000-8000-000000000012",
    key: "starter-engine",
    category: "engines",
    kind: "engine",
    rarity: "common",
    shape: { cells: [[0, 0]] },
    stats: { hp: 110, mass: 22, powerDraw: 12, thrust: 80 },
  },
  {
    id: "01900000-0000-7000-8000-000000000013",
    key: "starter-thruster",
    category: "engines",
    kind: "maneuver-thruster",
    rarity: "common",
    shape: { cells: [[0, 0]] },
    stats: { hp: 75, mass: 12, powerDraw: 8, maneuverThrust: 45 },
  },
  {
    id: "01900000-0000-7000-8000-000000000014",
    key: "starter-shield",
    category: "power",
    kind: "shield-generator",
    rarity: "common",
    shape: { cells: [[0, 0]] },
    stats: { hp: 80, mass: 16, powerDraw: 20, shieldCapacity: 80 },
  },
  {
    id: "01900000-0000-7000-8000-000000000030",
    key: "core_mk1",
    category: "structure",
    kind: "core",
    rarity: "common",
    shape: { cells: [[0, 0]] },
    stats: { hp: 240, mass: 40, powerOutput: 100 },
  },
  {
    id: "01900000-0000-7000-8000-000000000031",
    key: "small_reactor",
    category: "power",
    kind: "reactor",
    rarity: "common",
    shape: { cells: [[0, 0]] },
    stats: { hp: 100, mass: 18, powerOutput: 80 },
  },
  {
    id: "01900000-0000-7000-8000-000000000032",
    key: "ion_engine",
    category: "engines",
    kind: "engine",
    rarity: "common",
    shape: { cells: [[0, 0]] },
    stats: { hp: 100, mass: 20, powerDraw: 14, thrust: 70 },
  },
  {
    id: "01900000-0000-7000-8000-000000000033",
    key: "autocannon",
    category: "weapons",
    kind: "projectile-weapon",
    rarity: "common",
    shape: { cells: [[0, 0]] },
    stats: { hp: 90, mass: 16, powerDraw: 10, damage: 12, range: 420, cooldownMs: 450, projectileSpeed: 620 },
  },
  {
    id: "01900000-0000-7000-8000-000000000034",
    key: "laser_turret",
    category: "weapons",
    kind: "energy-weapon",
    rarity: "common",
    shape: { cells: [[0, 0]] },
    stats: { hp: 80, mass: 14, powerDraw: 18, damage: 10, range: 460, cooldownMs: 380, projectileSpeed: 800 },
  },
  {
    id: "01900000-0000-7000-8000-000000000035",
    key: "shield_generator",
    category: "power",
    kind: "shield-generator",
    rarity: "common",
    shape: { cells: [[0, 0]] },
    stats: { hp: 80, mass: 16, powerDraw: 20, shieldCapacity: 80 },
  },
  {
    id: "01900000-0000-7000-8000-000000000036",
    key: "hull_block",
    category: "structure",
    kind: "hull",
    rarity: "common",
    shape: { cells: [[0, 0]] },
    stats: { hp: 160, mass: 28 },
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

const configHash = createHash("sha256")
  .update(JSON.stringify({ bootstrapConfig, matchmakingRules, moduleSeeds }))
  .digest("hex");

const prisma = createPrismaClient(connectionString);

try {
  await prisma.$transaction(async (tx) => {
    await tx.contentRelease.updateMany({
      where: { status: ContentReleaseStatus.PUBLISHED, version: { not: RELEASE_VERSION } },
      data: { status: ContentReleaseStatus.RETIRED },
    });

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
        entries: [
          { kind: "currency", currency: "CREDITS", amount: 300, weight: 1 },
          { kind: "currency", currency: "SCRAP", amount: 12, weight: 1 },
          { kind: "experience", amount: 25, weight: 1 },
          { kind: "item", definitionKey: "starter-core", chanceBps: 3500 },
        ],
      },
      update: {
        entries: [
          { kind: "currency", currency: "CREDITS", amount: 300, weight: 1 },
          { kind: "currency", currency: "SCRAP", amount: 12, weight: 1 },
          { kind: "experience", amount: 25, weight: 1 },
          { kind: "item", definitionKey: "starter-core", chanceBps: 3500 },
        ],
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

    await tx.missionDefinition.upsert({
      where: { contentReleaseId_key: { contentReleaseId: release.id, key: "starter-scout" } },
      create: {
        id: MISSION_ID,
        contentReleaseId: release.id,
        dropTableId: dropTable.id,
        key: "starter-scout",
        type: MissionType.SALVAGE,
        risk: MissionRisk.GREEN,
        title: "Starter Scout",
        description: "Clear the abandoned trade lane and recover starter salvage.",
        objective: { type: "destroy_all", target: 4, label: "Clear 4 rival salvagers" },
        enemyRoster: [{ definitionKey: "starter-rival-scout", count: 4 }],
        rewardDefinition: { dropTableKey: "starter-salvage" },
        durationSeconds: 90,
      },
      update: {
        dropTableId: dropTable.id,
        type: MissionType.SALVAGE,
        risk: MissionRisk.GREEN,
        title: "Starter Scout",
        description: "Clear the abandoned trade lane and recover starter salvage.",
        objective: { type: "destroy_all", target: 4, label: "Clear 4 rival salvagers" },
        enemyRoster: [{ definitionKey: "starter-rival-scout", count: 4 }],
        rewardDefinition: { dropTableKey: "starter-salvage" },
        durationSeconds: 90,
        enabled: true,
      },
    });

    await tx.missionDefinition.upsert({
      where: { contentReleaseId_key: { contentReleaseId: release.id, key: "ranked-duel" } },
      create: {
        id: PVP_MISSION_ID,
        contentReleaseId: release.id,
        key: "ranked-duel",
        type: MissionType.INTERCEPT,
        risk: MissionRisk.YELLOW,
        title: "Ranked Duel",
        description: "Server-authoritative one-versus-one duel.",
        objective: { type: "destroy_opponent", target: 1, label: "Destroy the opposing ship" },
        enemyRoster: [],
        rewardDefinition: {},
        durationSeconds: 180,
      },
      update: {
        type: MissionType.INTERCEPT,
        risk: MissionRisk.YELLOW,
        title: "Ranked Duel",
        description: "Server-authoritative one-versus-one duel.",
        objective: { type: "destroy_opponent", target: 1, label: "Destroy the opposing ship" },
        enemyRoster: [],
        rewardDefinition: {},
        durationSeconds: 180,
        enabled: true,
      },
    });

    await tx.enemyDefinition.upsert({
      where: {
        contentReleaseId_key: { contentReleaseId: release.id, key: "starter-rival-scout" },
      },
      create: {
        id: "01900000-0000-7000-8000-000000000020",
        contentReleaseId: release.id,
        key: "starter-rival-scout",
        archetype: "scout",
        stats: { hp: 80, speed: 210, damage: 8 },
        behavior: { profile: "orbit-and-fire", preferredRange: 260 },
        loadout: { weapon: "starter-blaster" },
      },
      update: {
        archetype: "scout",
        stats: { hp: 80, speed: 210, damage: 8 },
        behavior: { profile: "orbit-and-fire", preferredRange: 260 },
        loadout: { weapon: "starter-blaster" },
        enabled: true,
      },
    });

    await tx.contentRelease.update({
      where: { id: release.id },
      data: { status: ContentReleaseStatus.PUBLISHED, publishedAt: new Date() },
    });

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
