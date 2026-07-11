import { createHash } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { v7 as uuidv7 } from "uuid";
import type { DomainEventJob } from "./domain.js";
import type { DomainEventHandler } from "./ports.js";

export type PrivacyRequestKind = "EXPORT" | "DELETE";

export type PrivacyExportSource = Readonly<{
  request: Readonly<{ id: string; requestedAt: Date; retentionPolicyVersion: string }>;
  profile: Readonly<Record<string, unknown>>;
  telegramIdentity: Readonly<Record<string, unknown>> | null;
  authSessions: readonly Readonly<Record<string, unknown>>[];
  shipBuilds: readonly Readonly<Record<string, unknown>>[];
  shipBuildRevisions: readonly Readonly<Record<string, unknown>>[];
  buildItems: readonly Readonly<Record<string, unknown>>[];
  inventory: readonly Readonly<Record<string, unknown>>[];
  walletBalances: readonly Readonly<Record<string, unknown>>[];
  walletLedger: readonly Readonly<Record<string, unknown>>[];
  missionHistory: readonly Readonly<Record<string, unknown>>[];
  missionResults: readonly Readonly<Record<string, unknown>>[];
  progression: Readonly<Record<string, unknown>> | null;
  privacyRequests: readonly Readonly<Record<string, unknown>>[];
}>;

export type StoredPrivacyExport = Readonly<{
  objectKey: string;
  objectVersion: string | null;
  contentType: "application/json";
  contentSha256: string;
  sizeBytes: number;
  encryptionAlgorithm: string;
  encryptionKeyId: string;
  expiresAt: Date;
}>;

export interface PrivacyExportObjectStore {
  putEncrypted(input: Readonly<{
    objectKey: string;
    body: Uint8Array;
    contentType: "application/json";
    contentSha256: string;
    expiresAt: Date;
  }>): Promise<StoredPrivacyExport>;
  ping(): Promise<void>;
}

export interface PrivacyWorkflowRepository {
  claim(input: { requestId: string; userId: string; type: PrivacyRequestKind }): Promise<"claimed" | "completed" | "busy" | "invalid">;
  loadExportSource(requestId: string, userId: string): Promise<PrivacyExportSource>;
  completeExport(requestId: string, userId: string, artifact: StoredPrivacyExport): Promise<void>;
  anonymizeAndCompleteDelete(requestId: string, userId: string): Promise<void>;
  markFailed(requestId: string, userId: string, failureCode: string): Promise<void>;
}

export class PrivacyWorkflowError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "PrivacyWorkflowError";
  }
}

export class UnconfiguredPrivacyExportObjectStore implements PrivacyExportObjectStore {
  async putEncrypted(): Promise<StoredPrivacyExport> {
    throw new PrivacyWorkflowError(
      "privacy_export_store_unconfigured",
      "Encrypted privacy export object storage is not configured.",
    );
  }

  async ping(): Promise<void> {
    throw new PrivacyWorkflowError(
      "privacy_export_store_unconfigured",
      "Encrypted privacy export object storage is not configured.",
    );
  }
}

export class PrivacyExportHandler implements DomainEventHandler {
  constructor(
    private readonly repository: PrivacyWorkflowRepository,
    private readonly objectStore: PrivacyExportObjectStore,
  ) {}

  async handle(job: DomainEventJob): Promise<unknown> {
    const identifiers = privacyIdentifiers(job, "privacy.export.requested", "export");
    const claim = await this.repository.claim({ ...identifiers, type: "EXPORT" });
    if (claim === "completed") return { duplicate: true };
    if (claim !== "claimed") throw new PrivacyWorkflowError(`privacy_request_${claim}`, "Privacy export request cannot be claimed.");

    try {
      const source = await this.repository.loadExportSource(identifiers.requestId, identifiers.userId);
      const body = Buffer.from(canonicalJson(buildCanonicalPrivacyExport(source)), "utf8");
      const contentSha256 = createHash("sha256").update(body).digest("hex");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000);
      const objectKey = `privacy-exports/${identifiers.userId}/${identifiers.requestId}.json`;
      const artifact = await this.objectStore.putEncrypted({
        objectKey,
        body,
        contentType: "application/json",
        contentSha256,
        expiresAt,
      });
      assertEncryptedArtifact(artifact, { objectKey, contentSha256, sizeBytes: body.byteLength });
      await this.repository.completeExport(identifiers.requestId, identifiers.userId, artifact);
      return { stored: true, contentSha256, sizeBytes: body.byteLength, expiresAt: artifact.expiresAt.toISOString() };
    } catch (error) {
      await this.repository.markFailed(identifiers.requestId, identifiers.userId, privacyFailureCode(error, "privacy_export_failed"));
      throw error;
    }
  }
}

export class PrivacyDeleteHandler implements DomainEventHandler {
  constructor(private readonly repository: PrivacyWorkflowRepository) {}

  async handle(job: DomainEventJob): Promise<unknown> {
    const identifiers = privacyIdentifiers(job, "privacy.delete.requested", "delete");
    const claim = await this.repository.claim({ ...identifiers, type: "DELETE" });
    if (claim === "completed") return { duplicate: true };
    if (claim !== "claimed") throw new PrivacyWorkflowError(`privacy_request_${claim}`, "Privacy deletion request cannot be claimed.");
    try {
      await this.repository.anonymizeAndCompleteDelete(identifiers.requestId, identifiers.userId);
      return { anonymized: true };
    } catch (error) {
      await this.repository.markFailed(identifiers.requestId, identifiers.userId, privacyFailureCode(error, "privacy_delete_failed"));
      throw error;
    }
  }
}

export function buildCanonicalPrivacyExport(source: PrivacyExportSource): Readonly<Record<string, unknown>> {
  return {
    format: "spacey-player-export",
    formatVersion: 1,
    generatedAt: source.request.requestedAt.toISOString(),
    request: {
      id: source.request.id,
      retentionPolicyVersion: source.request.retentionPolicyVersion,
    },
    scope: [
      "profile", "telegramIdentity", "authSessions", "shipBuilds", "shipBuildRevisions", "buildItems",
      "inventory", "walletBalances", "walletLedger", "missionHistory", "missionResults", "progression", "privacyRequests",
    ],
    data: {
      profile: source.profile,
      telegramIdentity: source.telegramIdentity,
      authSessions: source.authSessions,
      shipBuilds: source.shipBuilds,
      shipBuildRevisions: source.shipBuildRevisions,
      buildItems: source.buildItems,
      inventory: source.inventory,
      walletBalances: source.walletBalances,
      walletLedger: source.walletLedger,
      missionHistory: source.missionHistory,
      missionResults: source.missionResults,
      progression: source.progression,
      privacyRequests: source.privacyRequests,
    },
  };
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export class PostgresPrivacyWorkflowRepository implements PrivacyWorkflowRepository {
  constructor(private readonly pool: Pool) {}

  async claim(input: { requestId: string; userId: string; type: PrivacyRequestKind }) {
    const claimed = await this.pool.query(`
      UPDATE privacy_requests
         SET status = 'PROCESSING'::privacy_request_status,
             processing_started_at = NOW(),
             completed_at = NULL,
             failed_at = NULL,
             failure_code = NULL,
             updated_at = NOW()
       WHERE id = $1::uuid
         AND user_id = $2::uuid
         AND type = $3::privacy_request_type
         AND (
           status IN ('PENDING'::privacy_request_status, 'FAILED'::privacy_request_status)
           OR (status = 'PROCESSING'::privacy_request_status AND processing_started_at < NOW() - INTERVAL '5 minutes')
         )
       RETURNING id
    `, [input.requestId, input.userId, input.type]);
    if (claimed.rowCount === 1) return "claimed" as const;
    const existing = await this.pool.query<{ status: string }>(`
      SELECT status::text AS status
        FROM privacy_requests
       WHERE id = $1::uuid AND user_id = $2::uuid AND type = $3::privacy_request_type
    `, [input.requestId, input.userId, input.type]);
    if (existing.rows[0]?.status === "COMPLETED") return "completed" as const;
    if (existing.rows[0]?.status === "PROCESSING") return "busy" as const;
    return "invalid" as const;
  }

  async loadExportSource(requestId: string, userId: string): Promise<PrivacyExportSource> {
    return inTransaction(this.pool, async (client) => {
      await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await client.query("SELECT set_config('spacey.user_id', $1, true)", [userId]);
      const request = await one(client, `
        SELECT id::text, requested_at AS "requestedAt", retention_policy_version AS "retentionPolicyVersion"
          FROM privacy_requests
         WHERE id = $1::uuid AND user_id = $2::uuid AND type = 'EXPORT'::privacy_request_type
           AND status = 'PROCESSING'::privacy_request_status
      `, [requestId, userId]);
      const profile = await one(client, `
        SELECT id::text, status::text, display_name AS "displayName", locale, time_zone AS "timeZone",
               avatar_url AS "avatarUrl", profile_public AS "profilePublic",
               analytics_consent_at AS "analyticsConsentAt",
               analytics_consent_updated_at AS "analyticsConsentUpdatedAt",
               terms_accepted_at AS "termsAcceptedAt", created_at AS "createdAt", updated_at AS "updatedAt"
          FROM users WHERE id = $1::uuid
      `, [userId]);
      if (!request || !profile) throw new PrivacyWorkflowError("privacy_export_source_unavailable", "Privacy export source is unavailable.");

      const telegramIdentity = await optionalOne(client, `
        SELECT telegram_user_id::text AS "telegramUserId", username, first_name AS "firstName",
               last_name AS "lastName", language_code AS "languageCode", is_premium AS "isPremium",
               created_at AS "createdAt", updated_at AS "updatedAt"
          FROM telegram_identities WHERE user_id = $1::uuid
      `, [userId]);
      const authSessions = await many(client, `
        SELECT id::text, status::text, expires_at AS "expiresAt", last_used_at AS "lastUsedAt",
               reuse_detected_at AS "reuseDetectedAt", revoked_at AS "revokedAt", created_at AS "createdAt"
          FROM auth_sessions WHERE user_id = $1::uuid ORDER BY created_at, id
      `, [userId]);
      const shipBuilds = await many(client, `
        SELECT id::text, name, status::text, current_revision_id::text AS "currentRevisionId",
               created_at AS "createdAt", updated_at AS "updatedAt"
          FROM ship_builds WHERE user_id = $1::uuid ORDER BY created_at, id
      `, [userId]);
      const shipBuildRevisions = await many(client, `
        SELECT revision.id::text, revision.build_id::text AS "shipBuildId", revision.version,
               revision.schema_version AS "schemaVersion", revision.snapshot,
               revision.snapshot_hash AS "snapshotHash", revision.total_mass AS "totalMass",
               revision.total_power AS "totalPower", revision.created_at AS "createdAt"
          FROM ship_build_revisions revision
          JOIN ship_builds build ON build.id = revision.build_id
         WHERE build.user_id = $1::uuid ORDER BY revision.created_at, revision.id
      `, [userId]);
      const buildItems = await many(client, `
        SELECT item.id::text, item.build_revision_id::text AS "shipBuildRevisionId",
               item.inventory_item_id::text AS "inventoryItemId", item.slot_key AS "slotKey",
               item.placement, item.created_at AS "createdAt"
          FROM build_revision_items item
          JOIN ship_build_revisions revision ON revision.id = item.build_revision_id
          JOIN ship_builds build ON build.id = revision.build_id
         WHERE build.user_id = $1::uuid ORDER BY item.created_at, item.id
      `, [userId]);
      const inventory = await many(client, `
        SELECT id::text, definition_key AS "definitionKey", state::text, durability, metadata,
               acquired_at AS "acquiredAt", created_at AS "createdAt", updated_at AS "updatedAt"
          FROM inventory_items WHERE user_id = $1::uuid ORDER BY created_at, id
      `, [userId]);
      const walletBalances = await many(client, `
        SELECT currency::text, balance::text, version::text, created_at AS "createdAt", updated_at AS "updatedAt"
          FROM wallet_balances WHERE user_id = $1::uuid ORDER BY currency
      `, [userId]);
      const walletLedger = await many(client, `
        SELECT id::text, currency::text, delta::text, balance_after::text AS "balanceAfter",
               source_type AS "sourceType", source_id::text AS "sourceId", metadata, created_at AS "createdAt"
          FROM wallet_ledger_entries WHERE user_id = $1::uuid ORDER BY created_at, id
      `, [userId]);
      const missionHistory = await many(client, `
        SELECT id::text, type::text, status::text, mission_definition_id::text AS "missionDefinitionId",
               content_release_id::text AS "contentReleaseId", simulation_version AS "simulationVersion",
               started_at AS "startedAt", ended_at AS "endedAt", created_at AS "createdAt", updated_at AS "updatedAt"
          FROM mission_attempts WHERE user_id = $1::uuid ORDER BY created_at, id
      `, [userId]);
      const missionResults = await many(client, `
        SELECT result.id::text, result.mission_attempt_id::text AS "missionAttemptId", result.outcome::text,
               result.final_tick AS "finalTick", result.state_hash AS "stateHash", result.metrics,
               result.rewards, result.damage, result.finished_at AS "finishedAt", result.created_at AS "createdAt"
          FROM mission_results result
          JOIN mission_attempts attempt ON attempt.id = result.mission_attempt_id
         WHERE attempt.user_id = $1::uuid ORDER BY result.created_at, result.id
      `, [userId]);
      const progression = await optionalOne(client, `
        SELECT level, experience::text, reputation::text, version::text,
               created_at AS "createdAt", updated_at AS "updatedAt"
          FROM player_progression WHERE user_id = $1::uuid
      `, [userId]);
      const privacyRequests = await many(client, `
        SELECT id::text, type::text, status::text, requested_at AS "requestedAt",
               completed_at AS "completedAt", failed_at AS "failedAt", failure_code AS "failureCode",
               retention_policy_version AS "retentionPolicyVersion", retention_until AS "retentionUntil"
          FROM privacy_requests WHERE user_id = $1::uuid ORDER BY requested_at, id
      `, [userId]);

      return {
        request: {
          id: String(request.id),
          requestedAt: request.requestedAt as Date,
          retentionPolicyVersion: String(request.retentionPolicyVersion),
        },
        profile,
        telegramIdentity,
        authSessions,
        shipBuilds,
        shipBuildRevisions,
        buildItems,
        inventory,
        walletBalances,
        walletLedger,
        missionHistory,
        missionResults,
        progression,
        privacyRequests,
      };
    });
  }

  async completeExport(requestId: string, userId: string, artifact: StoredPrivacyExport): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      const completed = await client.query(`
        UPDATE privacy_requests
           SET status = 'COMPLETED'::privacy_request_status,
               completed_at = NOW(), failed_at = NULL, failure_code = NULL,
               export_object_key = $3, export_object_version = $4, export_content_type = $5,
               export_content_sha256 = $6, export_size_bytes = $7,
               export_encryption_algorithm = $8, export_encryption_key_id = $9,
               export_expires_at = $10, updated_at = NOW()
         WHERE id = $1::uuid AND user_id = $2::uuid AND type = 'EXPORT'::privacy_request_type
           AND status = 'PROCESSING'::privacy_request_status
      `, [
        requestId, userId, artifact.objectKey, artifact.objectVersion, artifact.contentType,
        artifact.contentSha256, artifact.sizeBytes, artifact.encryptionAlgorithm,
        artifact.encryptionKeyId, artifact.expiresAt,
      ]);
      if (completed.rowCount !== 1) throw new PrivacyWorkflowError("privacy_export_state_conflict", "Privacy export state changed.");
      await insertCompletionOutbox(client, requestId, userId, "privacy.export.completed");
    });
  }

  async anonymizeAndCompleteDelete(requestId: string, userId: string): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      await client.query("SELECT set_config('spacey.user_id', $1, true)", [userId]);
      const request = await client.query<{ status: string }>(`
        SELECT status::text AS status FROM privacy_requests
         WHERE id = $1::uuid AND user_id = $2::uuid AND type = 'DELETE'::privacy_request_type
         FOR UPDATE
      `, [requestId, userId]);
      if (request.rows[0]?.status === "COMPLETED") return;
      if (request.rows[0]?.status !== "PROCESSING") {
        throw new PrivacyWorkflowError("privacy_delete_state_conflict", "Privacy deletion state changed.");
      }
      const identity = await client.query<{ telegramUserId: string }>(`
        SELECT telegram_user_id::text AS "telegramUserId" FROM telegram_identities WHERE user_id = $1::uuid
      `, [userId]);
      const telegramUserId = identity.rows[0]?.telegramUserId;

      await client.query(`
        UPDATE users SET status = 'DELETED'::user_status, display_name = NULL, avatar_url = NULL,
               locale = 'und', time_zone = 'UTC', profile_public = false, analytics_consent_at = NULL,
               analytics_consent_updated_at = NOW(), deleted_at = COALESCE(deleted_at, NOW()), updated_at = NOW()
         WHERE id = $1::uuid
      `, [userId]);
      await client.query(`
        UPDATE auth_sessions SET status = 'REVOKED'::auth_session_status,
               refresh_token_hash = 'deleted:' || id::text, ip_hash = NULL, user_agent_hash = NULL,
               revoked_at = COALESCE(revoked_at, NOW()), updated_at = NOW()
         WHERE user_id = $1::uuid
      `, [userId]);
      await client.query(`
        UPDATE telegram_auth_replays SET user_id = NULL, telegram_user_id = NULL WHERE user_id = $1::uuid
      `, [userId]);
      if (telegramUserId) {
        await client.query("DELETE FROM telegram_support_messages WHERE telegram_user_id = $1::bigint", [telegramUserId]);
        await client.query("DELETE FROM telegram_support_tickets WHERE telegram_user_id = $1::bigint", [telegramUserId]);
        await client.query("DELETE FROM telegram_referrals WHERE telegram_user_id = $1::bigint", [telegramUserId]);
        await client.query("DELETE FROM telegram_notification_preferences WHERE telegram_user_id = $1::bigint", [telegramUserId]);
      }
      await client.query("DELETE FROM telegram_identities WHERE user_id = $1::uuid", [userId]);
      const completed = await client.query(`
        UPDATE privacy_requests
           SET status = 'COMPLETED'::privacy_request_status, completed_at = NOW(), anonymized_at = NOW(),
               failed_at = NULL, failure_code = NULL, updated_at = NOW()
         WHERE id = $1::uuid AND user_id = $2::uuid AND status = 'PROCESSING'::privacy_request_status
      `, [requestId, userId]);
      if (completed.rowCount !== 1) throw new PrivacyWorkflowError("privacy_delete_state_conflict", "Privacy deletion state changed.");
      await insertCompletionOutbox(client, requestId, userId, "privacy.delete.completed");
    });
  }

  async markFailed(requestId: string, userId: string, failureCode: string): Promise<void> {
    await this.pool.query(`
      UPDATE privacy_requests
         SET status = 'FAILED'::privacy_request_status, completed_at = NULL, failed_at = NOW(),
             failure_code = LEFT($3, 128), updated_at = NOW()
       WHERE id = $1::uuid AND user_id = $2::uuid AND status = 'PROCESSING'::privacy_request_status
    `, [requestId, userId, failureCode]);
  }
}

function privacyIdentifiers(job: DomainEventJob, eventType: string, requestType: "export" | "delete") {
  if (job.eventType !== eventType || job.aggregateType !== "privacy-request" || !isRecord(job.payload)) {
    throw new PrivacyWorkflowError("privacy_event_invalid", "Privacy event envelope is invalid.");
  }
  const { requestId, userId } = job.payload;
  if (!isUuid(requestId) || !isUuid(userId) || job.aggregateId !== requestId || job.payload.requestType !== requestType) {
    throw new PrivacyWorkflowError("privacy_event_invalid", "Privacy event identifiers are invalid.");
  }
  return { requestId, userId };
}

function assertEncryptedArtifact(
  artifact: StoredPrivacyExport,
  expected: { objectKey: string; contentSha256: string; sizeBytes: number },
) {
  if (
    artifact.objectKey !== expected.objectKey
    || artifact.contentType !== "application/json"
    || artifact.contentSha256 !== expected.contentSha256
    || artifact.sizeBytes !== expected.sizeBytes
    || !artifact.encryptionAlgorithm.trim()
    || !artifact.encryptionKeyId.trim()
    || artifact.expiresAt <= new Date()
  ) {
    throw new PrivacyWorkflowError("privacy_export_metadata_invalid", "Encrypted export metadata is invalid.");
  }
}

function privacyFailureCode(error: unknown, fallback: string) {
  return error instanceof PrivacyWorkflowError ? error.code : fallback;
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function inTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function one(client: PoolClient, query: string, parameters: unknown[]): Promise<QueryResultRow | null> {
  return (await client.query(query, parameters)).rows[0] ?? null;
}

async function optionalOne(client: PoolClient, query: string, parameters: unknown[]) {
  return one(client, query, parameters);
}

async function many(client: PoolClient, query: string, parameters: unknown[]): Promise<QueryResultRow[]> {
  return (await client.query(query, parameters)).rows;
}

async function insertCompletionOutbox(client: PoolClient, requestId: string, userId: string, eventType: string) {
  await client.query(`
    INSERT INTO outbox_events
      (id, aggregate_type, aggregate_id, event_type, payload, idempotency_key, created_at, updated_at)
    VALUES ($1::uuid, 'privacy-request', $2, $3, $4::jsonb, $5, NOW(), NOW())
    ON CONFLICT (idempotency_key) DO NOTHING
  `, [
    uuidv7(), requestId, eventType, JSON.stringify({ requestId, userId, retentionPolicyVersion: "eu-v1" }),
    `privacy-request:${requestId}:completed`,
  ]);
}
