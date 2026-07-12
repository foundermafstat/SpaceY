import { createHash } from "node:crypto";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createPrismaClient } from "../src/client.js";
import { createUuidV7 } from "../src/uuidv7.js";

const packageDir = fileURLToPath(new URL("..", import.meta.url));
loadEnv({ path: resolve(packageDir, "../../.env") });

if (process.env.SPACEY_SEED_ENV !== "local") {
  throw new Error("Refusing to provision a test fleet outside SPACEY_SEED_ENV=local");
}
const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("Set DIRECT_URL or DATABASE_URL before provisioning");

type Part = Readonly<{ definitionKey: string; x: number; y: number; rotation?: 0 | 90 | 180 | 270 }>;
const presets: ReadonlyArray<Readonly<{ name: string; parts: readonly Part[] }>> = [
  {
    name: "Scout Mk II",
    parts: [
      { definitionKey: "starter-core", x: 0, y: 0 },
      { definitionKey: "starter-blaster", x: 0, y: -1 },
      { definitionKey: "starter-engine", x: 0, y: 1 },
      { definitionKey: "starter-thruster", x: -1, y: 0 },
      { definitionKey: "starter-shield", x: 1, y: 0 },
    ],
  },
  {
    name: "Aegis Escort",
    parts: [
      { definitionKey: "core_mk1", x: 0, y: 0 },
      { definitionKey: "small_reactor", x: 0, y: -1 },
      { definitionKey: "hull_block", x: -1, y: 0 },
      { definitionKey: "hull_block", x: 1, y: 0 },
      { definitionKey: "shield_generator", x: 0, y: 1 },
      { definitionKey: "ion_engine", x: -1, y: 1 },
      { definitionKey: "ion_engine", x: 1, y: 1 },
      { definitionKey: "laser_turret", x: -1, y: -1 },
      { definitionKey: "autocannon", x: 1, y: -1 },
    ],
  },
  {
    name: "Contract Breaker",
    parts: [
      { definitionKey: "starter-core", x: 0, y: 0 },
      { definitionKey: "small_reactor", x: 0, y: -1 },
      { definitionKey: "hull_block", x: -1, y: 0 },
      { definitionKey: "hull_block", x: 1, y: 0 },
      { definitionKey: "starter-blaster", x: -2, y: 0 },
      { definitionKey: "autocannon", x: 2, y: 0 },
      { definitionKey: "starter-shield", x: 0, y: 1 },
      { definitionKey: "starter-engine", x: -1, y: 1 },
      { definitionKey: "ion_engine", x: 1, y: 1 },
      { definitionKey: "starter-thruster", x: 0, y: 2 },
    ],
  },
];

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonical(item)]));
}

const prisma = createPrismaClient(connectionString);
try {
  const user = await prisma.user.findFirst({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  if (!user) throw new Error("No authenticated development user exists");
  const release = await prisma.contentRelease.findFirst({
    where: { status: "PUBLISHED" },
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
  });
  if (!release) throw new Error("No published content release exists");

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('spacey.user_id', ${user.id}, true)`;
    for (const preset of presets) {
      const existing = await tx.shipBuild.findUnique({ where: { userId_name: { userId: user.id, name: preset.name } } });
      if (existing) continue;

      const keys = [...new Set(preset.parts.map((part) => part.definitionKey))];
      const definitions = await tx.moduleDefinition.findMany({
        where: { contentReleaseId: release.id, key: { in: keys }, enabled: true },
      });
      if (definitions.length !== keys.length) throw new Error(`${preset.name} references unavailable definitions`);
      const definitionByKey = new Map(definitions.map((definition) => [definition.key, definition]));
      const occupied = new Set<string>();
      let totalMass = 0;
      let output = 0;
      let draw = 0;
      for (const part of preset.parts) {
        const coordinate = `${part.x}:${part.y}`;
        if (occupied.has(coordinate)) throw new Error(`${preset.name} contains overlapping parts`);
        occupied.add(coordinate);
        const stats = definitionByKey.get(part.definitionKey)?.stats as Record<string, unknown>;
        totalMass += Number.isInteger(stats.mass) ? Number(stats.mass) : 0;
        output += Number.isInteger(stats.powerOutput) ? Number(stats.powerOutput) : 0;
        draw += Number.isInteger(stats.powerDraw) ? Number(stats.powerDraw) : 0;
      }

      const buildId = createUuidV7();
      const revisionId = createUuidV7();
      const installed = [];
      for (const [index, part] of preset.parts.entries()) {
        const inventoryItemId = createUuidV7();
        await tx.inventoryItem.create({
          data: {
            id: inventoryItemId,
            userId: user.id,
            contentReleaseId: release.id,
            definitionKey: part.definitionKey,
            state: "INSTALLED",
            metadata: { source: "dev_fleet_provisioner", preset: preset.name },
          },
        });
        installed.push({ inventoryItemId, definitionId: part.definitionKey, gridX: part.x, gridY: part.y, rotation: part.rotation ?? 0 });
        await tx.inventoryTransition.create({
          data: {
            id: createUuidV7(), userId: user.id, inventoryItemId, fromState: null, toState: "INSTALLED",
            sourceType: "dev_fleet_provisioner", sourceId: buildId,
            idempotencyKey: createHash("sha256").update(`dev-fleet:${user.id}:${preset.name}:${index}`).digest("hex"),
            metadata: { preset: preset.name },
          },
        });
      }
      const snapshot = { schemaVersion: 3, name: preset.name, parts: installed };
      const snapshotHash = createHash("sha256").update(JSON.stringify(canonical(snapshot))).digest("hex");
      await tx.shipBuild.create({ data: { id: buildId, userId: user.id, name: preset.name } });
      await tx.shipBuildRevision.create({
        data: {
          id: revisionId, buildId, contentReleaseId: release.id, version: 1, schemaVersion: 3,
          snapshot, snapshotHash, totalMass, totalPower: Math.max(0, output - draw),
          installedItems: { create: installed.map((part) => ({
            id: createUuidV7(), inventoryItemId: part.inventoryItemId,
            slotKey: `part:${part.inventoryItemId}`,
            placement: { gridX: part.gridX, gridY: part.gridY, rotation: part.rotation },
          })) },
        },
      });
      await tx.shipBuild.update({ where: { id: buildId }, data: { currentRevisionId: revisionId } });
    }
  });
  console.log(`Development fleet ready for user ${user.id}: ${presets.map((preset) => preset.name).join(", ")}`);
} finally {
  await prisma.$disconnect();
}
