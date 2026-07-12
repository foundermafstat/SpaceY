import assert from "node:assert/strict";
import test from "node:test";
import type { AdminDatabase, AdminSqlClient } from "../src/persistence/admin-database.js";
import {
  AdminContentReleaseRepository,
  contentConfigHash,
  type ContentReleaseSnapshot,
  validateContentReleaseSnapshot,
} from "../src/content/content-release.repository.js";

const RELEASE_ID = "01900000-0000-7000-8000-000000000201";
const DROP_TABLE_ID = "01900000-0000-7000-8000-000000000202";

function queryResult(rows: readonly unknown[] = [], rowCount = rows.length) {
  return { rows, rowCount } as never;
}

function snapshot(overrides: Partial<ContentReleaseSnapshot> = {}): ContentReleaseSnapshot {
  return {
    release: {
      id: RELEASE_ID,
      version: "2026.07.test-v1",
      status: "DRAFT",
      config_hash: "a".repeat(64),
      schema_version: 1,
      bootstrap_config: { starterMissionKey: "starter", simulationVersion: "1.0.0" },
      notes: null,
      created_by_admin_id: null,
      published_at: null,
      created_at: "2026-07-11T00:00:00.000Z",
      updated_at: "2026-07-11T00:00:00.000Z",
    },
    missions: [{
      id: "01900000-0000-7000-8000-000000000203",
      drop_table_id: DROP_TABLE_ID,
      key: "starter",
      type: "SALVAGE",
      risk: "GREEN",
      title: "Starter",
      description: "Starter mission",
      objective: { type: "destroy_all", target: 1 },
      enemy_roster: [{ definitionKey: "scout", count: 1 }],
      reward_definition: { dropTableKey: "starter-drops" },
      duration_seconds: 60,
      enabled: true,
    }],
    modules: [{
      id: "01900000-0000-7000-8000-000000000204",
      key: "laser",
      category: "weapons",
      kind: "energy-weapon",
      rarity: "common",
      shape: { cells: [[0, 0]] },
      stats: { hp: 100, damage: 10, repairCostCredits: 100 },
      damage_states: { thresholdsBps: { destroyed: 0 } },
      enabled: true,
    }],
    enemies: [{
      id: "01900000-0000-7000-8000-000000000205",
      key: "scout",
      archetype: "scout",
      stats: { hp: 80 },
      behavior: { profile: "orbit" },
      loadout: { weapon: "laser" },
      enabled: true,
    }],
    dropTables: [{ id: DROP_TABLE_ID, key: "starter-drops", entries: [{ kind: "item", definitionKey: "laser" }], enabled: true }],
    research: [],
    achievements: [],
    ...overrides,
  };
}

test("semantic validation accepts a self-contained release and computes a canonical hash", () => {
  const original = snapshot();
  const reordered = snapshot({
    modules: [{ ...original.modules[0]!, stats: { damage: 10, hp: 100, repairCostCredits: 100 } }],
    release: { ...original.release, bootstrap_config: { simulationVersion: "1.0.0", starterMissionKey: "starter" } },
  });
  const result = validateContentReleaseSnapshot(original);
  assert.equal(result.valid, true);
  assert.equal(result.violations.length, 0);
  assert.match(result.configHash, /^[a-f0-9]{64}$/);
  assert.equal(contentConfigHash(original), contentConfigHash(reordered));
});

test("semantic validation rejects unsupported objectives and cross-reference gaps", () => {
  const original = snapshot();
  const invalid = snapshot({
    missions: [{
      ...original.missions[0]!,
      objective: { type: "collect_scrap", target: 2 },
      enemy_roster: [{ definitionKey: "missing", count: 1 }],
    }],
  });
  const codes = new Set(validateContentReleaseSnapshot(invalid).violations.map((item) => item.code));
  assert.equal(codes.has("OBJECTIVE_UNSUPPORTED"), true);
  assert.equal(codes.has("ENEMY_ROSTER_REFERENCE_INVALID"), true);
});

test("semantic validation rejects enabled modules without a bounded repair price", () => {
  const original = snapshot();
  const missingPrice = snapshot({
    modules: [{ ...original.modules[0]!, stats: { hp: 100, damage: 10 } }],
  });
  const excessivePrice = snapshot({
    modules: [{ ...original.modules[0]!, stats: { hp: 100, damage: 10, repairCostCredits: 1_000_000_001 } }],
  });

  assert.ok(validateContentReleaseSnapshot(missingPrice).violations
    .some((item) => item.code === "MODULE_REPAIR_COST_INVALID"));
  assert.ok(validateContentReleaseSnapshot(excessivePrice).violations
    .some((item) => item.code === "MODULE_REPAIR_COST_INVALID"));
});

test("simulation v2 accepts protect and collect objectives but rejects unimplemented types", () => {
  const original = snapshot();
  const v2Release = {
    ...original.release,
    bootstrap_config: { starterMissionKey: "starter", simulationVersion: "2.0.0" },
  };
  const protect = snapshot({
    release: v2Release,
    missions: [{
      ...original.missions[0]!,
      objective: {
        type: "protect_target",
        target: 30,
        targetHull: 600,
        collisionRadiusUnits: 48,
      },
    }],
  });
  assert.equal(validateContentReleaseSnapshot(protect).valid, true);

  const collect = snapshot({
    release: v2Release,
    missions: [{
      ...original.missions[0]!,
      objective: {
        type: "collect_scrap",
        target: 5,
        scrapCount: 7,
        collectionRadiusUnits: 36,
      },
    }],
  });
  assert.equal(validateContentReleaseSnapshot(collect).valid, true);

  const unsupported = snapshot({
    release: v2Release,
    missions: [{ ...original.missions[0]!, objective: { type: "hold_position", target: 10 } }],
  });
  assert.ok(validateContentReleaseSnapshot(unsupported).violations.some((item) => item.code === "OBJECTIVE_UNSUPPORTED"));
});

test("publication retires the prior release and commits audit plus outbox in one transaction", async () => {
  const source = snapshot();
  const statements: string[] = [];
  const client: AdminSqlClient = {
    query: async (sql) => {
      statements.push(sql);
      if (sql.includes("FROM content_releases WHERE id")) return queryResult([source.release]);
      if (sql.includes("FROM mission_definitions WHERE")) return queryResult(source.missions);
      if (sql.includes("FROM module_definitions WHERE")) return queryResult(source.modules);
      if (sql.includes("FROM enemy_definitions WHERE")) return queryResult(source.enemies);
      if (sql.includes("FROM drop_tables") && sql.includes("ORDER BY key")) return queryResult(source.dropTables);
      if (sql.includes("FROM research_definitions")) return queryResult([]);
      if (sql.includes("FROM achievement_definitions")) return queryResult([]);
      if (sql.includes("SET status = 'RETIRED'")) return queryResult([{ ...source.release, id: "01900000-0000-7000-8000-000000000206", status: "RETIRED" }], 1);
      if (sql.includes("SET status = 'PUBLISHED'")) {
        return queryResult([{ ...source.release, status: "PUBLISHED", config_hash: contentConfigHash(source), published_at: new Date() }], 1);
      }
      return queryResult([], 1);
    },
  };
  let transactions = 0;
  const database: AdminDatabase = {
    query: async () => queryResult(),
    transaction: async (operation) => {
      transactions += 1;
      return operation(client);
    },
    close: async () => undefined,
  };
  const repository = new AdminContentReleaseRepository(database);
  const result = await repository.publish(
    RELEASE_ID,
    "Promote validated content",
    "01900000-0000-7000-8000-000000000207",
    {
      adminId: "01900000-0000-7000-8000-000000000208",
      sessionId: "01900000-0000-7000-8000-000000000209",
      role: "ContentEditor",
      authenticationMethod: "webauthn",
    },
  );

  assert.equal(transactions, 1);
  assert.equal(result.status, "PUBLISHED");
  const retireIndex = statements.findIndex((sql) => sql.includes("SET status = 'RETIRED'"));
  const publishIndex = statements.findIndex((sql) => sql.includes("SET status = 'PUBLISHED'"));
  assert.ok(retireIndex >= 0 && publishIndex > retireIndex);
  assert.equal(statements.some((sql) => sql.includes("INSERT INTO admin_audit_logs")), true);
  assert.equal(statements.some((sql) => sql.includes("INSERT INTO outbox_events")), true);
});
