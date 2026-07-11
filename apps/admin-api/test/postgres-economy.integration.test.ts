import assert from "node:assert/strict";
import test from "node:test";
import { createUuidV7 } from "@spacey/db";
import { Pool } from "pg";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

test("admin economy function is role-scoped and idempotent", { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  const userId = createUuidV7();
  const balanceId = createUuidV7();
  const ledgerId = createUuidV7();
  const sourceId = createUuidV7();
  const idempotencyKey = `admin-integration:${createUuidV7()}`;
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO users (id, display_name, updated_at) VALUES ($1, 'Admin integration pilot', NOW())",
      [userId],
    );
    await client.query("SET ROLE spacey_admin");
    const adjust = async (requestedBalanceId: string, requestedLedgerId: string) => client.query<{
      before_balance: string;
      after_balance: string;
      idempotent: boolean;
    }>(`
      SELECT before_balance::text, after_balance::text, idempotent
      FROM spacey_admin_adjust_wallet(
        $1::uuid, $2::uuid, $3::uuid, 'CREDITS'::wallet_currency, 25::bigint,
        $4, $5::uuid, '{"caseId":"CASE-INTEGRATION","reason":"integration test"}'::jsonb
      )
    `, [requestedBalanceId, requestedLedgerId, userId, idempotencyKey, sourceId]);
    assert.deepEqual((await adjust(balanceId, ledgerId)).rows[0], {
      before_balance: "0",
      after_balance: "25",
      idempotent: false,
    });
    assert.deepEqual((await adjust(createUuidV7(), createUuidV7())).rows[0], {
      before_balance: "0",
      after_balance: "25",
      idempotent: true,
    });
  } finally {
    try {
      await client.query("RESET ROLE");
      await client.query("ROLLBACK");
    } finally {
      client.release();
      await pool.end();
    }
  }
});
