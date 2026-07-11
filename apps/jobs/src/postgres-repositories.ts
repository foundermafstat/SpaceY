import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { v7 as uuidv7 } from "uuid";
import type { ClaimedJob, OutboxEvent } from "./domain.js";
import type { JobIdempotencyRepository, OutboxRepository } from "./ports.js";

type OutboxRow = QueryResultRow & {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  idempotencyKey: string;
  attemptCount: number;
  createdAt: Date;
};

function mapOutbox(row: OutboxRow): OutboxEvent {
  return {
    id: row.id,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    eventType: row.eventType,
    payload: row.payload,
    idempotencyKey: row.idempotencyKey,
    attemptCount: row.attemptCount,
    createdAt: row.createdAt,
  };
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

export class PostgresOutboxRepository implements OutboxRepository {
  constructor(private readonly pool: Pool) {}

  async claimBatch(input: { workerId: string; limit: number; leaseMs: number }): Promise<readonly OutboxEvent[]> {
    const result = await this.pool.query<OutboxRow>(`
      WITH candidates AS (
        SELECT id
        FROM outbox_events
        WHERE (
          (status = 'PENDING' AND available_at <= NOW())
          OR (status = 'PROCESSING' AND locked_at < NOW() - ($3::int * INTERVAL '1 millisecond'))
        )
        ORDER BY available_at ASC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $2
      )
      UPDATE outbox_events AS event
      SET status = 'PROCESSING',
          locked_at = NOW(),
          locked_by = $1,
          attempt_count = event.attempt_count + 1,
          updated_at = NOW()
      FROM candidates
      WHERE event.id = candidates.id
      RETURNING event.id, event.aggregate_type AS "aggregateType", event.aggregate_id AS "aggregateId",
                event.event_type AS "eventType", event.payload, event.idempotency_key AS "idempotencyKey",
                event.attempt_count AS "attemptCount", event.created_at AS "createdAt"
    `, [input.workerId, input.limit, input.leaseMs]);
    return result.rows.map(mapOutbox);
  }

  async markPublished(eventId: string, workerId: string): Promise<void> {
    const result = await this.pool.query(`
      UPDATE outbox_events
      SET status = 'PUBLISHED', published_at = NOW(), locked_at = NULL, locked_by = NULL, last_error = NULL, updated_at = NOW()
      WHERE id = $1 AND status = 'PROCESSING' AND locked_by = $2
    `, [eventId, workerId]);
    if (result.rowCount !== 1) throw new Error(`Outbox lease lost for event ${eventId}`);
  }

  async release(input: { eventId: string; workerId: string; retryAt: Date; error: string; maxAttempts: number }): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      const parameters = [input.eventId, input.workerId, input.retryAt, input.error, input.maxAttempts];
      const failed = await client.query(`
        UPDATE outbox_events
        SET status = 'FAILED', available_at = $3, locked_at = NULL, locked_by = NULL,
            last_error = LEFT($4, 2000), updated_at = NOW()
        WHERE id = $1 AND status = 'PROCESSING' AND locked_by = $2 AND attempt_count >= $5
      `, parameters);
      if (failed.rowCount === 0) {
        await client.query(`
          UPDATE outbox_events
          SET status = 'PENDING', available_at = $3, locked_at = NULL, locked_by = NULL,
              last_error = LEFT($4, 2000), updated_at = NOW()
          WHERE id = $1 AND status = 'PROCESSING' AND locked_by = $2 AND attempt_count < $5
        `, parameters);
      }
    });
  }

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

type ExistingJobRow = QueryResultRow & { status: "RUNNING" | "SUCCEEDED" | "FAILED"; payloadHash: string; expiresAt: Date };

export class PostgresJobIdempotencyRepository implements JobIdempotencyRepository {
  constructor(private readonly pool: Pool) {}

  async acquire(input: { key: string; queue: string; jobName: string; payloadHash: string; leaseUntil: Date }): Promise<ClaimedJob> {
    return inTransaction(this.pool, async (client) => {
      const inserted = await client.query(`
        INSERT INTO job_idempotency_keys
          (id, key, queue, job_name, status, payload_hash, expires_at, created_at, updated_at)
        VALUES ($1, $2, $3, $4, 'RUNNING', $5, $6, NOW(), NOW())
        ON CONFLICT (key) DO NOTHING
        RETURNING key
      `, [uuidv7(), input.key, input.queue, input.jobName, input.payloadHash, input.leaseUntil]);
      if (inserted.rowCount === 1) return "acquired";

      const existing = await client.query<ExistingJobRow>(`
        SELECT status, payload_hash AS "payloadHash", expires_at AS "expiresAt"
        FROM job_idempotency_keys
        WHERE key = $1
        FOR UPDATE
      `, [input.key]);
      const row = existing.rows[0];
      if (!row) throw new Error("Idempotency row disappeared during acquisition");
      if (row.payloadHash !== input.payloadHash) throw new Error(`Idempotency key collision for ${input.key}`);
      if (row.status === "SUCCEEDED") return "succeeded";
      if (row.status === "RUNNING" && row.expiresAt > new Date()) return "busy";

      await client.query(`
        UPDATE job_idempotency_keys
        SET status = 'RUNNING', error = NULL, expires_at = $2, updated_at = NOW()
        WHERE key = $1
      `, [input.key, input.leaseUntil]);
      return "acquired";
    });
  }

  async markSucceeded(key: string, result: unknown): Promise<void> {
    await this.pool.query(`
      UPDATE job_idempotency_keys
      SET status = 'SUCCEEDED', result = $2::jsonb, error = NULL, updated_at = NOW()
      WHERE key = $1 AND status = 'RUNNING'
    `, [key, JSON.stringify(result ?? null)]);
  }

  async markFailed(key: string, error: string): Promise<void> {
    await this.pool.query(`
      UPDATE job_idempotency_keys
      SET status = 'FAILED', error = LEFT($2, 2000), updated_at = NOW()
      WHERE key = $1 AND status = 'RUNNING'
    `, [key, error]);
  }
}
