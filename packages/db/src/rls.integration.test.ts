import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { createUuidV7 } from "./uuidv7.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

test("runtime ownership, public consent and battle service RLS policies are enforced", { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  const ownerId = createUuidV7();
  const privateId = createUuidV7();
  const ownerPrivacyRequestId = createUuidV7();
  const privatePrivacyRequestId = createUuidV7();
  const telegramIdentityId = createUuidV7();
  const authSessionId = createUuidV7();
  const authReplayId = createUuidV7();
  const completionOutboxId = createUuidV7();
  const telegramUserId = BigInt(`0x${ownerId.replaceAll("-", "").slice(-15)}`);
  try {
    await client.query("BEGIN");
    await client.query(`
      INSERT INTO users (id, display_name, profile_public, analytics_consent_at, updated_at)
      VALUES ($1, 'Public RLS pilot', true, NOW(), NOW()), ($2, 'Private RLS pilot', false, NULL, NOW())
    `, [ownerId, privateId]);
    await client.query(`
      INSERT INTO wallet_balances (id, user_id, currency, updated_at)
      VALUES ($1, $2, 'CREDITS', NOW())
    `, [createUuidV7(), ownerId]);
    await client.query(`
      INSERT INTO privacy_requests
        (id, user_id, type, request_hash, idempotency_key, retention_until, updated_at)
      VALUES
        ($1, $2, 'EXPORT', repeat('a', 64), 'privacy-owner-0001', NOW() + INTERVAL '1 year', NOW()),
        ($3, $4, 'DELETE', repeat('b', 64), 'privacy-private-01', NOW() + INTERVAL '1 year', NOW())
    `, [ownerPrivacyRequestId, ownerId, privatePrivacyRequestId, privateId]);
    await client.query(`
      INSERT INTO telegram_identities (id, user_id, telegram_user_id, first_name, updated_at)
      VALUES ($1, $2, $3, 'Privacy pilot', NOW())
    `, [telegramIdentityId, ownerId, telegramUserId]);
    await client.query(`
      INSERT INTO auth_sessions
        (id, user_id, token_family, refresh_token_hash, expires_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 hour', NOW())
    `, [authSessionId, ownerId, createUuidV7(), `privacy-test:${authSessionId}`]);
    await client.query(`
      INSERT INTO telegram_auth_replays
        (id, user_id, init_data_hash, telegram_user_id, auth_date, expires_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW() + INTERVAL '5 minutes')
    `, [authReplayId, ownerId, `privacy-test:${authReplayId}`, telegramUserId]);

    await client.query("SET ROLE spacey_runtime");
    assert.equal(Number((await client.query<{ count: string }>("SELECT count(*)::text AS count FROM users")).rows[0]?.count), 0);
    assert.equal(Number((await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM spacey_public_profile($1::uuid)",
      [ownerId],
    )).rows[0]?.count), 1);
    assert.equal(Number((await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM spacey_public_profile($1::uuid)",
      [privateId],
    )).rows[0]?.count), 0);
    await client.query("SELECT set_config('spacey.user_id', $1, true)", [ownerId]);
    assert.equal(Number((await client.query<{ count: string }>("SELECT count(*)::text AS count FROM users")).rows[0]?.count), 1);
    assert.equal(Number((await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM privacy_requests",
    )).rows[0]?.count), 1);

    await client.query("RESET ROLE");
    await client.query("SELECT set_config('spacey.user_id', '', true)");
    await client.query("SET ROLE spacey_battle_worker");
    assert.equal(Number((await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM wallet_balances WHERE user_id = $1",
      [ownerId],
    )).rows[0]?.count), 1);

    await client.query("RESET ROLE");
    await client.query("SELECT set_config('spacey.user_id', '', true)");
    await client.query("SET ROLE spacey_jobs");
    await client.query("SELECT set_config('spacey.user_id', $1, true)", [ownerId]);
    assert.equal(Number((await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM privacy_requests",
    )).rows[0]?.count), 2);
    assert.equal((await client.query(
      "UPDATE users SET profile_public = false, updated_at = NOW() WHERE id = $1",
      [ownerId],
    )).rowCount, 1);
    assert.equal((await client.query(`
      UPDATE privacy_requests
         SET status = 'PROCESSING', processing_started_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND user_id = $2
    `, [ownerPrivacyRequestId, ownerId])).rowCount, 1);
    assert.equal((await client.query(`
      UPDATE auth_sessions
         SET status = 'REVOKED', refresh_token_hash = 'deleted:' || id::text,
             ip_hash = NULL, user_agent_hash = NULL, revoked_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND user_id = $2
    `, [authSessionId, ownerId])).rowCount, 1);
    assert.equal((await client.query(`
      UPDATE telegram_auth_replays SET user_id = NULL, telegram_user_id = NULL WHERE id = $1
    `, [authReplayId])).rowCount, 1);
    assert.equal((await client.query(
      "DELETE FROM telegram_identities WHERE id = $1 AND user_id = $2",
      [telegramIdentityId, ownerId],
    )).rowCount, 1);
    await client.query("DELETE FROM telegram_support_messages WHERE telegram_user_id = $1", [telegramUserId]);
    await client.query("DELETE FROM telegram_support_tickets WHERE telegram_user_id = $1", [telegramUserId]);
    await client.query("DELETE FROM telegram_referrals WHERE telegram_user_id = $1", [telegramUserId]);
    await client.query("DELETE FROM telegram_notification_preferences WHERE telegram_user_id = $1", [telegramUserId]);
    assert.equal((await client.query(`
      INSERT INTO outbox_events
        (id, aggregate_type, aggregate_id, event_type, payload, idempotency_key, updated_at)
      VALUES ($1, 'privacy-request', $2, 'privacy.export.completed', '{}'::jsonb, $3, NOW())
    `, [completionOutboxId, ownerPrivacyRequestId, `privacy-request:${ownerPrivacyRequestId}:completed`])).rowCount, 1);
  } finally {
    try {
      await client.query("ROLLBACK");
      await client.query("RESET ROLE");
    } finally {
      client.release();
      await pool.end();
    }
  }
});
