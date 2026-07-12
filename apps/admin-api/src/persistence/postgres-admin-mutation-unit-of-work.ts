import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { createUuidV7 } from "@spacey/db";
import { createHash } from "node:crypto";
import {
  type AdminAuditEntry,
  type AdminMutationTransaction,
  type AdminMutationUnitOfWork,
  type ContentMutationCommand,
  type EconomyAdjustmentCommand,
  type MutationRecord,
} from "../audit/admin-mutation.port.js";
import { ADMIN_DATABASE, type AdminDatabase, type AdminSqlClient } from "./admin-database.js";

type JsonObject = Record<string, unknown>;
type StateRow = Readonly<{ state: JsonObject; release_status?: string }>;
type RevisionRow = Readonly<{ revision: number }>;
type WalletAdjustmentRow = Readonly<{
  before_balance: string;
  after_balance: string;
  wallet_version: string;
  idempotent: boolean;
}>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CONTENT_KEYS: Readonly<Record<ContentMutationCommand["resourceType"], ReadonlySet<string>>> = {
  mission: new Set([
    "dropTableId",
    "type",
    "risk",
    "title",
    "description",
    "objective",
    "enemyRoster",
    "rewardDefinition",
    "durationSeconds",
    "enabled",
  ]),
  module: new Set(["category", "kind", "rarity", "shape", "stats", "damageStates", "enabled"]),
  enemy: new Set(["archetype", "stats", "behavior", "loadout", "enabled"]),
  "drop-table": new Set(["entries", "enabled"]),
};

const TEXT_FIELDS = new Set(["title", "description", "category", "kind", "rarity", "archetype"]);
const OBJECT_FIELDS = new Set(["objective", "rewardDefinition", "stats", "damageStates", "behavior", "loadout"]);
const ARRAY_FIELDS = new Set(["enemyRoster", "entries"]);

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateContentPayload(command: Pick<ContentMutationCommand, "resourceType" | "payload">): void {
  const entries = Object.entries(command.payload);
  if (entries.length === 0) throw new UnprocessableEntityException("Content payload must not be empty");

  const allowed = CONTENT_KEYS[command.resourceType];
  for (const [key, value] of entries) {
    if (!allowed.has(key)) {
      throw new UnprocessableEntityException(`Unsupported ${command.resourceType} content field: ${key}`);
    }
    if (TEXT_FIELDS.has(key) && (typeof value !== "string" || value.trim().length === 0 || value.length > 4_000)) {
      throw new UnprocessableEntityException(`${key} must be a non-empty string`);
    }
    if (OBJECT_FIELDS.has(key) && !isPlainObject(value)) {
      throw new UnprocessableEntityException(`${key} must be an object`);
    }
    if (ARRAY_FIELDS.has(key) && !Array.isArray(value)) {
      throw new UnprocessableEntityException(`${key} must be an array`);
    }
    if (key === "shape" && !isPlainObject(value) && !Array.isArray(value)) {
      throw new UnprocessableEntityException("shape must be an object or array");
    }
    if (key === "enabled" && typeof value !== "boolean") {
      throw new UnprocessableEntityException("enabled must be a boolean");
    }
    if (key === "durationSeconds" && (!Number.isInteger(value) || Number(value) <= 0 || Number(value) > 86_400)) {
      throw new UnprocessableEntityException("durationSeconds must be an integer between 1 and 86400");
    }
    if (key === "type" && !["SALVAGE", "ESCORT", "MINING", "INTERCEPT", "DEFENSE"].includes(String(value))) {
      throw new UnprocessableEntityException("Unsupported mission type");
    }
    if (key === "risk" && !["GREEN", "YELLOW", "RED"].includes(String(value))) {
      throw new UnprocessableEntityException("Unsupported mission risk");
    }
    if (key === "dropTableId" && value !== null && (typeof value !== "string" || !UUID_PATTERN.test(value))) {
      throw new UnprocessableEntityException("dropTableId must be a UUID or null");
    }
  }
}

function contentTable(resourceType: ContentMutationCommand["resourceType"]): string {
  switch (resourceType) {
    case "mission": return "mission_definitions";
    case "module": return "module_definitions";
    case "enemy": return "enemy_definitions";
    case "drop-table": return "drop_tables";
  }
}

function contentUpdateSql(resourceType: ContentMutationCommand["resourceType"]): string {
  switch (resourceType) {
    case "mission":
      return `UPDATE mission_definitions AS target SET
        drop_table_id = CASE WHEN $2::jsonb ? 'dropTableId' THEN NULLIF($2::jsonb->>'dropTableId', '')::uuid ELSE drop_table_id END,
        type = CASE WHEN $2::jsonb ? 'type' THEN ($2::jsonb->>'type')::mission_type ELSE type END,
        risk = CASE WHEN $2::jsonb ? 'risk' THEN ($2::jsonb->>'risk')::mission_risk ELSE risk END,
        title = CASE WHEN $2::jsonb ? 'title' THEN $2::jsonb->>'title' ELSE title END,
        description = CASE WHEN $2::jsonb ? 'description' THEN $2::jsonb->>'description' ELSE description END,
        objective = CASE WHEN $2::jsonb ? 'objective' THEN $2::jsonb->'objective' ELSE objective END,
        enemy_roster = CASE WHEN $2::jsonb ? 'enemyRoster' THEN $2::jsonb->'enemyRoster' ELSE enemy_roster END,
        reward_definition = CASE WHEN $2::jsonb ? 'rewardDefinition' THEN $2::jsonb->'rewardDefinition' ELSE reward_definition END,
        duration_seconds = CASE WHEN $2::jsonb ? 'durationSeconds' THEN ($2::jsonb->>'durationSeconds')::integer ELSE duration_seconds END,
        enabled = CASE WHEN $2::jsonb ? 'enabled' THEN ($2::jsonb->>'enabled')::boolean ELSE enabled END,
        updated_at = now()
        WHERE id = $1::uuid RETURNING to_jsonb(target.*) AS state`;
    case "module":
      return `UPDATE module_definitions AS target SET
        category = CASE WHEN $2::jsonb ? 'category' THEN $2::jsonb->>'category' ELSE category END,
        kind = CASE WHEN $2::jsonb ? 'kind' THEN $2::jsonb->>'kind' ELSE kind END,
        rarity = CASE WHEN $2::jsonb ? 'rarity' THEN $2::jsonb->>'rarity' ELSE rarity END,
        shape = CASE WHEN $2::jsonb ? 'shape' THEN $2::jsonb->'shape' ELSE shape END,
        stats = CASE WHEN $2::jsonb ? 'stats' THEN $2::jsonb->'stats' ELSE stats END,
        damage_states = CASE WHEN $2::jsonb ? 'damageStates' THEN $2::jsonb->'damageStates' ELSE damage_states END,
        enabled = CASE WHEN $2::jsonb ? 'enabled' THEN ($2::jsonb->>'enabled')::boolean ELSE enabled END,
        updated_at = now()
        WHERE id = $1::uuid RETURNING to_jsonb(target.*) AS state`;
    case "enemy":
      return `UPDATE enemy_definitions AS target SET
        archetype = CASE WHEN $2::jsonb ? 'archetype' THEN $2::jsonb->>'archetype' ELSE archetype END,
        stats = CASE WHEN $2::jsonb ? 'stats' THEN $2::jsonb->'stats' ELSE stats END,
        behavior = CASE WHEN $2::jsonb ? 'behavior' THEN $2::jsonb->'behavior' ELSE behavior END,
        loadout = CASE WHEN $2::jsonb ? 'loadout' THEN $2::jsonb->'loadout' ELSE loadout END,
        enabled = CASE WHEN $2::jsonb ? 'enabled' THEN ($2::jsonb->>'enabled')::boolean ELSE enabled END,
        updated_at = now()
        WHERE id = $1::uuid RETURNING to_jsonb(target.*) AS state`;
    case "drop-table":
      return `UPDATE drop_tables AS target SET
        entries = CASE WHEN $2::jsonb ? 'entries' THEN $2::jsonb->'entries' ELSE entries END,
        enabled = CASE WHEN $2::jsonb ? 'enabled' THEN ($2::jsonb->>'enabled')::boolean ELSE enabled END,
        updated_at = now()
        WHERE id = $1::uuid RETURNING to_jsonb(target.*) AS state`;
  }
}

function dbCurrency(currency: EconomyAdjustmentCommand["currency"]): string {
  return currency === "dataShards" ? "DATA_SHARDS" : currency.toUpperCase();
}

function auditIdempotencyKey(entry: AdminAuditEntry): string {
  return createHash("sha256")
    .update(`${entry.correlationId}:${entry.action}:${entry.resourceType}:${entry.resourceId}`, "utf8")
    .digest("hex");
}

function safeRevision(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new ConflictException("Wallet revision exceeds supported range");
  return Number(value);
}

class PostgresAdminMutationTransaction implements AdminMutationTransaction {
  constructor(private readonly client: AdminSqlClient) {}

  async applyContentRevision(command: ContentMutationCommand): Promise<MutationRecord> {
    validateContentPayload(command);
    await this.client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `admin-content:${command.resourceType}:${command.resourceId}`,
    ]);

    const revisionResult = await this.client.query<RevisionRow>(
      `SELECT COALESCE(max(revision), 0)::integer AS revision
       FROM content_definition_revisions
       WHERE resource_type = $1 AND resource_id = $2::uuid`,
      [command.resourceType, command.resourceId],
    );
    const currentRevision = revisionResult.rows[0]?.revision ?? 0;
    if (currentRevision !== command.expectedRevision) {
      throw new ConflictException({
        code: "CONTENT_REVISION_CONFLICT",
        expectedRevision: command.expectedRevision,
        currentRevision,
      });
    }

    const table = contentTable(command.resourceType);
    const beforeResult = await this.client.query<StateRow>(
      `SELECT to_jsonb(target.*) AS state, release.status::text AS release_status
       FROM ${table} AS target
       JOIN content_releases AS release ON release.id = target.content_release_id
       WHERE target.id = $1::uuid
       FOR UPDATE OF target, release`,
      [command.resourceId],
    );
    const locked = beforeResult.rows[0];
    const before = locked?.state;
    if (!before) throw new NotFoundException(`${command.resourceType} content resource was not found`);
    if (locked.release_status !== "DRAFT") {
      throw new ConflictException({
        code: "CONTENT_RELEASE_IMMUTABLE",
        releaseStatus: locked.release_status,
      });
    }

    const afterResult = await this.client.query<StateRow>(contentUpdateSql(command.resourceType), [
      command.resourceId,
      JSON.stringify(command.payload),
    ]);
    const after = afterResult.rows[0]?.state;
    if (!after) throw new ConflictException("Content resource changed while applying the revision");

    const revision = currentRevision + 1;
    await this.client.query(
      `INSERT INTO content_definition_revisions
         (id, resource_type, resource_id, revision, before_state, after_state, reason, created_by_admin_id)
       VALUES ($1::uuid, $2, $3::uuid, $4, $5::jsonb, $6::jsonb, $7, $8::uuid)`,
      [
        createUuidV7(),
        command.resourceType,
        command.resourceId,
        revision,
        JSON.stringify(before),
        JSON.stringify(after),
        command.reason,
        command.actor.adminId,
      ],
    );

    return { resourceId: command.resourceId, revision, before, after };
  }

  async applyEconomyAdjustment(command: EconomyAdjustmentCommand): Promise<MutationRecord> {
    const currency = dbCurrency(command.currency);
    let result: { rows: WalletAdjustmentRow[] };
    try {
      result = await this.client.query<WalletAdjustmentRow>(
        `SELECT before_balance::text, after_balance::text, wallet_version::text, idempotent
         FROM spacey_admin_adjust_wallet(
           $1::uuid, $2::uuid, $3::uuid, $4::wallet_currency, $5::bigint,
           $6, $7::uuid, $8::jsonb
         )`,
        [
          createUuidV7(),
          createUuidV7(),
          command.playerId,
          currency,
          String(command.amount),
          command.idempotencyKey,
          command.actor.adminId,
          JSON.stringify({
            caseId: command.caseId,
            reason: command.reason,
            adminSessionId: command.actor.sessionId,
            authenticationMethod: command.actor.authenticationMethod,
          }),
        ],
      );
    } catch (error) {
      const code = isPlainObject(error) && typeof error.code === "string" ? error.code : undefined;
      if (code === "P0002") throw new NotFoundException("Player was not found");
      if (code === "23514") {
        throw new UnprocessableEntityException("Economy adjustment would make the balance negative");
      }
      if (code === "23505") {
        throw new ConflictException("Economy idempotency key was already used for another adjustment");
      }
      throw error;
    }

    const adjustment = result.rows[0];
    if (!adjustment) throw new ConflictException("Economy adjustment did not return a wallet state");
    const revision = safeRevision(BigInt(adjustment.wallet_version));

    return {
      resourceId: command.playerId,
      revision,
      before: { currency, balance: adjustment.before_balance, version: revision - 1 },
      after: { currency, balance: adjustment.after_balance, version: revision },
    };
  }

  async appendAudit(entry: AdminAuditEntry): Promise<void> {
    const idempotencyKey = auditIdempotencyKey(entry);
    const authenticationMethod = entry.actor.authenticationMethod === "webauthn" ? "WEBAUTHN" : "TOTP_RECOVERY";
    const beforeState = JSON.stringify(entry.before);
    const afterState = JSON.stringify(entry.after);
    const insertResult = await this.client.query<{ id: string }>(
      `INSERT INTO admin_audit_logs
         (id, admin_user_id, admin_session_id, authentication_method, actor_role, action, resource_type,
          resource_id, before_state, after_state, reason, case_id, correlation_id, idempotency_key)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::admin_authentication_method, $5, $6, $7, $8,
               $9::jsonb, $10::jsonb, $11, $12, $13::uuid, $14)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [
        createUuidV7(),
        entry.actor.adminId,
        entry.actor.sessionId,
        authenticationMethod,
        entry.actor.role,
        entry.action,
        entry.resourceType,
        entry.resourceId,
        beforeState,
        afterState,
        entry.reason,
        entry.caseId ?? null,
        entry.correlationId,
        idempotencyKey,
      ],
    );
    if (insertResult.rowCount === 1) return;

    const existingResult = await this.client.query<{ id: string }>(
      `SELECT id FROM admin_audit_logs
       WHERE idempotency_key = $1
         AND admin_user_id = $2::uuid
         AND admin_session_id = $3::uuid
         AND authentication_method = $4::admin_authentication_method
         AND actor_role = $5
         AND action = $6
         AND resource_type = $7
         AND resource_id = $8
         AND before_state = $9::jsonb
         AND after_state = $10::jsonb
         AND reason = $11
         AND case_id IS NOT DISTINCT FROM $12
         AND correlation_id = $13::uuid`,
      [
        idempotencyKey,
        entry.actor.adminId,
        entry.actor.sessionId,
        authenticationMethod,
        entry.actor.role,
        entry.action,
        entry.resourceType,
        entry.resourceId,
        beforeState,
        afterState,
        entry.reason,
        entry.caseId ?? null,
        entry.correlationId,
      ],
    );
    if (existingResult.rowCount !== 1) {
      throw new ConflictException("Audit idempotency key was already used for another mutation");
    }
  }
}

@Injectable()
export class PostgresAdminMutationUnitOfWork implements AdminMutationUnitOfWork {
  constructor(@Inject(ADMIN_DATABASE) private readonly database: AdminDatabase) {}

  transaction<T>(operation: (transaction: AdminMutationTransaction) => Promise<T>): Promise<T> {
    return this.database.transaction((client) => operation(new PostgresAdminMutationTransaction(client)));
  }
}
