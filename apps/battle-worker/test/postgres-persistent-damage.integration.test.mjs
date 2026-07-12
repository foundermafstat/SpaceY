import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

import { createUuidV7 } from "@spacey/db";
import { MissionSimulation } from "@spacey/simulation";
import { hashSimulationConfig, PostgresBattleFinalizer } from "../src/postgres-finalizer.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;

test("PostgreSQL finalizes PvE module damage and transition exactly once", { skip: !databaseUrl }, async () => {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  const ids = Object.fromEntries([
    "user", "release", "mission", "module", "build", "oldRevision", "revision", "item",
    "oldInstalled", "installed", "attempt", "session",
  ].map((key) => [key, createUuidV7()]));
  const finalizer = new PostgresBattleFinalizer(databaseUrl, 1);
  const originalFinalizerPool = finalizer.pool;
  const transactionClient = savepointClient(client);

  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO users (id, display_name, updated_at) VALUES ($1, 'PvE damage pilot', NOW())`,
      [ids.user],
    );
    await client.query(
      `INSERT INTO content_releases
        (id, version, status, config_hash, schema_version, updated_at)
       VALUES ($1, $2, 'DRAFT', $3, 1, NOW())`,
      [ids.release, `pve-damage-${ids.release}`, ids.release.replaceAll("-", "").repeat(2)],
    );
    await client.query(
      `INSERT INTO mission_definitions
        (id, content_release_id, key, type, risk, title, description, objective,
         enemy_roster, reward_definition, duration_seconds, updated_at)
       VALUES ($1, $2, 'pve-damage-integration', 'DEFENSE', 'GREEN', 'Damage fixture',
               'Integration fixture', '{"type":"survive_seconds","target":90}'::jsonb,
               '[]'::jsonb, '{}'::jsonb, 90, NOW())`,
      [ids.mission, ids.release],
    );
    await client.query(
      `INSERT INTO module_definitions
        (id, content_release_id, key, category, kind, rarity, shape, stats, damage_states, updated_at)
       VALUES ($1, $2, 'pve-damage-core', 'structure', 'core', 'common', '{}'::jsonb,
               '{"hp":300}'::jsonb, '[]'::jsonb, NOW())`,
      [ids.module, ids.release],
    );
    await client.query(
      `UPDATE content_releases SET status = 'PUBLISHED', published_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [ids.release],
    );
    await client.query(
      `INSERT INTO ship_builds (id, user_id, name, updated_at)
       VALUES ($1, $2, 'PvE damage build', NOW())`,
      [ids.build, ids.user],
    );
    await client.query(
      `INSERT INTO ship_build_revisions
        (id, build_id, content_release_id, version, schema_version, snapshot, snapshot_hash, total_mass, total_power)
       VALUES ($1, $3, $4, 1, 3, '{}'::jsonb, $5, 1, 1),
              ($2, $3, $4, 2, 3, '{}'::jsonb, $6, 1, 1)`,
      [
        ids.oldRevision,
        ids.revision,
        ids.build,
        ids.release,
        ids.oldRevision.replaceAll("-", ""),
        ids.revision.replaceAll("-", ""),
      ],
    );
    await client.query(
      `UPDATE ship_builds SET current_revision_id = $2, updated_at = NOW() WHERE id = $1`,
      [ids.build, ids.revision],
    );
    await client.query(
      `INSERT INTO inventory_items
        (id, user_id, content_release_id, definition_key, state, durability, updated_at)
       VALUES ($1, $2, $3, 'pve-damage-core', 'INSTALLED', 7100, NOW())`,
      [ids.item, ids.user, ids.release],
    );
    await client.query(
      `INSERT INTO build_revision_items (id, build_revision_id, inventory_item_id, slot_key, placement)
       VALUES ($1, $3, $4, 'core', '{}'::jsonb),
              ($2, $5, $4, 'core', '{}'::jsonb)`,
      [ids.oldInstalled, ids.installed, ids.oldRevision, ids.item, ids.revision],
    );
    await client.query("SET LOCAL ROLE spacey_runtime");
    await client.query("SELECT set_config('spacey.user_id', $1, true)", [ids.user]);
    await expectSqlState(
      client,
      "SELECT spacey_assert_owned_build_launchable($1::uuid)",
      [ids.oldRevision],
      "23514",
    );
    await client.query("RESET ROLE");
    await client.query(
      `INSERT INTO mission_attempts
        (id, user_id, mission_definition_id, content_release_id, build_revision_id, type,
         status, seed, simulation_version, idempotency_key, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'PVE', 'CONNECTING', 7, '2.0.0', $6, NOW())`,
      [ids.attempt, ids.user, ids.mission, ids.release, ids.revision, `fixture:${ids.attempt}`],
    );
    await client.query(
      `INSERT INTO battle_sessions
        (id, mission_attempt_id, content_release_id, simulation_version, updated_at)
       VALUES ($1, $2, $3, '2.0.0', NOW())`,
      [ids.session, ids.attempt, ids.release],
    );

    const simulationConfig = {
      sessionId: ids.session,
      attemptId: ids.attempt,
      missionId: "pve-damage-integration",
      mode: "pve",
      seed: 7,
      contentVersion: `pve-damage-${ids.release}`,
      simulationVersion: "2.0.0",
      shipBuildRevisionId: ids.revision,
      durationSeconds: 90,
      objective: { type: "survive_seconds", targetSeconds: 90 },
      arenaWidthUnits: 600,
      arenaHeightUnits: 300,
      enemyCount: 1,
      player: {
        hull: 300,
        speedUnitsPerSecond: 100,
        weaponDamage: 1,
        weaponRangeUnits: 100,
        weaponCooldownTicks: 30,
        projectileSpeedUnitsPerSecond: 100,
        modules: [{
          id: ids.item,
          inventoryItemId: ids.item,
          category: "core",
          hp: 300,
          gridX: 0,
          gridY: 0,
        }],
      },
      enemy: {
        hull: 100,
        speedUnitsPerSecond: 1,
        collisionRadiusUnits: 20,
        attackDamage: 60,
        attackRangeUnits: 10_000,
        attackCooldownTicks: 30,
      },
    };
    await client.query(
      `UPDATE battle_sessions
          SET simulation_config = $2::jsonb, simulation_config_hash = $3, updated_at = NOW()
        WHERE id = $1`,
      [ids.session, JSON.stringify(simulationConfig), hashSimulationConfig(simulationConfig)],
    );
    const simulation = new MissionSimulation(simulationConfig);
    simulation.advanceTicks(30);
    const outcome = simulation.forceForfeit();
    const finalCheckpoint = simulation.createCheckpoint();
    assert.equal(finalCheckpoint.state.player.hull, 240);
    const replay = {
      storageKey: `integration/pve/${ids.attempt}.jsonl.gz`,
      checksumSha256: "f".repeat(64),
      compression: "gzip",
      sizeBytes: 128,
      tickCount: outcome.finalTick,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
    const request = {
      idempotencyKey: `pve-result:${ids.attempt}`,
      sessionId: ids.session,
      attemptId: ids.attempt,
      userId: ids.user,
      mode: "pve",
      simulationConfig,
      finalCheckpoint,
      replay: null,
      outcome,
    };

    await client.query("SET LOCAL ROLE spacey_battle_worker");
    finalizer.pool = { connect: async () => transactionClient };
    const first = await finalizer.finalizeOnce(request);
    assert.deepEqual(await finalizer.finalizeOnce(request), first);
    const replayRequest = {
      kind: "pve",
      idempotencyKey: `${request.idempotencyKey}:replay`,
      attemptId: ids.attempt,
      replay,
    };
    await finalizer.attachReplayOnce(replayRequest);
    await finalizer.attachReplayOnce(replayRequest);
    await client.query("RESET ROLE");

    const resultSnapshot = (await client.query(
      `SELECT metrics ? 'replayStatus' AS "hasReplayStatus",
              metrics ? 'progressionAfter' AS "hasProgressionSnapshot",
              rewards ? 'walletAfter' AS "hasWalletSnapshot"
         FROM mission_results WHERE mission_attempt_id = $1`,
      [ids.attempt],
    )).rows[0];
    assert.deepEqual(resultSnapshot, {
      hasReplayStatus: false,
      hasProgressionSnapshot: true,
      hasWalletSnapshot: true,
    });
    assert.equal(Number((await client.query(
      "SELECT count(*)::int AS count FROM replay_metadata WHERE mission_attempt_id = $1",
      [ids.attempt],
    )).rows[0].count), 1);

    const item = (await client.query(
      "SELECT state::text, durability FROM inventory_items WHERE id = $1",
      [ids.item],
    )).rows[0];
    assert.deepEqual(item, { state: "DAMAGED", durability: 6600 });
    const transitions = await client.query(
      `SELECT from_state::text AS "fromState", to_state::text AS "toState", metadata
         FROM inventory_transitions
        WHERE inventory_item_id = $1 AND source_type = 'MISSION_RESULT'`,
      [ids.item],
    );
    assert.equal(transitions.rowCount, 1);
    assert.deepEqual(transitions.rows[0].metadata.durability, {
      before: 7100,
      loss: 500,
      after: 6600,
      damagedBelow: 7000,
      destroyedAt: 0,
    });
    assert.deepEqual(transitions.rows[0].metadata.authoritativeModule, {
      moduleId: ids.item,
      inventoryItemId: ids.item,
      hpBefore: 300,
      hpAfter: 240,
      hpLoss: 60,
      detached: false,
    });
    await client.query("SET LOCAL ROLE spacey_runtime");
    await client.query("SELECT set_config('spacey.user_id', $1, true)", [ids.user]);
    await client.query("SELECT spacey_assert_owned_build_launchable($1::uuid)", [ids.revision]);
    await client.query("RESET ROLE");

    await client.query("SAVEPOINT destroyed_launch_guard");
    await client.query(
      "UPDATE inventory_items SET state = 'DESTROYED', durability = 0, updated_at = NOW() WHERE id = $1",
      [ids.item],
    );
    await client.query("SET LOCAL ROLE spacey_runtime");
    await client.query("SELECT set_config('spacey.user_id', $1, true)", [ids.user]);
    await expectSqlState(
      client,
      "SELECT spacey_assert_owned_build_launchable($1::uuid)",
      [ids.revision],
      "23514",
    );
    await client.query("ROLLBACK TO SAVEPOINT destroyed_launch_guard");
    await client.query("RELEASE SAVEPOINT destroyed_launch_guard");
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

function savepointClient(client) {
  return {
    async query(text, params) {
      if (text === "BEGIN") return client.query("SAVEPOINT pve_finalize");
      if (text === "COMMIT") return client.query("RELEASE SAVEPOINT pve_finalize");
      if (text === "ROLLBACK") {
        await client.query("ROLLBACK TO SAVEPOINT pve_finalize");
        return client.query("RELEASE SAVEPOINT pve_finalize");
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
