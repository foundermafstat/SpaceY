import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { createUuidV7 } from "@spacey/db";
import { createHash } from "node:crypto";
import type { AuditActor } from "../audit/admin-mutation.port.js";
import { ADMIN_DATABASE, type AdminDatabase, type AdminSqlClient } from "../persistence/admin-database.js";

export type ContentReleaseStatus = "DRAFT" | "PUBLISHED" | "RETIRED";

type ReleaseRow = Readonly<{
  id: string;
  version: string;
  status: ContentReleaseStatus;
  config_hash: string;
  schema_version: number;
  bootstrap_config: unknown;
  notes: string | null;
  created_by_admin_id: string | null;
  published_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}>;

type MissionRow = Readonly<{
  id: string;
  drop_table_id: string | null;
  key: string;
  type: string;
  risk: string;
  title: string;
  description: string;
  objective: unknown;
  enemy_roster: unknown;
  reward_definition: unknown;
  duration_seconds: number;
  enabled: boolean;
}>;

type ModuleRow = Readonly<{
  id: string;
  key: string;
  category: string;
  kind: string;
  rarity: string;
  shape: unknown;
  stats: unknown;
  damage_states: unknown;
  enabled: boolean;
}>;

type EnemyRow = Readonly<{
  id: string;
  key: string;
  archetype: string;
  stats: unknown;
  behavior: unknown;
  loadout: unknown;
  enabled: boolean;
}>;

type DropTableRow = Readonly<{
  id: string;
  key: string;
  entries: unknown;
  enabled: boolean;
}>;

type ResearchRow = Readonly<{
  id: string;
  key: string;
  cost: unknown;
  prerequisites: unknown;
  effects: unknown;
}>;

type AchievementRow = Readonly<{
  id: string;
  key: string;
  criteria: unknown;
  rewards: unknown;
  hidden: boolean;
}>;

export type ContentReleaseSnapshot = Readonly<{
  release: ReleaseRow;
  missions: readonly MissionRow[];
  modules: readonly ModuleRow[];
  enemies: readonly EnemyRow[];
  dropTables: readonly DropTableRow[];
  research: readonly ResearchRow[];
  achievements: readonly AchievementRow[];
}>;

export type ContentValidationViolation = Readonly<{
  code: string;
  path: string;
  message: string;
}>;

export type ContentValidationResult = Readonly<{
  releaseId: string;
  valid: boolean;
  configHash: string;
  simulationVersion: string;
  violations: readonly ContentValidationViolation[];
}>;

export type ContentReleaseSummary = Readonly<{
  id: string;
  version: string;
  status: ContentReleaseStatus;
  configHash: string;
  schemaVersion: number;
  notes: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  counts: Readonly<{
    missions: number;
    modules: number;
    enemies: number;
    dropTables: number;
  }>;
}>;

type ReleaseSummaryRow = Readonly<{
  id: string;
  version: string;
  status: ContentReleaseStatus;
  config_hash: string;
  schema_version: number;
  notes: string | null;
  published_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  mission_count: string;
  module_count: string;
  enemy_count: string;
  drop_table_count: string;
}>;

export type ContentHistoryEntry = Readonly<{
  kind: "release" | "definition";
  action: string;
  resourceType: string;
  resourceId: string;
  revision: number | null;
  reason: string;
  actorAdminId: string | null;
  correlationId: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
}>;

type ReleaseHistoryRow = Readonly<{
  action: string;
  resource_type: string;
  resource_id: string;
  reason: string;
  admin_user_id: string | null;
  correlation_id: string;
  before_state: unknown;
  after_state: unknown;
  created_at: Date | string;
}>;

type DefinitionHistoryRow = Readonly<{
  resource_type: string;
  resource_id: string;
  revision: number;
  reason: string;
  created_by_admin_id: string | null;
  before_state: unknown;
  after_state: unknown;
  created_at: Date | string;
}>;

const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/;
const SUPPORTED_OBJECTIVES: Readonly<Record<string, ReadonlySet<string>>> = {
  "1": new Set(["destroy_all", "survive_seconds", "destroy_opponent"]),
  "2": new Set([
    "destroy_all",
    "survive_seconds",
    "collect_scrap",
    "protect_target",
    "destroy_opponent",
  ]),
};
const MAX_REPAIR_COST_CREDITS = 1_000_000_000;

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new UnprocessableEntityException("Content contains a non-finite number");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  const record = objectValue(value);
  if (!record) throw new UnprocessableEntityException("Content contains a non-JSON value");
  return Object.fromEntries(
    Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]),
  );
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalReleaseConfig(snapshot: ContentReleaseSnapshot): unknown {
  const dropTableKeyById = new Map(snapshot.dropTables.map((table) => [table.id, table.key]));
  return {
    version: snapshot.release.version,
    schemaVersion: snapshot.release.schema_version,
    bootstrapConfig: snapshot.release.bootstrap_config,
    missions: snapshot.missions.map((mission) => ({
      key: mission.key,
      dropTableKey: mission.drop_table_id ? dropTableKeyById.get(mission.drop_table_id) ?? null : null,
      type: mission.type,
      risk: mission.risk,
      title: mission.title,
      description: mission.description,
      objective: mission.objective,
      enemyRoster: mission.enemy_roster,
      rewardDefinition: mission.reward_definition,
      durationSeconds: mission.duration_seconds,
      enabled: mission.enabled,
    })),
    modules: snapshot.modules.map((module) => ({
      key: module.key,
      category: module.category,
      kind: module.kind,
      rarity: module.rarity,
      shape: module.shape,
      stats: module.stats,
      damageStates: module.damage_states,
      enabled: module.enabled,
    })),
    enemies: snapshot.enemies.map((enemy) => ({
      key: enemy.key,
      archetype: enemy.archetype,
      stats: enemy.stats,
      behavior: enemy.behavior,
      loadout: enemy.loadout,
      enabled: enemy.enabled,
    })),
    dropTables: snapshot.dropTables.map((table) => ({ key: table.key, entries: table.entries, enabled: table.enabled })),
    research: snapshot.research.map((definition) => ({
      key: definition.key,
      cost: definition.cost,
      prerequisites: definition.prerequisites,
      effects: definition.effects,
    })),
    achievements: snapshot.achievements.map((definition) => ({
      key: definition.key,
      criteria: definition.criteria,
      rewards: definition.rewards,
      hidden: definition.hidden,
    })),
  };
}

export function contentConfigHash(snapshot: ContentReleaseSnapshot): string {
  return createHash("sha256").update(canonicalJson(canonicalReleaseConfig(snapshot)), "utf8").digest("hex");
}

function pushViolation(
  violations: ContentValidationViolation[],
  code: string,
  path: string,
  message: string,
): void {
  violations.push({ code, path, message });
}

function positiveInteger(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) > 0;
}

function simulationVersion(snapshot: ContentReleaseSnapshot): string {
  const bootstrap = objectValue(snapshot.release.bootstrap_config);
  const configured = bootstrap?.simulationVersion;
  return typeof configured === "string" && /^\d+\.\d+\.\d+$/.test(configured) ? configured : "1.0.0";
}

export function validateContentReleaseSnapshot(snapshot: ContentReleaseSnapshot): ContentValidationResult {
  const violations: ContentValidationViolation[] = [];
  const moduleKeys = new Set(snapshot.modules.filter((item) => item.enabled).map((item) => item.key));
  const enemyKeys = new Set(snapshot.enemies.filter((item) => item.enabled).map((item) => item.key));
  const dropTableIds = new Set(snapshot.dropTables.filter((item) => item.enabled).map((item) => item.id));
  const dropTableKeys = new Set(snapshot.dropTables.filter((item) => item.enabled).map((item) => item.key));
  const missionKeys = new Set(snapshot.missions.filter((item) => item.enabled).map((item) => item.key));
  const version = simulationVersion(snapshot);
  const supported = SUPPORTED_OBJECTIVES[version.split(".")[0] ?? ""] ?? new Set<string>();

  if (snapshot.modules.length === 0) pushViolation(violations, "MODULES_EMPTY", "modules", "At least one module is required.");
  if (snapshot.missions.length === 0) pushViolation(violations, "MISSIONS_EMPTY", "missions", "At least one mission is required.");
  if (supported.size === 0) {
    pushViolation(violations, "SIMULATION_VERSION_UNSUPPORTED", "bootstrapConfig.simulationVersion", `Simulation ${version} is not supported.`);
  }

  for (const [index, module] of snapshot.modules.entries()) {
    const shape = objectValue(module.shape);
    const cells = shape?.cells;
    if (!Array.isArray(cells) || cells.length === 0 || cells.some((cell) =>
      !Array.isArray(cell) || cell.length !== 2 || !cell.every(Number.isInteger))) {
      pushViolation(violations, "MODULE_SHAPE_INVALID", `modules[${index}].shape.cells`, "Shape requires integer [x,y] cells.");
    }
    const stats = objectValue(module.stats);
    if (!stats || !positiveInteger(stats.hp)) {
      pushViolation(violations, "MODULE_HP_INVALID", `modules[${index}].stats.hp`, "Module HP must be a positive integer.");
    }
    if (module.enabled && (!stats
      || !positiveInteger(stats.repairCostCredits)
      || Number(stats.repairCostCredits) > MAX_REPAIR_COST_CREDITS)) {
      pushViolation(
        violations,
        "MODULE_REPAIR_COST_INVALID",
        `modules[${index}].stats.repairCostCredits`,
        `Enabled module repair cost must be an integer between 1 and ${MAX_REPAIR_COST_CREDITS}.`,
      );
    }
    if (stats && Object.entries(stats).some(([, value]) => typeof value === "number" && value < 0)) {
      pushViolation(violations, "MODULE_STATS_NEGATIVE", `modules[${index}].stats`, "Module numeric stats cannot be negative.");
    }
  }

  for (const [index, enemy] of snapshot.enemies.entries()) {
    const stats = objectValue(enemy.stats);
    if (!stats || !positiveInteger(stats.hp)) {
      pushViolation(violations, "ENEMY_HP_INVALID", `enemies[${index}].stats.hp`, "Enemy HP must be a positive integer.");
    }
    const loadout = objectValue(enemy.loadout);
    const weapon = loadout?.weapon;
    if (typeof weapon === "string" && !moduleKeys.has(weapon)) {
      pushViolation(violations, "ENEMY_WEAPON_UNKNOWN", `enemies[${index}].loadout.weapon`, `Unknown module ${weapon}.`);
    }
  }

  for (const [index, table] of snapshot.dropTables.entries()) {
    if (!Array.isArray(table.entries)) {
      pushViolation(violations, "DROP_TABLE_ENTRIES_INVALID", `dropTables[${index}].entries`, "Entries must be an array.");
      continue;
    }
    for (const [entryIndex, rawEntry] of table.entries.entries()) {
      const entry = objectValue(rawEntry);
      if (!entry || typeof entry.kind !== "string") {
        pushViolation(violations, "DROP_ENTRY_INVALID", `dropTables[${index}].entries[${entryIndex}]`, "Drop entry requires a kind.");
        continue;
      }
      if (entry.kind === "item" && (typeof entry.definitionKey !== "string" || !moduleKeys.has(entry.definitionKey))) {
        pushViolation(violations, "DROP_ITEM_UNKNOWN", `dropTables[${index}].entries[${entryIndex}].definitionKey`, "Drop item must reference an enabled module.");
      }
      if (entry.kind === "currency" && !["CREDITS", "SCRAP", "ALLOY", "DATA_SHARDS"].includes(String(entry.currency))) {
        pushViolation(violations, "DROP_CURRENCY_INVALID", `dropTables[${index}].entries[${entryIndex}].currency`, "Drop currency is not supported.");
      }
      if (entry.weight !== undefined && !positiveInteger(entry.weight)) {
        pushViolation(violations, "DROP_WEIGHT_INVALID", `dropTables[${index}].entries[${entryIndex}].weight`, "Drop weight must be a positive integer.");
      }
      if (entry.chanceBps !== undefined && (!Number.isInteger(entry.chanceBps) || Number(entry.chanceBps) < 0 || Number(entry.chanceBps) > 10_000)) {
        pushViolation(violations, "DROP_CHANCE_INVALID", `dropTables[${index}].entries[${entryIndex}].chanceBps`, "Drop chance must be 0-10000 basis points.");
      }
    }
  }

  for (const [index, mission] of snapshot.missions.entries()) {
    const objective = objectValue(mission.objective);
    const objectiveType = objective?.type;
    if (typeof objectiveType !== "string" || !supported.has(objectiveType)) {
      pushViolation(violations, "OBJECTIVE_UNSUPPORTED", `missions[${index}].objective.type`, `Objective ${String(objectiveType)} is not supported by ${version}.`);
    }
    if (!objective || !positiveInteger(objective.target)) {
      pushViolation(violations, "OBJECTIVE_TARGET_INVALID", `missions[${index}].objective.target`, "Objective target must be a positive integer.");
    }
    const rosterTotal = Array.isArray(mission.enemy_roster)
      ? mission.enemy_roster.reduce((sum, rawEntry) => {
          const entry = objectValue(rawEntry);
          return sum + (entry && positiveInteger(entry.count) ? Number(entry.count) : 0);
        }, 0)
      : 0;
    if (objectiveType === "destroy_all" && Number(objective?.target) !== rosterTotal) {
      pushViolation(violations, "DESTROY_ALL_ROSTER_MISMATCH", `missions[${index}].objective.target`, "Destroy-all target must equal the complete enemy roster.");
    }
    if ((objectiveType === "survive_seconds" || objectiveType === "protect_target")
      && Number(objective?.target) > mission.duration_seconds) {
      pushViolation(violations, "OBJECTIVE_DURATION_INVALID", `missions[${index}].objective.target`, "Timed objective cannot exceed mission duration.");
    }
    if (objectiveType === "protect_target") {
      if (!positiveInteger(objective?.targetHull)) {
        pushViolation(violations, "PROTECT_TARGET_HULL_INVALID", `missions[${index}].objective.targetHull`, "Protected target requires positive hull.");
      }
      if (!positiveInteger(objective?.collisionRadiusUnits)) {
        pushViolation(violations, "PROTECT_TARGET_RADIUS_INVALID", `missions[${index}].objective.collisionRadiusUnits`, "Protected target requires a positive collision radius.");
      }
    }
    if (objectiveType === "collect_scrap") {
      if (!positiveInteger(objective?.scrapCount) || Number(objective?.scrapCount) < Number(objective?.target)) {
        pushViolation(violations, "COLLECT_SCRAP_POPULATION_INVALID", `missions[${index}].objective.scrapCount`, "Scrap population must cover the collection target.");
      }
      if (!positiveInteger(objective?.collectionRadiusUnits)) {
        pushViolation(violations, "COLLECT_SCRAP_RADIUS_INVALID", `missions[${index}].objective.collectionRadiusUnits`, "Scrap collection radius must be positive.");
      }
    }
    if (mission.drop_table_id && !dropTableIds.has(mission.drop_table_id)) {
      pushViolation(violations, "MISSION_DROP_TABLE_INVALID", `missions[${index}].dropTableId`, "Mission must reference an enabled drop table in the same release.");
    }
    const reward = objectValue(mission.reward_definition);
    if (typeof reward?.dropTableKey === "string" && !dropTableKeys.has(reward.dropTableKey)) {
      pushViolation(violations, "MISSION_REWARD_TABLE_UNKNOWN", `missions[${index}].rewardDefinition.dropTableKey`, "Reward definition must reference an enabled drop table.");
    }
    if (!Array.isArray(mission.enemy_roster)) {
      pushViolation(violations, "ENEMY_ROSTER_INVALID", `missions[${index}].enemyRoster`, "Enemy roster must be an array.");
    } else {
      for (const [rosterIndex, rawEntry] of mission.enemy_roster.entries()) {
        const entry = objectValue(rawEntry);
        if (!entry || typeof entry.definitionKey !== "string" || !enemyKeys.has(entry.definitionKey)) {
          pushViolation(violations, "ENEMY_ROSTER_REFERENCE_INVALID", `missions[${index}].enemyRoster[${rosterIndex}].definitionKey`, "Roster must reference an enabled enemy.");
        }
        if (!entry || !positiveInteger(entry.count)) {
          pushViolation(violations, "ENEMY_ROSTER_COUNT_INVALID", `missions[${index}].enemyRoster[${rosterIndex}].count`, "Roster count must be a positive integer.");
        }
      }
    }
  }

  const bootstrap = objectValue(snapshot.release.bootstrap_config);
  if (bootstrap) {
    if (typeof bootstrap.starterMissionKey === "string" && !missionKeys.has(bootstrap.starterMissionKey)) {
      pushViolation(violations, "STARTER_MISSION_UNKNOWN", "bootstrapConfig.starterMissionKey", "Starter mission must exist and be enabled.");
    }
    if (Array.isArray(bootstrap.starterInventory)) {
      bootstrap.starterInventory.forEach((rawItem, index) => {
        const item = objectValue(rawItem);
        if (!item || typeof item.definitionKey !== "string" || !moduleKeys.has(item.definitionKey)) {
          pushViolation(violations, "STARTER_MODULE_UNKNOWN", `bootstrapConfig.starterInventory[${index}].definitionKey`, "Starter inventory must reference an enabled module.");
        }
      });
    }
    const buildTemplate = objectValue(bootstrap.starterBuildTemplate);
    if (Array.isArray(buildTemplate?.modules)) {
      buildTemplate.modules.forEach((rawItem, index) => {
        const item = objectValue(rawItem);
        if (!item || typeof item.definitionKey !== "string" || !moduleKeys.has(item.definitionKey)) {
          pushViolation(violations, "STARTER_BUILD_MODULE_UNKNOWN", `bootstrapConfig.starterBuildTemplate.modules[${index}].definitionKey`, "Starter build must reference an enabled module.");
        }
      });
    }
  }

  const researchKeys = new Set(snapshot.research.map((item) => item.key));
  snapshot.research.forEach((definition, index) => {
    if (!Array.isArray(definition.prerequisites)) {
      pushViolation(violations, "RESEARCH_PREREQUISITES_INVALID", `research[${index}].prerequisites`, "Research prerequisites must be an array.");
      return;
    }
    definition.prerequisites.forEach((rawPrerequisite, prerequisiteIndex) => {
      const key = typeof rawPrerequisite === "string"
        ? rawPrerequisite
        : objectValue(rawPrerequisite)?.definitionKey;
      if (typeof key !== "string" || !researchKeys.has(key) || key === definition.key) {
        pushViolation(violations, "RESEARCH_PREREQUISITE_UNKNOWN", `research[${index}].prerequisites[${prerequisiteIndex}]`, "Research prerequisite must reference another definition in this release.");
      }
    });
  });

  return {
    releaseId: snapshot.release.id,
    valid: violations.length === 0,
    configHash: contentConfigHash(snapshot),
    simulationVersion: version,
    violations,
  };
}

function draftHash(id: string): string {
  return createHash("sha256").update(`draft:${id}`, "utf8").digest("hex");
}

function auditIdempotencyKey(correlationId: string, action: string, releaseId: string): string {
  return createHash("sha256").update(`${correlationId}:${action}:content-release:${releaseId}`, "utf8").digest("hex");
}

async function appendReleaseAudit(
  client: AdminSqlClient,
  input: Readonly<{
    action: string;
    releaseId: string;
    reason: string;
    correlationId: string;
    before: unknown;
    after: unknown;
    actor: AuditActor;
  }>,
): Promise<void> {
  await client.query(
    `INSERT INTO admin_audit_logs
       (id, admin_user_id, admin_session_id, authentication_method, actor_role, action, resource_type,
        resource_id, before_state, after_state, reason, correlation_id, idempotency_key)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::admin_authentication_method, $5, $6, 'content-release', $7,
             $8::jsonb, $9::jsonb, $10, $11::uuid, $12)`,
    [
      createUuidV7(),
      input.actor.adminId,
      input.actor.sessionId,
      input.actor.authenticationMethod === "webauthn" ? "WEBAUTHN" : "TOTP_RECOVERY",
      input.actor.role,
      input.action,
      input.releaseId,
      JSON.stringify(input.before),
      JSON.stringify(input.after),
      input.reason,
      input.correlationId,
      auditIdempotencyKey(input.correlationId, input.action, input.releaseId),
    ],
  );
}

async function loadSnapshot(client: AdminSqlClient, releaseId: string, lock: "none" | "share" | "update"): Promise<ContentReleaseSnapshot> {
  const lockClause = lock === "update" ? " FOR UPDATE" : lock === "share" ? " FOR SHARE" : "";
  const releaseResult = await client.query<ReleaseRow>(
    `SELECT id, version, status::text, config_hash, schema_version, bootstrap_config, notes,
            created_by_admin_id, published_at, created_at, updated_at
     FROM content_releases WHERE id = $1::uuid${lockClause}`,
    [releaseId],
  );
  const release = releaseResult.rows[0];
  if (!release) throw new NotFoundException("Content release was not found");

  const missions = await client.query<MissionRow>(
    `SELECT id, drop_table_id, key, type::text, risk::text, title, description, objective,
            enemy_roster, reward_definition, duration_seconds, enabled
     FROM mission_definitions WHERE content_release_id = $1::uuid ORDER BY key, id`,
    [releaseId],
  );
  const modules = await client.query<ModuleRow>(
    `SELECT id, key, category, kind, rarity, shape, stats, damage_states, enabled
     FROM module_definitions WHERE content_release_id = $1::uuid ORDER BY key, id`,
    [releaseId],
  );
  const enemies = await client.query<EnemyRow>(
    `SELECT id, key, archetype, stats, behavior, loadout, enabled
     FROM enemy_definitions WHERE content_release_id = $1::uuid ORDER BY key, id`,
    [releaseId],
  );
  const dropTables = await client.query<DropTableRow>(
    `SELECT id, key, entries, enabled FROM drop_tables
     WHERE content_release_id = $1::uuid ORDER BY key, id`,
    [releaseId],
  );
  const research = await client.query<ResearchRow>(
    `SELECT id, key, cost, prerequisites, effects FROM research_definitions
     WHERE content_release_id = $1::uuid ORDER BY key, id`,
    [releaseId],
  );
  const achievements = await client.query<AchievementRow>(
    `SELECT id, key, criteria, rewards, hidden FROM achievement_definitions
     WHERE content_release_id = $1::uuid ORDER BY key, id`,
    [releaseId],
  );

  return {
    release,
    missions: missions.rows,
    modules: modules.rows,
    enemies: enemies.rows,
    dropTables: dropTables.rows,
    research: research.rows,
    achievements: achievements.rows,
  };
}

function releaseState(snapshot: ContentReleaseSnapshot): unknown {
  return {
    id: snapshot.release.id,
    version: snapshot.release.version,
    status: snapshot.release.status,
    configHash: snapshot.release.config_hash,
    schemaVersion: snapshot.release.schema_version,
    counts: {
      missions: snapshot.missions.length,
      modules: snapshot.modules.length,
      enemies: snapshot.enemies.length,
      dropTables: snapshot.dropTables.length,
    },
  };
}

async function cloneSnapshot(
  client: AdminSqlClient,
  source: ContentReleaseSnapshot,
  version: string,
  actor: AuditActor,
): Promise<string> {
  if (!VERSION_PATTERN.test(version)) {
    throw new UnprocessableEntityException("Version must be 3-80 URL-safe characters");
  }
  if (source.release.status === "DRAFT") {
    throw new ConflictException("Only published or retired releases can be cloned");
  }

  const releaseId = createUuidV7();
  try {
    await client.query(
      `INSERT INTO content_releases
         (id, version, status, config_hash, schema_version, bootstrap_config, notes, created_by_admin_id, updated_at)
       VALUES ($1::uuid, $2, 'DRAFT', $3, $4, $5::jsonb, $6, $7::uuid, now())`,
      [
        releaseId,
        version,
        draftHash(releaseId),
        source.release.schema_version,
        JSON.stringify(source.release.bootstrap_config),
        `Cloned from ${source.release.version}${source.release.notes ? ` — ${source.release.notes}` : ""}`,
        actor.adminId,
      ],
    );
  } catch (error) {
    const code = objectValue(error)?.code;
    if (code === "23505") throw new ConflictException("Content release version already exists");
    throw error;
  }

  const dropTableIdMap = new Map<string, string>();
  for (const table of source.dropTables) {
    const id = createUuidV7();
    dropTableIdMap.set(table.id, id);
    await client.query(
      `INSERT INTO drop_tables (id, content_release_id, key, entries, enabled, updated_at)
       VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5, now())`,
      [id, releaseId, table.key, JSON.stringify(table.entries), table.enabled],
    );
  }
  for (const module of source.modules) {
    await client.query(
      `INSERT INTO module_definitions
         (id, content_release_id, key, category, kind, rarity, shape, stats, damage_states, enabled, updated_at)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, now())`,
      [createUuidV7(), releaseId, module.key, module.category, module.kind, module.rarity,
        JSON.stringify(module.shape), JSON.stringify(module.stats), JSON.stringify(module.damage_states), module.enabled],
    );
  }
  for (const enemy of source.enemies) {
    await client.query(
      `INSERT INTO enemy_definitions
         (id, content_release_id, key, archetype, stats, behavior, loadout, enabled, updated_at)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, now())`,
      [createUuidV7(), releaseId, enemy.key, enemy.archetype, JSON.stringify(enemy.stats),
        JSON.stringify(enemy.behavior), JSON.stringify(enemy.loadout), enemy.enabled],
    );
  }
  for (const mission of source.missions) {
    const clonedDropTableId = mission.drop_table_id ? dropTableIdMap.get(mission.drop_table_id) : null;
    if (mission.drop_table_id && !clonedDropTableId) {
      throw new UnprocessableEntityException(`Mission ${mission.key} references a drop table outside its release`);
    }
    await client.query(
      `INSERT INTO mission_definitions
         (id, content_release_id, drop_table_id, key, type, risk, title, description, objective,
          enemy_roster, reward_definition, duration_seconds, enabled, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::mission_type, $6::mission_risk, $7, $8, $9::jsonb,
               $10::jsonb, $11::jsonb, $12, $13, now())`,
      [createUuidV7(), releaseId, clonedDropTableId,
        mission.key, mission.type, mission.risk, mission.title, mission.description, JSON.stringify(mission.objective),
        JSON.stringify(mission.enemy_roster), JSON.stringify(mission.reward_definition), mission.duration_seconds, mission.enabled],
    );
  }
  for (const definition of source.research) {
    await client.query(
      `INSERT INTO research_definitions
         (id, content_release_id, key, cost, prerequisites, effects, updated_at)
       VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5::jsonb, $6::jsonb, now())`,
      [createUuidV7(), releaseId, definition.key, JSON.stringify(definition.cost),
        JSON.stringify(definition.prerequisites), JSON.stringify(definition.effects)],
    );
  }
  for (const definition of source.achievements) {
    await client.query(
      `INSERT INTO achievement_definitions
         (id, content_release_id, key, criteria, rewards, hidden, updated_at)
       VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5::jsonb, $6, now())`,
      [createUuidV7(), releaseId, definition.key, JSON.stringify(definition.criteria),
        JSON.stringify(definition.rewards), definition.hidden],
    );
  }
  return releaseId;
}

@Injectable()
export class AdminContentReleaseRepository {
  constructor(@Inject(ADMIN_DATABASE) private readonly database: AdminDatabase) {}

  async list(): Promise<readonly ContentReleaseSummary[]> {
    const result = await this.database.query<ReleaseSummaryRow>(
      `SELECT release.id, release.version, release.status::text, release.config_hash, release.schema_version,
              release.notes, release.published_at, release.created_at, release.updated_at,
              (SELECT count(*)::text FROM mission_definitions WHERE content_release_id = release.id) AS mission_count,
              (SELECT count(*)::text FROM module_definitions WHERE content_release_id = release.id) AS module_count,
              (SELECT count(*)::text FROM enemy_definitions WHERE content_release_id = release.id) AS enemy_count,
              (SELECT count(*)::text FROM drop_tables WHERE content_release_id = release.id) AS drop_table_count
       FROM content_releases release
       ORDER BY CASE release.status WHEN 'DRAFT' THEN 0 WHEN 'PUBLISHED' THEN 1 ELSE 2 END,
                release.created_at DESC, release.id DESC
       LIMIT 100`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      version: row.version,
      status: row.status,
      configHash: row.config_hash,
      schemaVersion: row.schema_version,
      notes: row.notes,
      publishedAt: row.published_at ? iso(row.published_at) : null,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      counts: {
        missions: Number(row.mission_count),
        modules: Number(row.module_count),
        enemies: Number(row.enemy_count),
        dropTables: Number(row.drop_table_count),
      },
    }));
  }

  validate(releaseId: string): Promise<ContentValidationResult> {
    return this.database.transaction(async (client) => {
      const snapshot = await loadSnapshot(client, releaseId, "update");
      if (snapshot.release.status !== "DRAFT") {
        throw new ConflictException("Only draft releases can be validated for publication");
      }
      return validateContentReleaseSnapshot(snapshot);
    });
  }

  clone(
    releaseId: string,
    version: string,
    reason: string,
    correlationId: string,
    actor: AuditActor,
    action: "content.release.cloned" | "content.release.rollback-created",
  ): Promise<{ releaseId: string; version: string; status: "DRAFT"; correlationId: string }> {
    return this.database.transaction(async (client) => {
      const source = await loadSnapshot(client, releaseId, "share");
      const draftId = await cloneSnapshot(client, source, version, actor);
      const draft = await loadSnapshot(client, draftId, "none");
      await appendReleaseAudit(client, {
        action,
        releaseId: draftId,
        reason,
        correlationId,
        before: { sourceReleaseId: source.release.id, sourceVersion: source.release.version, sourceStatus: source.release.status },
        after: releaseState(draft),
        actor,
      });
      return { releaseId: draftId, version, status: "DRAFT", correlationId };
    });
  }

  publish(
    releaseId: string,
    reason: string,
    correlationId: string,
    actor: AuditActor,
  ): Promise<{ releaseId: string; version: string; status: "PUBLISHED"; configHash: string; correlationId: string }> {
    return this.database.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('admin-content-publish', 0))");
      const snapshot = await loadSnapshot(client, releaseId, "update");
      if (snapshot.release.status !== "DRAFT") throw new ConflictException("Only a draft release can be published");

      const validation = validateContentReleaseSnapshot(snapshot);
      if (!validation.valid) {
        throw new UnprocessableEntityException({ code: "CONTENT_RELEASE_INVALID", violations: validation.violations });
      }

      const previous = await client.query<ReleaseRow>(
        `UPDATE content_releases SET status = 'RETIRED', updated_at = now()
         WHERE status = 'PUBLISHED' AND id <> $1::uuid
         RETURNING id, version, status::text, config_hash, schema_version, bootstrap_config, notes,
                   created_by_admin_id, published_at, created_at, updated_at`,
        [releaseId],
      );
      const published = await client.query<ReleaseRow>(
        `UPDATE content_releases
         SET status = 'PUBLISHED', config_hash = $2, published_at = now(), updated_at = now()
         WHERE id = $1::uuid AND status = 'DRAFT'
         RETURNING id, version, status::text, config_hash, schema_version, bootstrap_config, notes,
                   created_by_admin_id, published_at, created_at, updated_at`,
        [releaseId, validation.configHash],
      );
      const row = published.rows[0];
      if (!row) throw new ConflictException("Content release changed before publication");

      await appendReleaseAudit(client, {
        action: "content.release.published",
        releaseId,
        reason,
        correlationId,
        before: { release: releaseState(snapshot), retiredReleaseIds: previous.rows.map((item) => item.id) },
        after: { id: row.id, version: row.version, status: row.status, configHash: row.config_hash },
        actor,
      });
      await client.query(
        `INSERT INTO outbox_events
           (id, aggregate_type, aggregate_id, event_type, payload, idempotency_key, updated_at)
         VALUES ($1::uuid, 'content-release', $2, 'content.release.published', $3::jsonb, $4, now())`,
        [
          createUuidV7(),
          releaseId,
          JSON.stringify({ releaseId, version: row.version, configHash: row.config_hash, publishedAt: row.published_at }),
          `content-release:${releaseId}:published:${row.config_hash}`,
        ],
      );
      return { releaseId, version: row.version, status: "PUBLISHED", configHash: row.config_hash, correlationId };
    });
  }

  async history(releaseId: string): Promise<readonly ContentHistoryEntry[]> {
    const exists = await this.database.query<{ id: string }>("SELECT id FROM content_releases WHERE id = $1::uuid", [releaseId]);
    if (!exists.rows[0]) throw new NotFoundException("Content release was not found");

    const releaseHistory = await this.database.query<ReleaseHistoryRow>(
      `SELECT action, resource_type, resource_id, reason, admin_user_id, correlation_id,
              before_state, after_state, created_at
       FROM admin_audit_logs
       WHERE resource_type = 'content-release' AND resource_id = $1
       ORDER BY created_at DESC, id DESC LIMIT 100`,
      [releaseId],
    );
    const definitionHistory = await this.database.query<DefinitionHistoryRow>(
      `SELECT revision.resource_type, revision.resource_id, revision.revision, revision.reason,
              revision.created_by_admin_id, revision.before_state, revision.after_state, revision.created_at
       FROM content_definition_revisions revision
       WHERE EXISTS (SELECT 1 FROM mission_definitions item WHERE item.id = revision.resource_id AND item.content_release_id = $1::uuid)
          OR EXISTS (SELECT 1 FROM module_definitions item WHERE item.id = revision.resource_id AND item.content_release_id = $1::uuid)
          OR EXISTS (SELECT 1 FROM enemy_definitions item WHERE item.id = revision.resource_id AND item.content_release_id = $1::uuid)
          OR EXISTS (SELECT 1 FROM drop_tables item WHERE item.id = revision.resource_id AND item.content_release_id = $1::uuid)
       ORDER BY revision.created_at DESC, revision.id DESC LIMIT 100`,
      [releaseId],
    );

    return [
      ...releaseHistory.rows.map((row): ContentHistoryEntry => ({
        kind: "release",
        action: row.action,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        revision: null,
        reason: row.reason,
        actorAdminId: row.admin_user_id,
        correlationId: row.correlation_id,
        before: row.before_state,
        after: row.after_state,
        createdAt: iso(row.created_at),
      })),
      ...definitionHistory.rows.map((row): ContentHistoryEntry => ({
        kind: "definition",
        action: "content.definition.revised",
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        revision: row.revision,
        reason: row.reason,
        actorAdminId: row.created_by_admin_id,
        correlationId: null,
        before: row.before_state,
        after: row.after_state,
        createdAt: iso(row.created_at),
      })),
    ].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 100);
  }
}
