import pg, { type Pool as PgPool, type PoolClient } from "pg";
import { createUuidV7 as createWorkerUuidV7 } from "@spacey/db/uuidv7";

import type {
  BattleFinalizer,
  BattleAttemptLifecycle,
  FinalizeBattleRequest,
  FinalizeBattleResult,
  FinalizeDuelRequest,
  FinalizeDuelResult
} from "./ports.js";
import {
  parseMissionRewards,
  resolveItemRewards,
  type ParsedMissionRewards
} from "./reward-definition.js";
import { applyPersistentDamage } from "./persistent-damage.js";

type AttemptRow = {
  id: string;
  userId: string;
  status: string;
  type: string;
  seed: string;
  simulationVersion: string;
  missionDefinitionId: string;
  missionKey: string;
  rewardDefinition: unknown;
  dropTableEntries: unknown;
  contentVersion: string;
  contentReleaseId: string;
  buildRevisionId: string;
  pvpMatchId: string | null;
};

type IdRow = { id: string };
type AttemptLifecycleRow = { pvpMatchId: string | null };
type WalletRow = { id: string; balance: string };
type DuelMatchRow = {
  id: string;
  status: string;
  seed: string;
  simulationVersion: string;
  contentVersion: string;
  battleSessionId: string;
};
type DuelParticipantRow = {
  participantId: string;
  userId: string;
  side: number;
  mmrBefore: number;
  buildRevisionId: string;
  attemptId: string;
  attemptStatus: string;
  ticketId: string;
  seasonId: string;
  seasonParticipantId: string;
  currentRating: number;
  seasonRules: unknown;
};

export class PostgresBattleFinalizer implements BattleFinalizer, BattleAttemptLifecycle {
  private readonly pool: PgPool;

  constructor(databaseUrl: string, maxConnections: number) {
    this.pool = new pg.Pool({
      connectionString: databaseUrl,
      application_name: "spacey-battle-worker",
      max: maxConnections,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      query_timeout: 10_000
    });
  }

  async finalizeOnce(request: FinalizeBattleRequest): Promise<FinalizeBattleResult> {
    validateFinalizationRequest(request);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '2s'");
      await client.query("SET LOCAL statement_timeout = '10s'");
      await client.query("SELECT set_config('spacey.user_id', $1, true)", [request.userId]);

      const existing = await client.query<IdRow>(
        `SELECT id
           FROM mission_results
          WHERE mission_attempt_id = $1 OR idempotency_key = $2
          LIMIT 1`,
        [request.attemptId, request.idempotencyKey]
      );
      if (existing.rows[0]) {
        await client.query("COMMIT");
        return { resultId: existing.rows[0].id };
      }

      const attemptResult = await client.query<AttemptRow>(
        `SELECT a.id,
                a.user_id AS "userId",
                a.status::text,
                a.type::text,
                a.seed::text,
                a.simulation_version AS "simulationVersion",
                a.mission_definition_id AS "missionDefinitionId",
                m.key AS "missionKey",
                m.reward_definition AS "rewardDefinition",
                dt.entries AS "dropTableEntries",
                cr.version AS "contentVersion",
                a.content_release_id AS "contentReleaseId",
                a.build_revision_id AS "buildRevisionId",
                a.pvp_match_id AS "pvpMatchId"
           FROM mission_attempts a
           JOIN mission_definitions m ON m.id = a.mission_definition_id
           JOIN content_releases cr ON cr.id = a.content_release_id
           LEFT JOIN drop_tables dt ON dt.id = m.drop_table_id AND dt.enabled = true
          WHERE a.id = $1
          FOR UPDATE OF a`,
        [request.attemptId]
      );
      const attempt = attemptResult.rows[0];
      if (!attempt) throw new Error("Mission attempt does not exist or is not owned by the player.");
      assertAttemptMatches(request, attempt);

      const resultId = createWorkerUuidV7();
      const databaseOutcome = toDatabaseOutcome(request.outcome.outcome);
      const parsedRewards = request.outcome.outcome === "victory"
        ? parseMissionRewards(attempt.rewardDefinition, attempt.dropTableEntries)
        : { currencies: [], experience: 0, items: [] } satisfies ParsedMissionRewards;
      const itemGrants = resolveItemRewards(request.attemptId, parsedRewards.items).map((item) => ({
        inventoryItemId: createWorkerUuidV7(),
        definitionKey: item.definitionKey,
        rarity: item.rarity,
        rewardIndex: item.rewardIndex
      }));
      const rewards = {
        currencies: parsedRewards.currencies,
        experience: parsedRewards.experience,
        items: itemGrants.map(({ inventoryItemId, definitionKey, rarity }) => ({
          inventoryItemId,
          definitionKey,
          rarity
        }))
      };
      const metrics = {
        reason: request.outcome.reason,
        durationTicks: request.outcome.finalTick,
        enemiesDestroyed: request.finalCheckpoint.state.enemiesDestroyed
      };
      const damage = {
        hullDamage: Math.max(
          0,
          request.simulationConfig.player.hull - request.finalCheckpoint.state.player.hull
        ),
        remainingHull: request.finalCheckpoint.state.player.hull
      };

      await client.query(
        `INSERT INTO mission_results
          (id, mission_attempt_id, outcome, final_tick, state_hash, metrics, rewards, damage,
           idempotency_key, finished_at)
         VALUES ($1, $2, $3::mission_outcome, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, now())`,
        [
          resultId,
          request.attemptId,
          databaseOutcome,
          request.outcome.finalTick,
          request.outcome.finalStateHash,
          JSON.stringify(metrics),
          JSON.stringify(rewards),
          JSON.stringify(damage),
          request.idempotencyKey
        ]
      );

      await applyPersistentDamage(client, {
        mode: "pve",
        userId: request.userId,
        buildRevisionId: attempt.buildRevisionId,
        sourceType: "MISSION_RESULT",
        sourceId: resultId,
        idempotencyPrefix: request.idempotencyKey,
        maximumHull: request.simulationConfig.player.hull,
        remainingHull: request.finalCheckpoint.state.player.hull,
      });

      for (const reward of parsedRewards.currencies) {
        await grantCurrency(client, request, resultId, reward.currency, reward.amount);
      }
      if (parsedRewards.experience > 0) {
        await grantExperience(client, request.userId, parsedRewards.experience);
      }
      await grantInventoryItems(
        client,
        request,
        resultId,
        attempt.contentReleaseId,
        itemGrants
      );

      await client.query(
        `INSERT INTO replay_metadata
          (id, mission_attempt_id, pvp_match_id, storage_key, checksum, compression,
           size_bytes, tick_count, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::bigint, $8, $9::timestamptz)`,
        [
          createWorkerUuidV7(),
          request.attemptId,
          null,
          request.replay.storageKey,
          request.replay.checksumSha256,
          request.replay.compression,
          String(request.replay.sizeBytes),
          request.replay.tickCount,
          request.replay.expiresAt
        ]
      );

      const result = await client.query(
        `UPDATE mission_attempts
            SET status = 'COMPLETED'::mission_attempt_status,
                ended_at = now(),
                disconnected_at = NULL,
                reconnect_deadline = NULL,
                ws_ticket_hash = NULL,
                ws_ticket_expires_at = NULL,
                updated_at = now()
          WHERE id = $1
            AND status IN ('CREATED', 'CONNECTING', 'ACTIVE', 'PAUSED')`,
        [request.attemptId]
      );
      if (result.rowCount !== 1) throw new Error("Mission attempt finalization update failed.");

      await client.query(
        `UPDATE battle_sessions
            SET status = 'ENDED'::battle_session_status,
                last_tick = $2,
                state_hash = $3,
                ended_at = now(),
                updated_at = now()
          WHERE mission_attempt_id = $1`,
        [request.attemptId, request.outcome.finalTick, request.outcome.finalStateHash]
      );

      if (attempt.pvpMatchId) {
        await client.query(
          `UPDATE pvp_match_participants
              SET outcome = $1::mission_outcome
            WHERE pvp_match_id = $2 AND user_id = $3`,
          [databaseOutcome, attempt.pvpMatchId, request.userId]
        );
        await client.query(
          `UPDATE pvp_matches m
              SET status = 'COMPLETED'::pvp_match_status, ended_at = now(), updated_at = now()
            WHERE m.id = $1
              AND NOT EXISTS (
                SELECT 1 FROM pvp_match_participants p
                 WHERE p.pvp_match_id = m.id AND p.outcome IS NULL
              )`,
          [attempt.pvpMatchId]
        );
      }

      await client.query(
        `INSERT INTO outbox_events
          (id, aggregate_type, aggregate_id, event_type, payload, idempotency_key, updated_at)
         VALUES ($1, 'mission_attempt', $2, 'battle.result.finalized', $3::jsonb, $4, now())`,
        [
          createWorkerUuidV7(),
          request.attemptId,
          JSON.stringify({
            resultId,
            attemptId: request.attemptId,
            userId: request.userId,
            outcome: request.outcome.outcome,
            stateHash: request.outcome.finalStateHash
          }),
          `${request.idempotencyKey}:outbox`
        ]
      );

      await client.query("COMMIT");
      return { resultId };
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async finalizeDuelOnce(request: FinalizeDuelRequest): Promise<FinalizeDuelResult> {
    validateDuelFinalizationRequest(request);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '2s'");
      await client.query("SET LOCAL statement_timeout = '10s'");

      const matchResult = await client.query<DuelMatchRow>(
        `SELECT pvp.id,
                pvp.status::text,
                pvp.seed::text,
                pvp.simulation_version AS "simulationVersion",
                release.version AS "contentVersion",
                session.id AS "battleSessionId"
           FROM pvp_matches pvp
           JOIN content_releases release ON release.id = pvp.content_release_id
           JOIN battle_sessions session ON session.pvp_match_id = pvp.id
          WHERE pvp.id = $1 AND session.id = $2
          FOR UPDATE OF pvp, session`,
        [request.matchId, request.sessionId]
      );
      const match = matchResult.rows[0];
      if (!match) throw new Error("PvP match or battle session does not exist.");
      assertDuelMatchIdentity(request, match);

      const existing = await client.query<{ id: string; userId: string }>(
        `SELECT result.id, attempt.user_id AS "userId"
           FROM mission_results result
           JOIN mission_attempts attempt ON attempt.id = result.mission_attempt_id
          WHERE attempt.pvp_match_id = $1`,
        [request.matchId]
      );
      if (existing.rows.length > 0) {
        if (existing.rows.length !== 2 || match.status !== "COMPLETED") {
          throw new Error("PvP match has a partial finalization state.");
        }
        await client.query("COMMIT");
        return { resultIds: Object.fromEntries(existing.rows.map((row) => [row.userId, row.id])) };
      }

      const participantsResult = await client.query<DuelParticipantRow>(
        `SELECT participant.id AS "participantId",
                participant.user_id AS "userId",
                participant.side,
                participant.mmr_before AS "mmrBefore",
                participant.build_revision_id AS "buildRevisionId",
                attempt.id AS "attemptId",
                attempt.status::text AS "attemptStatus",
                ticket.id AS "ticketId",
                ticket.season_id AS "seasonId",
                season_participant.id AS "seasonParticipantId",
                season_participant.rating AS "currentRating",
                season.rules AS "seasonRules"
           FROM pvp_match_participants participant
           JOIN mission_attempts attempt
             ON attempt.pvp_match_id = participant.pvp_match_id
            AND attempt.user_id = participant.user_id
           JOIN matchmaking_tickets ticket
             ON ticket.pvp_match_id = participant.pvp_match_id
            AND ticket.user_id = participant.user_id
           JOIN seasons season ON season.id = ticket.season_id
           JOIN season_participants season_participant
             ON season_participant.season_id = season.id
            AND season_participant.user_id = participant.user_id
          WHERE participant.pvp_match_id = $1
          ORDER BY participant.side
          FOR UPDATE OF participant, attempt, ticket, season_participant`,
        [request.matchId]
      );
      const participants = participantsResult.rows;
      assertDuelMatches(request, match, participants);

      const kFactor = mmrKFactor(participants[0]?.seasonRules);
      const [alpha, beta] = participants as [DuelParticipantRow, DuelParticipantRow];
      const alphaWon = request.outcome.winnerUserId === alpha.userId;
      const expectedAlpha = 1 / (1 + 10 ** ((beta.currentRating - alpha.currentRating) / 400));
      const alphaDelta = Math.round(kFactor * ((alphaWon ? 1 : 0) - expectedAlpha));
      const ratings = new Map<string, number>([
        [alpha.userId, Math.max(0, alpha.currentRating + alphaDelta)],
        [beta.userId, Math.max(0, beta.currentRating - alphaDelta)],
      ]);
      const resultIds: Record<string, string> = {};

      for (const participant of participants) {
        const participantOutcome = request.outcome.results.find((result) => result.userId === participant.userId);
        const config = request.simulationConfig.participants.find((candidate) => candidate.userId === participant.userId);
        const ship = request.finalCheckpoint.state.ships.find((candidate) => candidate.userId === participant.userId);
        if (!participantOutcome || !config || !ship) throw new Error("Duel finalization participant data is incomplete.");
        const resultId = createWorkerUuidV7();
        resultIds[participant.userId] = resultId;
        const databaseOutcome = toDatabaseOutcome(participantOutcome.outcome);
        await client.query(
          `INSERT INTO mission_results
            (id, mission_attempt_id, outcome, final_tick, state_hash, metrics, rewards, damage,
             idempotency_key, finished_at)
           VALUES ($1, $2, $3::mission_outcome, $4, $5, $6::jsonb, '{}'::jsonb, $7::jsonb, $8, now())`,
          [
            resultId,
            participant.attemptId,
            databaseOutcome,
            request.outcome.finalTick,
            request.outcome.finalStateHash,
            JSON.stringify({
              mode: "pvp",
              matchId: request.matchId,
              reason: participantOutcome.reason,
              opponentUserId: participants.find((candidate) => candidate.userId !== participant.userId)?.userId,
            }),
            JSON.stringify({
              hullDamage: Math.max(0, config.buildStats.hull - ship.hull),
              remainingHull: ship.hull,
            }),
            `${request.idempotencyKey}:user:${participant.userId}`,
          ]
        );
        await applyPersistentDamage(client, {
          mode: "pvp",
          userId: participant.userId,
          buildRevisionId: participant.buildRevisionId,
          sourceType: "PVP_MATCH",
          sourceId: request.matchId,
          idempotencyPrefix: `${request.idempotencyKey}:user:${participant.userId}`,
          maximumHull: config.buildStats.hull,
          remainingHull: ship.hull,
        });
        await client.query(
          `UPDATE mission_attempts
              SET status = 'COMPLETED'::mission_attempt_status,
                  ended_at = now(), disconnected_at = NULL, reconnect_deadline = NULL,
                  ws_ticket_hash = NULL, ws_ticket_expires_at = NULL,
                  updated_at = now()
            WHERE id = $1 AND status IN ('CREATED', 'CONNECTING', 'ACTIVE', 'PAUSED')`,
          [participant.attemptId]
        );
        await client.query(
          `UPDATE pvp_match_participants
              SET outcome = $2::mission_outcome,
                  mmr_after = $3,
                  ws_ticket_hash = NULL,
                  ws_ticket_expires_at = NULL,
                  disconnected_at = NULL
            WHERE id = $1`,
          [participant.participantId, databaseOutcome, ratings.get(participant.userId)]
        );
        const won = participantOutcome.outcome === "victory";
        await client.query(
          `UPDATE season_participants
              SET rating = $2,
                  wins = wins + $3,
                  losses = losses + $4,
                  updated_at = now()
            WHERE id = $1`,
          [participant.seasonParticipantId, ratings.get(participant.userId), won ? 1 : 0, won ? 0 : 1]
        );
      }

      await client.query(
        `INSERT INTO replay_metadata
          (id, mission_attempt_id, pvp_match_id, storage_key, checksum, compression,
           size_bytes, tick_count, expires_at)
         VALUES ($1, NULL, $2, $3, $4, $5, $6::bigint, $7, $8::timestamptz)`,
        [
          createWorkerUuidV7(), request.matchId, request.replay.storageKey,
          request.replay.checksumSha256, request.replay.compression,
          String(request.replay.sizeBytes), request.replay.tickCount, request.replay.expiresAt,
        ]
      );
      await client.query(
        `UPDATE pvp_matches
            SET status = 'COMPLETED'::pvp_match_status, ended_at = now(), updated_at = now()
          WHERE id = $1 AND status IN ('MATCHED', 'CONNECTING', 'ACTIVE')`,
        [request.matchId]
      );
      await client.query(
        `UPDATE battle_sessions
            SET status = 'ENDED'::battle_session_status,
                last_tick = $2,
                last_input_sequence = $3,
                state_hash = $4,
                ended_at = now(),
                updated_at = now()
          WHERE id = $1`,
        [
          request.sessionId,
          request.outcome.finalTick,
          Math.max(...request.finalCheckpoint.inputStreams.map((stream) => stream.lastProcessedInputSequence)),
          request.outcome.finalStateHash,
        ]
      );
      await client.query(
        `UPDATE matchmaking_tickets
            SET status = 'COMPLETED'::matchmaking_ticket_status, updated_at = now()
          WHERE pvp_match_id = $1 AND status = 'MATCHED'`,
        [request.matchId]
      );
      await client.query(
        `INSERT INTO outbox_events
          (id, aggregate_type, aggregate_id, event_type, payload, idempotency_key, updated_at)
         VALUES ($1, 'pvp_match', $2, 'pvp.match.finalized', $3::jsonb, $4, now())`,
        [
          createWorkerUuidV7(),
          request.matchId,
          JSON.stringify({ matchId: request.matchId, resultIds, winnerUserId: request.outcome.winnerUserId }),
          `${request.idempotencyKey}:outbox`,
        ]
      );
      await client.query("COMMIT");
      return { resultIds };
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async markConnected(input: {
    attemptId: string;
    userId: string;
    connectedAtMs: number;
  }): Promise<void> {
    await this.updateAttemptLifecycle(input.userId, async (client) => {
      const result = await client.query<AttemptLifecycleRow>(
        `UPDATE mission_attempts
            SET status = 'ACTIVE'::mission_attempt_status,
                started_at = COALESCE(started_at, $2::timestamptz),
                disconnected_at = NULL,
                reconnect_deadline = NULL,
                ws_ticket_hash = NULL,
                ws_ticket_expires_at = NULL,
                updated_at = now()
          WHERE id = $1
            AND status IN ('CREATED', 'CONNECTING', 'ACTIVE', 'PAUSED')
          RETURNING pvp_match_id AS "pvpMatchId"`,
        [input.attemptId, new Date(input.connectedAtMs).toISOString()]
      );
      if (result.rowCount !== 1) throw new Error("Mission attempt was not available for connection.");
      const pvpMatchId = result.rows[0]?.pvpMatchId;
      if (!pvpMatchId) return;
      await client.query(
        `UPDATE pvp_match_participants
            SET disconnected_at = NULL,
                ws_ticket_hash = NULL,
                ws_ticket_expires_at = NULL
          WHERE pvp_match_id = $1 AND user_id = $2`,
        [pvpMatchId, input.userId]
      );
      const activation = await client.query<{ ready: boolean }>(
        `SELECT NOT EXISTS (
           SELECT 1
             FROM mission_attempts
            WHERE pvp_match_id = $1
              AND status <> 'ACTIVE'::mission_attempt_status
         ) AS ready`,
        [pvpMatchId]
      );
      const ready = activation.rows[0]?.ready === true;
      await client.query(
        `UPDATE pvp_matches
            SET status = $2::pvp_match_status,
                started_at = CASE WHEN $3::boolean THEN COALESCE(started_at, $4::timestamptz) ELSE started_at END,
                updated_at = now()
          WHERE id = $1 AND status IN ('MATCHED', 'CONNECTING', 'ACTIVE')`,
        [pvpMatchId, ready ? "ACTIVE" : "CONNECTING", ready, new Date(input.connectedAtMs).toISOString()]
      );
      if (ready) {
        await client.query(
          `UPDATE battle_sessions
              SET status = 'ACTIVE'::battle_session_status,
                  started_at = COALESCE(started_at, $2::timestamptz),
                  updated_at = now()
            WHERE pvp_match_id = $1 AND status IN ('CREATED', 'RECOVERING', 'ACTIVE')`,
          [pvpMatchId, new Date(input.connectedAtMs).toISOString()]
        );
      }
    });
  }

  async markDisconnected(input: {
    attemptId: string;
    userId: string;
    mode: "pve" | "pvp";
    disconnectedAtMs: number;
    reconnectDeadlineAtMs: number;
  }): Promise<void> {
    await this.updateAttemptLifecycle(input.userId, async (client) => {
      const result = await client.query<AttemptLifecycleRow>(
        `UPDATE mission_attempts
            SET status = $2::mission_attempt_status,
                disconnected_at = $3::timestamptz,
                reconnect_deadline = $4::timestamptz,
                updated_at = now()
          WHERE id = $1
            AND status IN ('CONNECTING', 'ACTIVE', 'PAUSED')
          RETURNING pvp_match_id AS "pvpMatchId"`,
        [
          input.attemptId,
          input.mode === "pve" ? "PAUSED" : "ACTIVE",
          new Date(input.disconnectedAtMs).toISOString(),
          new Date(input.reconnectDeadlineAtMs).toISOString()
        ]
      );
      if (result.rowCount !== 1) throw new Error("Mission attempt was not available for disconnect update.");
      const pvpMatchId = result.rows[0]?.pvpMatchId;
      if (pvpMatchId) {
        await client.query(
          `UPDATE pvp_match_participants
              SET disconnected_at = $3::timestamptz
            WHERE pvp_match_id = $1 AND user_id = $2`,
          [pvpMatchId, input.userId, new Date(input.disconnectedAtMs).toISOString()]
        );
      }
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async updateAttemptLifecycle(
    userId: string,
    update: (client: PoolClient) => Promise<void>
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('spacey.user_id', $1, true)", [userId]);
      await update(client);
      await client.query("COMMIT");
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }
}

async function grantCurrency(
  client: PoolClient,
  request: FinalizeBattleRequest,
  resultId: string,
  currency: string,
  amount: number
): Promise<void> {
  const balance = await client.query<WalletRow>(
    `INSERT INTO wallet_balances (id, user_id, currency, balance, version, updated_at)
     VALUES ($1, $2, $3::wallet_currency, $4::bigint, 1, now())
     ON CONFLICT (user_id, currency) DO UPDATE
       SET balance = wallet_balances.balance + EXCLUDED.balance,
           version = wallet_balances.version + 1,
           updated_at = now()
     RETURNING id, balance::text`,
    [createWorkerUuidV7(), request.userId, currency, String(amount)]
  );
  const row = balance.rows[0];
  if (!row) throw new Error("Wallet balance update returned no row.");
  await client.query(
    `INSERT INTO wallet_ledger_entries
      (id, user_id, wallet_balance_id, currency, delta, balance_after, source_type,
       source_id, idempotency_key, metadata)
     VALUES ($1, $2, $3, $4::wallet_currency, $5::bigint, $6::bigint,
             'MISSION_RESULT', $7, $8, $9::jsonb)`,
    [
      createWorkerUuidV7(),
      request.userId,
      row.id,
      currency,
      String(amount),
      row.balance,
      resultId,
      `${request.idempotencyKey}:currency:${currency}`,
      JSON.stringify({ attemptId: request.attemptId })
    ]
  );
}

async function grantExperience(client: PoolClient, userId: string, experience: number): Promise<void> {
  await client.query(
    `INSERT INTO player_progression (id, user_id, experience, version, updated_at)
     VALUES ($1, $2, $3::bigint, 1, now())
     ON CONFLICT (user_id) DO UPDATE
       SET experience = player_progression.experience + EXCLUDED.experience,
           version = player_progression.version + 1,
           updated_at = now()`,
    [createWorkerUuidV7(), userId, String(experience)]
  );
}

async function grantInventoryItems(
  client: PoolClient,
  request: FinalizeBattleRequest,
  resultId: string,
  contentReleaseId: string,
  items: Array<{
    inventoryItemId: string;
    definitionKey: string;
    rarity: string | null;
    rewardIndex: number;
  }>
): Promise<void> {
  for (const item of items) {
    await client.query(
      `INSERT INTO inventory_items
        (id, user_id, content_release_id, definition_key, state, durability, metadata, updated_at)
       VALUES ($1, $2, $3, $4, 'AVAILABLE'::inventory_item_state, 10000, $5::jsonb, now())`,
      [
        item.inventoryItemId,
        request.userId,
        contentReleaseId,
        item.definitionKey,
        JSON.stringify({ rarity: item.rarity })
      ]
    );
    await client.query(
      `INSERT INTO inventory_transitions
        (id, user_id, inventory_item_id, from_state, to_state, source_type, source_id,
         idempotency_key, metadata)
       VALUES ($1, $2, $3, NULL, 'AVAILABLE'::inventory_item_state,
               'MISSION_RESULT', $4, $5, $6::jsonb)`,
      [
        createWorkerUuidV7(),
        request.userId,
        item.inventoryItemId,
        resultId,
        `${request.idempotencyKey}:item:${item.rewardIndex}`,
        JSON.stringify({
          attemptId: request.attemptId,
          definitionKey: item.definitionKey,
          rarity: item.rarity
        })
      ]
    );
  }
}

function validateFinalizationRequest(request: FinalizeBattleRequest): void {
  if (request.outcome.finalStateHash !== request.finalCheckpoint.stateHash) {
    throw new Error("Final outcome hash does not match the simulation checkpoint.");
  }
  if (request.outcome.finalTick !== request.finalCheckpoint.state.tick) {
    throw new Error("Final outcome tick does not match the simulation checkpoint.");
  }
  if (request.replay.tickCount !== request.outcome.finalTick) {
    throw new Error("Replay metadata does not match the final simulation tick.");
  }
}

function assertAttemptMatches(request: FinalizeBattleRequest, attempt: AttemptRow): void {
  const config = request.simulationConfig;
  const missionMatches = attempt.missionDefinitionId === config.missionId || attempt.missionKey === config.missionId;
  if (attempt.userId !== request.userId
    || attempt.type !== request.mode.toUpperCase()
    || attempt.simulationVersion !== config.simulationVersion
    || attempt.contentVersion !== config.contentVersion
    || attempt.buildRevisionId !== config.shipBuildRevisionId
    || BigInt(attempt.seed) !== BigInt(config.seed)
    || !missionMatches) {
    throw new Error("Authoritative mission attempt does not match the simulation configuration.");
  }
  if (request.mode === "pvp" && !attempt.pvpMatchId) {
    throw new Error("PvP mission attempt is not attached to a match.");
  }
  if (!["CREATED", "CONNECTING", "ACTIVE", "PAUSED"].includes(attempt.status)) {
    throw new Error(`Mission attempt cannot be finalized from status ${attempt.status}.`);
  }
}

function validateDuelFinalizationRequest(request: FinalizeDuelRequest): void {
  if (request.matchId !== request.simulationConfig.matchId
    || request.sessionId !== request.simulationConfig.sessionId
    || request.finalCheckpoint.config.matchId !== request.matchId
    || request.finalCheckpoint.config.sessionId !== request.sessionId) {
    throw new Error("Duel finalization identity mismatch.");
  }
  if (request.outcome.finalStateHash !== request.finalCheckpoint.stateHash
    || request.outcome.finalTick !== request.finalCheckpoint.state.tick
    || request.replay.tickCount !== request.outcome.finalTick) {
    throw new Error("Duel finalization checkpoint or replay mismatch.");
  }
  const requestUsers = new Set(request.participants.map((participant) => participant.userId));
  const configUsers = new Set(request.simulationConfig.participants.map((participant) => participant.userId));
  const resultUsers = new Set(request.outcome.results.map((result) => result.userId));
  if (requestUsers.size !== 2 || configUsers.size !== 2 || resultUsers.size !== 2
    || [...requestUsers].some((userId) => !configUsers.has(userId) || !resultUsers.has(userId))) {
    throw new Error("Duel finalization participants mismatch.");
  }
  const winner = request.outcome.results.find((result) => result.userId === request.outcome.winnerUserId);
  const loser = request.outcome.results.find((result) => result.userId === request.outcome.loserUserId);
  if (winner?.outcome !== "victory"
    || !loser
    || (request.outcome.reason === "disconnect_forfeit" ? loser.outcome !== "forfeit" : loser.outcome !== "defeat")) {
    throw new Error("Duel outcome matrix is invalid.");
  }
}

function assertDuelMatches(
  request: FinalizeDuelRequest,
  match: DuelMatchRow,
  rows: DuelParticipantRow[],
): asserts rows is [DuelParticipantRow, DuelParticipantRow] {
  assertDuelMatchIdentity(request, match);
  if (rows.length !== 2 || rows[0]?.side !== 0 || rows[1]?.side !== 1
    || rows[0].seasonId !== rows[1].seasonId) {
    throw new Error("PvP match participant rows are invalid.");
  }
  for (const row of rows) {
    const requested = request.participants.find((participant) => participant.userId === row.userId);
    const configured = request.simulationConfig.participants.find((participant) => participant.userId === row.userId);
    if (!requested || !configured
      || requested.attemptId !== row.attemptId
      || requested.participantId !== row.participantId
      || requested.side !== row.side
      || configured.participantId !== row.participantId
      || configured.shipBuildRevisionId !== row.buildRevisionId
      || configured.side !== (row.side === 0 ? "alpha" : "beta")
      || row.mmrBefore !== row.currentRating
      || !["CREATED", "CONNECTING", "ACTIVE", "PAUSED"].includes(row.attemptStatus)) {
      throw new Error("Authoritative PvP participant does not match duel configuration.");
    }
  }
}

function assertDuelMatchIdentity(request: FinalizeDuelRequest, match: DuelMatchRow): void {
  if (match.id !== request.matchId
    || match.battleSessionId !== request.sessionId
    || match.simulationVersion !== request.simulationConfig.simulationVersion
    || match.contentVersion !== request.simulationConfig.contentVersion
    || BigInt(match.seed) !== BigInt(request.simulationConfig.seed)
    || !["MATCHED", "CONNECTING", "ACTIVE", "COMPLETED"].includes(match.status)) {
    throw new Error("Authoritative PvP match does not match duel configuration.");
  }
}

function mmrKFactor(rulesValue: unknown): number {
  if (!rulesValue || typeof rulesValue !== "object" || Array.isArray(rulesValue)) return 32;
  const queues = (rulesValue as Record<string, unknown>).matchmakingQueues;
  if (!queues || typeof queues !== "object" || Array.isArray(queues)) return 32;
  for (const value of Object.values(queues as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const factor = (value as Record<string, unknown>).mmrKFactor;
    if (Number.isSafeInteger(factor) && Number(factor) >= 8 && Number(factor) <= 128) return Number(factor);
  }
  return 32;
}

function toDatabaseOutcome(outcome: "victory" | "defeat" | "forfeit"): string {
  if (outcome === "victory") return "VICTORY";
  if (outcome === "forfeit") return "FORFEIT";
  return "DEFEAT";
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // The original transaction error remains authoritative.
  }
}
