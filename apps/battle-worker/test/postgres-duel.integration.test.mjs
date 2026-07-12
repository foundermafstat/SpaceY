import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

import { createUuidV7 } from "@spacey/db";
import { DuelSimulation } from "@spacey/simulation";
import { PostgresBattleFinalizer } from "../src/postgres-finalizer.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;

test("PostgreSQL materializes, prepares and finalizes one PvP duel exactly once", { skip: !databaseUrl }, async () => {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  const ids = Object.fromEntries([
    "alphaUser", "betaUser", "release", "mission", "season", "alphaSeason", "betaSeason",
    "alphaBuild", "betaBuild", "alphaRevision", "betaRevision", "alphaItem", "betaItem",
    "module", "alphaInstalled", "betaInstalled", "alphaTicket", "betaTicket", "match",
    "alphaParticipant", "betaParticipant", "alphaAttempt", "betaAttempt", "session", "outbox",
  ].map((key) => [key, createUuidV7()]));
  const finalizer = new PostgresBattleFinalizer(databaseUrl, 1);
  const originalFinalizerPool = finalizer.pool;
  const transactionClient = savepointClient(client);

  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO users (id, display_name, updated_at)
       VALUES ($1, 'Alpha integration pilot', NOW()), ($2, 'Beta integration pilot', NOW())`,
      [ids.alphaUser, ids.betaUser],
    );
    await client.query(
      `INSERT INTO content_releases
        (id, version, status, config_hash, schema_version, published_at, updated_at)
       VALUES ($1, $2, 'PUBLISHED', $3, 1, NOW(), NOW())`,
      [ids.release, `pvp-integration-${ids.release}`, ids.release.replaceAll("-", "")],
    );
    await client.query(
      `INSERT INTO mission_definitions
        (id, content_release_id, key, type, risk, title, description, objective,
         enemy_roster, reward_definition, duration_seconds, updated_at)
       VALUES ($1, $2, 'ranked-duel-integration', 'INTERCEPT', 'RED', 'Ranked Duel',
               'Integration fixture', '{"type":"destroy_opponent","target":1}'::jsonb,
               '[]'::jsonb, '{}'::jsonb, 90, NOW())`,
      [ids.mission, ids.release],
    );
    await client.query(
      `INSERT INTO module_definitions
        (id, content_release_id, key, category, kind, rarity, shape, stats, damage_states, updated_at)
       VALUES ($1, $2, 'integration-core', 'structure', 'core', 'common', '{}'::jsonb,
               '{"hp":300,"thrust":120,"damage":40,"range":600,"cooldownMs":200,"projectileSpeed":900,"collisionRadius":30}'::jsonb,
               '[]'::jsonb, NOW())`,
      [ids.module, ids.release],
    );
    await client.query(
      `INSERT INTO ship_builds (id, user_id, name, updated_at)
       VALUES ($1, $2, 'Alpha integration build', NOW()), ($3, $4, 'Beta integration build', NOW())`,
      [ids.alphaBuild, ids.alphaUser, ids.betaBuild, ids.betaUser],
    );
    await client.query(
      `INSERT INTO ship_build_revisions
        (id, build_id, content_release_id, version, schema_version, snapshot, snapshot_hash, total_mass, total_power)
       VALUES ($1, $2, $3, 1, 3, '{}'::jsonb, $4, 1, 1),
              ($5, $6, $3, 1, 3, '{}'::jsonb, $7, 1, 1)`,
      [ids.alphaRevision, ids.alphaBuild, ids.release, ids.alphaRevision.replaceAll("-", ""), ids.betaRevision, ids.betaBuild, ids.betaRevision.replaceAll("-", "")],
    );
    await client.query(
      `UPDATE ship_builds
          SET current_revision_id = CASE WHEN id = $1 THEN $2::uuid ELSE $4::uuid END, updated_at = NOW()
        WHERE id IN ($1, $3)`,
      [ids.alphaBuild, ids.alphaRevision, ids.betaBuild, ids.betaRevision],
    );
    await client.query(
      `INSERT INTO inventory_items
        (id, user_id, content_release_id, definition_key, state, durability, updated_at)
       VALUES ($1, $2, $3, 'integration-core', 'INSTALLED', 10000, NOW()),
              ($4, $5, $3, 'integration-core', 'INSTALLED', 7100, NOW())`,
      [ids.alphaItem, ids.alphaUser, ids.release, ids.betaItem, ids.betaUser],
    );
    await client.query(
      `INSERT INTO build_revision_items (id, build_revision_id, inventory_item_id, slot_key, placement)
       VALUES ($1, $2, $3, 'core', '{}'::jsonb), ($4, $5, $6, 'core', '{}'::jsonb)`,
      [ids.alphaInstalled, ids.alphaRevision, ids.alphaItem, ids.betaInstalled, ids.betaRevision, ids.betaItem],
    );
    await client.query(
      `INSERT INTO seasons (id, key, status, rules, starts_at, ends_at, updated_at)
       VALUES ($1, $2, 'ACTIVE', '{"matchmakingQueues":{"ranked-eu":{"mmrKFactor":32}}}'::jsonb,
               NOW() - INTERVAL '1 hour', NOW() + INTERVAL '1 day', NOW())`,
      [ids.season, `pvp-integration-${ids.season}`],
    );
    await client.query(
      `INSERT INTO season_participants (id, season_id, user_id, rating, updated_at)
       VALUES ($1, $2, $3, 1000, NOW()), ($4, $2, $5, 1000, NOW())`,
      [ids.alphaSeason, ids.season, ids.alphaUser, ids.betaSeason, ids.betaUser],
    );
    await client.query(
      `INSERT INTO matchmaking_tickets
        (id, user_id, build_revision_id, season_id, content_release_id, mission_definition_id,
         queue, region, mmr, base_mmr_window, expansion_per_second, max_mmr_window,
         request_hash, idempotency_key, expires_at, updated_at)
       VALUES
        ($1, $2, $3, $4, $5, $6, 'ranked-eu', 'eu', 1000, 50, 10, 200,
         repeat('a', 64), $7, NOW() + INTERVAL '10 minutes', NOW()),
        ($8, $9, $10, $4, $5, $6, 'ranked-eu', 'eu', 1000, 50, 10, 200,
         repeat('b', 64), $11, NOW() + INTERVAL '10 minutes', NOW())`,
      [
        ids.alphaTicket, ids.alphaUser, ids.alphaRevision, ids.season, ids.release, ids.mission,
        ids.alphaTicket.replaceAll("-", "").repeat(2), ids.betaTicket, ids.betaUser, ids.betaRevision,
        ids.betaTicket.replaceAll("-", "").repeat(2),
      ],
    );

    await client.query("SET LOCAL ROLE spacey_runtime");
    await client.query("SELECT set_config('spacey.user_id', $1, true)", [ids.alphaUser]);
    await expectSqlState(
      client,
      "SELECT spacey_assert_owned_build_launchable($1::uuid)",
      [ids.alphaRevision],
      "23514",
    );
    const materialized = await client.query(
      `SELECT * FROM spacey_materialize_pvp_match(
        $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::uuid,
        $8::uuid, $9::uuid, 2::bigint, '2.0.0'::text
      )`,
      [
        ids.alphaTicket, ids.betaTicket, ids.match, ids.alphaParticipant, ids.betaParticipant,
        ids.alphaAttempt, ids.betaAttempt, ids.session, ids.outbox,
      ],
    );
    assert.equal(materialized.rowCount, 1);
    const alphaPrepared = await client.query(
      "SELECT * FROM spacey_prepare_pvp_connection($1::uuid, repeat('c', 64), NOW() + INTERVAL '30 seconds')",
      [ids.alphaTicket],
    );
    assert.equal(alphaPrepared.rowCount, 2);
    await client.query("SELECT set_config('spacey.user_id', $1, true)", [ids.betaUser]);
    const betaPrepared = await client.query(
      "SELECT * FROM spacey_prepare_pvp_connection($1::uuid, repeat('d', 64), NOW() + INTERVAL '30 seconds')",
      [ids.betaTicket],
    );
    assert.equal(betaPrepared.rowCount, 2);
    await client.query("RESET ROLE");

    const simulationConfig = {
      matchId: ids.match,
      sessionId: ids.session,
      seed: 2,
      contentVersion: `pvp-integration-${ids.release}`,
      simulationVersion: "2.0.0",
      durationSeconds: 90,
      arenaWidthUnits: 600,
      arenaHeightUnits: 300,
      participants: [
        {
          participantId: ids.alphaParticipant,
          userId: ids.alphaUser,
          side: "alpha",
          shipBuildRevisionId: ids.alphaRevision,
          buildStats: buildStats(ids.alphaItem),
        },
        {
          participantId: ids.betaParticipant,
          userId: ids.betaUser,
          side: "beta",
          shipBuildRevisionId: ids.betaRevision,
          buildStats: buildStats(ids.betaItem),
        },
      ],
    };
    const simulation = new DuelSimulation(simulationConfig);
    assert.deepEqual(simulation.enqueueInput(ids.alphaUser, {
      seq: 1,
      targetTick: 1,
      moveX: 0,
      moveY: 0,
      aimX: 1_000,
      aimY: 0,
      actionFlags: 1,
    }), { accepted: true, scheduledTick: 1 });
    simulation.advanceTicks(12);
    const outcome = simulation.forceForfeit(ids.betaUser);
    const finalCheckpoint = simulation.createCheckpoint();
    const replay = {
      storageKey: `integration/pvp/${ids.match}.jsonl.gz`,
      checksumSha256: "e".repeat(64),
      compression: "gzip",
      sizeBytes: 128,
      tickCount: outcome.finalTick,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
    const request = {
      idempotencyKey: `pvp-match:${ids.match}`,
      sessionId: ids.session,
      matchId: ids.match,
      participants: [
        { userId: ids.alphaUser, attemptId: ids.alphaAttempt, participantId: ids.alphaParticipant, side: 0 },
        { userId: ids.betaUser, attemptId: ids.betaAttempt, participantId: ids.betaParticipant, side: 1 },
      ],
      simulationConfig,
      finalCheckpoint,
      replay: null,
      cancellation: null,
      outcome,
    };

    await client.query("SET LOCAL ROLE spacey_battle_worker");
    finalizer.pool = { connect: async () => transactionClient };
    const first = await finalizer.finalizeDuelOnce(request);
    const replayed = await finalizer.finalizeDuelOnce(request);
    assert.deepEqual(replayed, first);
    const replayRequest = {
      kind: "pvp",
      idempotencyKey: `${request.idempotencyKey}:replay`,
      matchId: ids.match,
      replay,
    };
    await finalizer.attachReplayOnce(replayRequest);
    await finalizer.attachReplayOnce(replayRequest);
    await client.query("RESET ROLE");

    const ratings = await client.query(
      `SELECT user_id AS "userId", rating, wins, losses
         FROM season_participants
        WHERE season_id = $1
        ORDER BY user_id`,
      [ids.season],
    );
    assert.deepEqual(
      new Map(ratings.rows.map((row) => [row.userId, { rating: row.rating, wins: row.wins, losses: row.losses }])),
      new Map([
        [ids.alphaUser, { rating: 1016, wins: 1, losses: 0 }],
        [ids.betaUser, { rating: 984, wins: 0, losses: 1 }],
      ]),
    );
    assert.equal(Number((await client.query(
      "SELECT count(*)::int AS count FROM mission_results result JOIN mission_attempts attempt ON attempt.id = result.mission_attempt_id WHERE attempt.pvp_match_id = $1",
      [ids.match],
    )).rows[0].count), 2);
    assert.equal(Number((await client.query(
      "SELECT count(*)::int AS count FROM replay_metadata WHERE pvp_match_id = $1",
      [ids.match],
    )).rows[0].count), 1);
    assert.deepEqual((await client.query(
      `SELECT DISTINCT metrics ? 'replayStatus' AS "hasReplayStatus",
                       metrics ? 'progressionAfter' AS "hasProgressionSnapshot",
                       rewards ? 'walletAfter' AS "hasWalletSnapshot"
         FROM mission_results result
         JOIN mission_attempts attempt ON attempt.id = result.mission_attempt_id
        WHERE attempt.pvp_match_id = $1`,
      [ids.match],
    )).rows, [{ hasReplayStatus: false, hasProgressionSnapshot: true, hasWalletSnapshot: true }]);
    const damagedItems = await client.query(
      `SELECT id, state::text, durability
         FROM inventory_items
        WHERE id IN ($1, $2)
        ORDER BY id`,
      [ids.alphaItem, ids.betaItem],
    );
    const itemState = new Map(damagedItems.rows.map((row) => [row.id, { state: row.state, durability: row.durability }]));
    assert.deepEqual(itemState.get(ids.alphaItem), { state: "INSTALLED", durability: 10000 });
    assert.deepEqual(itemState.get(ids.betaItem), { state: "DAMAGED", durability: 6966 });
    const transitions = await client.query(
      `SELECT inventory_item_id AS "itemId", from_state::text AS "fromState",
              to_state::text AS "toState", metadata
         FROM inventory_transitions
        WHERE source_type = 'PVP_MATCH' AND source_id = $1`,
      [ids.match],
    );
    assert.equal(transitions.rowCount, 1);
    assert.deepEqual(
      {
        itemId: transitions.rows[0].itemId,
        fromState: transitions.rows[0].fromState,
        toState: transitions.rows[0].toState,
        durability: transitions.rows[0].metadata.durability,
      },
      {
        itemId: ids.betaItem,
        fromState: "INSTALLED",
        toState: "DAMAGED",
        durability: { before: 7100, loss: 134, after: 6966, damagedBelow: 7000, destroyedAt: 0 },
      },
    );
  } finally {
    finalizer.pool = originalFinalizerPool;
    try {
      await client.query("ROLLBACK");
      await client.query("RESET ROLE");
    } finally {
      client.release();
      await Promise.all([pool.end(), originalFinalizerPool.end()]);
    }
  }
});

function buildStats(inventoryItemId) {
  return {
    hull: 300,
    speedUnitsPerSecond: 240,
    weaponDamage: 40,
    weaponRangeUnits: 600,
    weaponCooldownTicks: 6,
    projectileSpeedUnitsPerSecond: 900,
    collisionRadiusUnits: 30,
    modules: [{
      id: inventoryItemId,
      inventoryItemId,
      category: "core",
      hp: 300,
      gridX: 0,
      gridY: 0,
    }],
  };
}

function savepointClient(client) {
  return {
    async query(text, params) {
      if (text === "BEGIN") return client.query("SAVEPOINT duel_finalize");
      if (text === "COMMIT") return client.query("RELEASE SAVEPOINT duel_finalize");
      if (text === "ROLLBACK") {
        await client.query("ROLLBACK TO SAVEPOINT duel_finalize");
        return client.query("RELEASE SAVEPOINT duel_finalize");
      }
      return client.query(text, params);
    },
    release() {},
  };
}

async function expectSqlState(client, query, params, expectedCode) {
  await client.query("SAVEPOINT expected_sql_error");
  let caught;
  try {
    await client.query(query, params);
  } catch (error) {
    caught = error;
  }
  await client.query("ROLLBACK TO SAVEPOINT expected_sql_error");
  await client.query("RELEASE SAVEPOINT expected_sql_error");
  assert.equal(caught?.code, expectedCode);
}
