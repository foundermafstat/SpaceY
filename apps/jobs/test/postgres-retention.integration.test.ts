import assert from "node:assert/strict";
import test from "node:test";
import { Pool, type PoolClient } from "pg";
import { v7 as uuidv7 } from "uuid";
import { PostgresRetentionMaintenance } from "../src/retention-maintenance.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

test("PostgreSQL retention is bounded, role-scoped and advisory-lock protected", { skip: !databaseUrl }, async () => {
  const ownerPool = new Pool({ connectionString: databaseUrl, max: 3 });
  const jobsPool = new Pool({ connectionString: databaseUrl, max: 1, options: "-c role=spacey_jobs" });
  const client = await ownerPool.connect();
  const userId = uuidv7();
  const oldSessionId = uuidv7();
  const recentSessionId = uuidv7();
  const expiredSessionId = uuidv7();
  const rotatedChildSessionId = uuidv7();
  const oldReplayId = uuidv7();
  const recentReplayId = uuidv7();
  const expiredFailedPrivacyId = uuidv7();
  const expiredCompletedPrivacyId = uuidv7();
  const pendingExpiredPrivacyId = uuidv7();
  const futureFailedPrivacyId = uuidv7();
  const apiClientId = uuidv7();
  const subscriptionId = uuidv7();
  const oldDeliveredOutboxId = uuidv7();
  const oldDeadOutboxId = uuidv7();
  const blockedOutboxId = uuidv7();
  const recentOutboxId = uuidv7();
  const failedOutboxId = uuidv7();
  const oldDeliveredId = uuidv7();
  const oldDeadId = uuidv7();
  const blockedDeliveryId = uuidv7();
  const recentDeliveryId = uuidv7();
  const oldAuditId = uuidv7();
  const recentAuditId = uuidv7();

  try {
    await client.query("BEGIN");
    await client.query(`
      INSERT INTO users (id, display_name, updated_at)
      VALUES ($1, 'Retention integration pilot', NOW())
    `, [userId]);
    await client.query(`
      INSERT INTO auth_sessions
        (id, user_id, token_family, refresh_token_hash, expires_at, ip_hash, user_agent_hash, created_at, updated_at)
      VALUES
        ($1, $3, $4, $5, NOW() + INTERVAL '1 day', 'old-ip', 'old-ua', NOW() - INTERVAL '31 days', NOW()),
        ($2, $3, $6, $7, NOW() + INTERVAL '1 day', 'recent-ip', 'recent-ua', NOW() - INTERVAL '29 days', NOW())
    `, [oldSessionId, recentSessionId, userId, uuidv7(), `retention:${oldSessionId}`, uuidv7(), `retention:${recentSessionId}`]);
    await client.query(`
      INSERT INTO auth_sessions
        (id, user_id, token_family, refresh_token_hash, status, rotated_from_id, expires_at, created_at, updated_at)
      VALUES
        ($1, $3, $4, $5, 'EXPIRED', NULL, NOW() - INTERVAL '31 days', NOW() - INTERVAL '62 days', NOW()),
        ($2, $3, $6, $7, 'ACTIVE', $1, NOW() + INTERVAL '1 day', NOW(), NOW())
    `, [
      expiredSessionId,
      rotatedChildSessionId,
      userId,
      uuidv7(),
      `retention:${expiredSessionId}`,
      uuidv7(),
      `retention:${rotatedChildSessionId}`,
    ]);
    await client.query(
      "UPDATE auth_sessions SET replaced_by_id = $2, updated_at = NOW() WHERE id = $1",
      [expiredSessionId, rotatedChildSessionId],
    );
    await client.query(`
      INSERT INTO telegram_auth_replays
        (id, user_id, init_data_hash, auth_date, expires_at, created_at)
      VALUES
        ($1, $3, $4, NOW() - INTERVAL '31 days', NOW() - INTERVAL '30 days', NOW() - INTERVAL '31 days'),
        ($2, $3, $5, NOW() - INTERVAL '29 days', NOW() + INTERVAL '1 day', NOW() - INTERVAL '29 days')
    `, [oldReplayId, recentReplayId, userId, `retention:${oldReplayId}`, `retention:${recentReplayId}`]);
    await client.query(`
      INSERT INTO privacy_requests
        (id, user_id, type, status, request_hash, idempotency_key, requested_at, processing_started_at,
         completed_at, failed_at, failure_code, anonymized_at, retention_until, updated_at)
      VALUES
        ($1, $5, 'EXPORT', 'FAILED', repeat('a', 64), $6, NOW() - INTERVAL '10 days', NOW() - INTERVAL '9 days',
         NULL, NOW() - INTERVAL '8 days', 'integration_failure', NULL, NOW() - INTERVAL '1 day', NOW()),
        ($2, $5, 'DELETE', 'COMPLETED', repeat('b', 64), $7, NOW() - INTERVAL '10 days', NOW() - INTERVAL '9 days',
         NOW() - INTERVAL '8 days', NULL, NULL, NOW() - INTERVAL '8 days', NOW() - INTERVAL '1 day', NOW()),
        ($3, $5, 'EXPORT', 'PENDING', repeat('c', 64), $8, NOW() - INTERVAL '10 days', NULL,
         NULL, NULL, NULL, NULL, NOW() - INTERVAL '1 day', NOW()),
        ($4, $5, 'EXPORT', 'FAILED', repeat('d', 64), $9, NOW() - INTERVAL '10 days', NOW() - INTERVAL '9 days',
         NULL, NOW() - INTERVAL '8 days', 'integration_failure', NULL, NOW() + INTERVAL '1 day', NOW())
    `, [
      expiredFailedPrivacyId,
      expiredCompletedPrivacyId,
      pendingExpiredPrivacyId,
      futureFailedPrivacyId,
      userId,
      `retention:${expiredFailedPrivacyId}`,
      `retention:${expiredCompletedPrivacyId}`,
      `retention:${pendingExpiredPrivacyId}`,
      `retention:${futureFailedPrivacyId}`,
    ]);
    await client.query(`
      INSERT INTO api_clients (id, client_id, name, scopes, updated_at)
      VALUES ($1, $2, 'Retention integration client', ARRAY['integration:read'], NOW())
    `, [apiClientId, `retention-${apiClientId}`]);
    await client.query(`
      INSERT INTO webhook_subscriptions (id, api_client_id, url, secret_hash, event_types, updated_at)
      VALUES ($1, $2, 'https://example.com/retention', repeat('a', 64), ARRAY['content.release.published'], NOW())
    `, [subscriptionId, apiClientId]);
    await client.query(`
      INSERT INTO outbox_events
        (id, aggregate_type, aggregate_id, event_type, payload, status, published_at, idempotency_key, created_at, updated_at)
      VALUES
        ($1::uuid, 'retention', $1::text, 'content.release.published', '{}'::jsonb, 'PUBLISHED', NOW() - INTERVAL '31 days', $6, NOW() - INTERVAL '31 days', NOW() - INTERVAL '31 days'),
        ($2::uuid, 'retention', $2::text, 'content.release.published', '{}'::jsonb, 'PUBLISHED', NOW() - INTERVAL '91 days', $7, NOW() - INTERVAL '91 days', NOW() - INTERVAL '91 days'),
        ($3::uuid, 'retention', $3::text, 'content.release.published', '{}'::jsonb, 'PUBLISHED', NOW() - INTERVAL '31 days', $8, NOW() - INTERVAL '31 days', NOW() - INTERVAL '31 days'),
        ($4::uuid, 'retention', $4::text, 'content.release.published', '{}'::jsonb, 'PUBLISHED', NOW() - INTERVAL '29 days', $9, NOW() - INTERVAL '29 days', NOW() - INTERVAL '29 days'),
        ($5::uuid, 'retention', $5::text, 'content.release.published', '{}'::jsonb, 'FAILED', NULL, $10, NOW() - INTERVAL '91 days', NOW() - INTERVAL '91 days')
    `, [
      oldDeliveredOutboxId,
      oldDeadOutboxId,
      blockedOutboxId,
      recentOutboxId,
      failedOutboxId,
      `retention:${oldDeliveredOutboxId}`,
      `retention:${oldDeadOutboxId}`,
      `retention:${blockedOutboxId}`,
      `retention:${recentOutboxId}`,
      `retention:${failedOutboxId}`,
    ]);
    await client.query(`
      INSERT INTO webhook_deliveries
        (id, webhook_subscription_id, outbox_event_id, event_id, status, attempt_count, response_status,
         last_error, delivered_at, next_attempt_at, created_at, updated_at)
      VALUES
        ($1, $5, $6, $6, 'DELIVERED', 1, 204, NULL, NOW() - INTERVAL '31 days', NULL, NOW() - INTERVAL '31 days', NOW() - INTERVAL '31 days'),
        ($2, $5, $7, $7, 'DEAD', 8, 503, 'terminal', NULL, NULL, NOW() - INTERVAL '91 days', NOW() - INTERVAL '91 days'),
        ($3, $5, $8, $8, 'PENDING', 1, NULL, NULL, NULL, NOW(), NOW() - INTERVAL '31 days', NOW() - INTERVAL '31 days'),
        ($4, $5, $9, $9, 'DELIVERED', 1, 204, NULL, NOW() - INTERVAL '29 days', NULL, NOW() - INTERVAL '29 days', NOW() - INTERVAL '29 days')
    `, [
      oldDeliveredId,
      oldDeadId,
      blockedDeliveryId,
      recentDeliveryId,
      subscriptionId,
      oldDeliveredOutboxId,
      oldDeadOutboxId,
      blockedOutboxId,
      recentOutboxId,
    ]);
    await client.query(`
      INSERT INTO admin_audit_logs
        (id, action, resource_type, reason, correlation_id, idempotency_key, created_at)
      VALUES
        ($1, 'retention.test', 'integration', 'Retention boundary test', $3, $4, NOW() - INTERVAL '1 year 1 day'),
        ($2, 'retention.test', 'integration', 'Retention boundary test', $5, $6, NOW() - INTERVAL '364 days')
    `, [oldAuditId, recentAuditId, uuidv7(), `retention:${oldAuditId}`, uuidv7(), `retention:${recentAuditId}`]);

    await client.query("SET ROLE spacey_jobs");
    const maintenance = new PostgresRetentionMaintenance(transactionBoundPool(client, ownerPool), 20);
    const result = await maintenance.runOnce();
    await client.query("RESET ROLE");

    assert.deepEqual(result, {
      skippedLock: false,
      authSessionsDeleted: 1,
      authSessionsScrubbed: 1,
      telegramAuthReplaysDeleted: 1,
      privacyRequestsDeleted: 2,
      webhookDeliveriesDeleted: 2,
      outboxEventsDeleted: 2,
      adminAuditLogsDeleted: 1,
    });
    assert.deepEqual((await client.query<{ ip_hash: string | null; user_agent_hash: string | null }>(
      "SELECT ip_hash, user_agent_hash FROM auth_sessions WHERE id = $1",
      [oldSessionId],
    )).rows[0], { ip_hash: null, user_agent_hash: null });
    assert.deepEqual((await client.query<{ ip_hash: string | null; user_agent_hash: string | null }>(
      "SELECT ip_hash, user_agent_hash FROM auth_sessions WHERE id = $1",
      [recentSessionId],
    )).rows[0], { ip_hash: "recent-ip", user_agent_hash: "recent-ua" });
    assert.equal(await rowExists(client, "auth_sessions", expiredSessionId), false);
    assert.equal((await client.query<{ rotated_from_id: string | null }>(
      "SELECT rotated_from_id FROM auth_sessions WHERE id = $1",
      [rotatedChildSessionId],
    )).rows[0]?.rotated_from_id, null);
    assert.equal(await rowExists(client, "telegram_auth_replays", oldReplayId), false);
    assert.equal(await rowExists(client, "telegram_auth_replays", recentReplayId), true);
    assert.equal(await rowExists(client, "privacy_requests", expiredFailedPrivacyId), false);
    assert.equal(await rowExists(client, "privacy_requests", expiredCompletedPrivacyId), false);
    assert.equal(await rowExists(client, "privacy_requests", pendingExpiredPrivacyId), true);
    assert.equal(await rowExists(client, "privacy_requests", futureFailedPrivacyId), true);
    assert.equal(await rowExists(client, "webhook_deliveries", oldDeliveredId), false);
    assert.equal(await rowExists(client, "webhook_deliveries", oldDeadId), false);
    assert.equal(await rowExists(client, "webhook_deliveries", blockedDeliveryId), true);
    assert.equal(await rowExists(client, "webhook_deliveries", recentDeliveryId), true);
    assert.equal(await rowExists(client, "outbox_events", oldDeliveredOutboxId), false);
    assert.equal(await rowExists(client, "outbox_events", oldDeadOutboxId), false);
    assert.equal(await rowExists(client, "outbox_events", blockedOutboxId), true);
    assert.equal(await rowExists(client, "outbox_events", recentOutboxId), true);
    assert.equal(await rowExists(client, "outbox_events", failedOutboxId), true);
    assert.equal(await rowExists(client, "admin_audit_logs", oldAuditId), false);
    assert.equal(await rowExists(client, "admin_audit_logs", recentAuditId), true);

    const jobsMaintenance = new PostgresRetentionMaintenance(jobsPool, 20);
    await jobsMaintenance.ping();
    assert.equal((await jobsMaintenance.runOnce()).skippedLock, true);
    await assert.rejects(
      () => jobsPool.query("SELECT spacey_jobs_purge_admin_audit_logs(0)"),
      /between 1 and 5000/,
    );
    const deletePrivileges = await jobsPool.query<{ table_name: string; allowed: boolean }>(`
      SELECT table_name,
             has_table_privilege(current_user, table_name, 'DELETE') AS allowed
        FROM unnest(ARRAY[
          'admin_audit_logs', 'privacy_requests', 'telegram_auth_replays', 'webhook_deliveries', 'outbox_events'
        ]) AS table_name
       ORDER BY table_name
    `);
    assert.deepEqual(deletePrivileges.rows, [
      { table_name: "admin_audit_logs", allowed: false },
      { table_name: "outbox_events", allowed: false },
      { table_name: "privacy_requests", allowed: false },
      { table_name: "telegram_auth_replays", allowed: false },
      { table_name: "webhook_deliveries", allowed: false },
    ]);

    await client.query("SAVEPOINT immutable_audit");
    await assert.rejects(
      () => client.query("DELETE FROM admin_audit_logs WHERE id = $1", [recentAuditId]),
      /append-only/,
    );
    await client.query("ROLLBACK TO SAVEPOINT immutable_audit");
  } finally {
    await client.query("RESET ROLE").catch(() => undefined);
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await jobsPool.end();
    await ownerPool.end();
  }
});

function transactionBoundPool(client: PoolClient, fallback: Pool): Pick<Pool, "connect" | "query"> {
  return {
    connect: async () => ({
      query: async (text: string, values?: readonly unknown[]) => {
        if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") return client.query("SELECT 1");
        return client.query(text, values as unknown[] | undefined);
      },
      release: () => undefined,
    }) as unknown as PoolClient,
    query: fallback.query.bind(fallback),
  } as unknown as Pick<Pool, "connect" | "query">;
}

async function rowExists(client: PoolClient, table: string, id: string): Promise<boolean> {
  const allowedTables = new Set([
    "auth_sessions", "telegram_auth_replays", "privacy_requests", "webhook_deliveries", "outbox_events", "admin_audit_logs",
  ]);
  if (!allowedTables.has(table)) throw new Error("Unexpected integration-test table");
  const result = await client.query<{ exists: boolean }>(`SELECT EXISTS (SELECT 1 FROM ${table} WHERE id = $1) AS exists`, [id]);
  return result.rows[0]?.exists ?? false;
}
