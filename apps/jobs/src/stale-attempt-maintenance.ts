import { captureException } from "@spacey/observability";
import { RedisConnection, type ConnectionOptions } from "bullmq";
import type { Pool, QueryResultRow } from "pg";
import { v7 as uuidv7 } from "uuid";
import type { DomainEventJob } from "./domain.js";
import type { DomainEventHandler } from "./ports.js";

export const STALE_ATTEMPT_EVENT_TYPE = "battle.attempt.stale-abandoned";

type StaleAttemptRow = QueryResultRow & {
  attemptId: string;
  sessionId: string | null;
  userId: string;
  ticketHash: string | null;
};

export class PostgresStaleAttemptMaintenance {
  constructor(
    private readonly pool: Pick<Pool, "connect" | "query">,
    private readonly batchSize: number,
  ) {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
      throw new Error("Stale attempt batch size must be between 1 and 1000");
    }
  }

  async runOnce(): Promise<number> {
    const client = await this.pool.connect();
    let inTransaction = false;
    try {
      await client.query("BEGIN");
      inTransaction = true;
      const result = await client.query<StaleAttemptRow>(`
        SELECT
          attempt_id AS "attemptId",
          session_id AS "sessionId",
          user_id AS "userId",
          ticket_hash AS "ticketHash"
        FROM spacey_jobs_abandon_stale_connecting_attempts($1::int)
      `, [this.batchSize]);

      for (const row of result.rows) {
        await client.query(`
          INSERT INTO outbox_events
            (id, aggregate_type, aggregate_id, event_type, payload, idempotency_key, created_at, updated_at)
          VALUES ($1::uuid, 'mission_attempt', $2, $3, $4::jsonb, $5, NOW(), NOW())
          ON CONFLICT (idempotency_key) DO NOTHING
        `, [
          uuidv7(),
          row.attemptId,
          STALE_ATTEMPT_EVENT_TYPE,
          JSON.stringify(row),
          `mission-attempt:${row.attemptId}:stale-abandoned`,
        ]);
      }

      await client.query("COMMIT");
      inTransaction = false;
      return result.rows.length;
    } catch (error) {
      if (inTransaction) await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<void> {
    const result = await this.pool.query<{ ready: boolean }>(`
      WITH maintenance_function AS (
        SELECT to_regprocedure('public.spacey_jobs_abandon_stale_connecting_attempts(integer)') AS oid
      )
      SELECT oid IS NOT NULL
         AND has_function_privilege(current_user, oid, 'EXECUTE') AS ready
      FROM maintenance_function
    `);
    if (!result.rows[0]?.ready) throw new Error("Stale attempt maintenance migration or jobs grant is missing");
  }
}

export type StaleAttemptRouteCleanup = Readonly<{
  attemptId: string;
  sessionId: string | null;
  userId: string;
  ticketHash: string | null;
}>;

export interface StaleAttemptRouteStore {
  cleanup(input: StaleAttemptRouteCleanup): Promise<void>;
}

const CLEANUP_COMMAND = "spaceyCleanupStaleAttempt";
const CLEANUP_LUA = `
local currentTicketKey = redis.call('HGET', KEYS[1], 'ticketKey')
if currentTicketKey then redis.call('DEL', currentTicketKey) end
redis.call('DEL', KEYS[3], KEYS[4], KEYS[5], KEYS[6], KEYS[7])
redis.call('SREM', KEYS[2], KEYS[1])
redis.call('DEL', KEYS[1])
return 1
`;

export class ValkeyStaleAttemptRouteStore implements StaleAttemptRouteStore {
  private readonly connection: RedisConnection;
  private commandDefined = false;

  constructor(options: ConnectionOptions) {
    this.connection = new RedisConnection(options, { shared: false, blocking: false });
  }

  async cleanup(input: StaleAttemptRouteCleanup): Promise<void> {
    const client = await this.connection.client;
    if (!this.commandDefined) {
      client.defineCommand(CLEANUP_COMMAND, { numberOfKeys: 7, lua: CLEANUP_LUA });
      this.commandDefined = true;
    }
    const noTicketKey = `spacey:ws-ticket:none:${input.attemptId}`;
    const noSessionKey = `spacey:battle:none:${input.attemptId}`;
    await client.runCommand(CLEANUP_COMMAND, [
      `spacey:ws-ticket-state:${input.attemptId}`,
      `spacey:ws-ticket-user:${input.userId}`,
      input.ticketHash ? `spacey:ws-ticket:${input.ticketHash}` : noTicketKey,
      input.sessionId ? `spacey:battle:route:${input.sessionId}` : noSessionKey,
      input.sessionId ? `spacey:battle:definition:${input.sessionId}` : noSessionKey,
      input.sessionId ? `spacey:battle:checkpoint:${input.sessionId}` : noSessionKey,
      input.sessionId ? `spacey:battle:input-journal:${input.sessionId}` : noSessionKey,
    ]);
  }

  async close(): Promise<void> {
    await this.connection.close();
  }
}

export class StaleAttemptCleanupHandler implements DomainEventHandler {
  constructor(private readonly store: StaleAttemptRouteStore) {}

  async handle(job: DomainEventJob): Promise<{ cleaned: true }> {
    const input = parseCleanupPayload(job.payload);
    await this.store.cleanup(input);
    return { cleaned: true };
  }
}

export class StaleAttemptMaintenanceScheduler {
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;
  private stopping = true;

  constructor(
    private readonly maintenance: PostgresStaleAttemptMaintenance,
    private readonly intervalMs: number,
  ) {}

  start(): void {
    if (!this.stopping) return;
    this.stopping = false;
    this.timer = setTimeout(() => this.run(), 0);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    await this.active;
  }

  private run(): void {
    if (this.stopping) return;
    this.active = this.maintenance.runOnce()
      .then(() => undefined)
      .catch((error) => captureException(error, { service: "jobs", operation: "stale-attempt-maintenance" }))
      .finally(() => {
        this.active = undefined;
        if (!this.stopping) this.timer = setTimeout(() => this.run(), this.intervalMs);
      });
  }
}

function parseCleanupPayload(value: unknown): StaleAttemptRouteCleanup {
  if (!isRecord(value)
    || !isUuid(value.attemptId)
    || !isUuid(value.userId)
    || (value.sessionId !== null && !isUuid(value.sessionId))
    || (value.ticketHash !== null && !isSha256(value.ticketHash))) {
    throw new Error("Stale attempt cleanup payload is invalid");
  }
  return {
    attemptId: value.attemptId,
    sessionId: value.sessionId,
    userId: value.userId,
    ticketHash: value.ticketHash,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
