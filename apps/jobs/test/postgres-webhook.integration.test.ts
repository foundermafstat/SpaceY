import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import type { DomainEventJob } from "../src/domain.js";
import { PostgresWebhookRepository } from "../src/webhook-handler.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

test("PostgreSQL webhook delivery claim is idempotent", { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const clientId = uuidv7();
  const subscriptionId = uuidv7();
  const eventId = uuidv7();
  const secretHash = createHash("sha256").update("integration-webhook-secret").digest("hex");
  const job: DomainEventJob = {
    outboxEventId: eventId,
    idempotencyKey: `integration:${eventId}`,
    eventType: "content.release.published",
    aggregateType: "integration",
    aggregateId: eventId,
    payload: { ok: true },
    occurredAt: new Date().toISOString(),
  };

  try {
    await pool.query(`
      INSERT INTO api_clients (id, client_id, name, scopes, updated_at)
      VALUES ($1, $2, 'Integration client', ARRAY['integration:read'], NOW())
    `, [clientId, `integration-${clientId}`]);
    await pool.query(`
      INSERT INTO webhook_subscriptions (id, api_client_id, url, secret_hash, event_types, updated_at)
      VALUES ($1, $2, 'https://example.com/spacey-events', $3, ARRAY['content.release.published'], NOW())
    `, [subscriptionId, clientId, secretHash]);
    await pool.query(`
      INSERT INTO outbox_events
        (id, aggregate_type, aggregate_id, event_type, payload, idempotency_key, updated_at)
      VALUES ($1::uuid, 'integration', $1::text, 'content.release.published', '{"ok":true}'::jsonb, $2, NOW())
    `, [eventId, job.idempotencyKey]);

    const repository = new PostgresWebhookRepository(pool);
    const claimed = await repository.claim(job);
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0]?.attemptCount, 1);
    await repository.markDelivered(claimed[0]!.id, 204);
    assert.equal((await repository.claim(job)).length, 0);
    const status = await pool.query<{ status: string; attempt_count: number }>(
      "SELECT status, attempt_count FROM webhook_deliveries WHERE id = $1",
      [claimed[0]!.id],
    );
    assert.deepEqual(status.rows[0], { status: "DELIVERED", attempt_count: 1 });
  } finally {
    await pool.query("DELETE FROM webhook_subscriptions WHERE id = $1", [subscriptionId]);
    await pool.query("DELETE FROM outbox_events WHERE id = $1", [eventId]);
    await pool.query("DELETE FROM api_clients WHERE id = $1", [clientId]);
    await pool.end();
  }
});
