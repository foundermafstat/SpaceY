CREATE TYPE "matchmaking_ticket_status" AS ENUM (
    'QUEUED', 'MATCHED', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED'
);

CREATE TABLE "matchmaking_tickets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "build_revision_id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "content_release_id" UUID NOT NULL,
    "mission_definition_id" UUID NOT NULL,
    "pvp_match_id" UUID,
    "queue" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "status" "matchmaking_ticket_status" NOT NULL DEFAULT 'QUEUED',
    "mmr" INTEGER NOT NULL,
    "base_mmr_window" INTEGER NOT NULL,
    "expansion_per_second" INTEGER NOT NULL,
    "max_mmr_window" INTEGER NOT NULL,
    "request_hash" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "matched_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "matchmaking_tickets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "matchmaking_tickets_queue_check" CHECK (
        "queue" ~ '^[a-z0-9][a-z0-9_-]{0,63}$'
        AND "region" ~ '^[a-z0-9][a-z0-9_-]{0,31}$'
    ),
    CONSTRAINT "matchmaking_tickets_mmr_check" CHECK (
        "mmr" BETWEEN 0 AND 100000
        AND "base_mmr_window" BETWEEN 0 AND 5000
        AND "expansion_per_second" BETWEEN 0 AND 100
        AND "max_mmr_window" BETWEEN "base_mmr_window" AND 10000
    ),
    CONSTRAINT "matchmaking_tickets_hash_check" CHECK (
        char_length("request_hash") = 64 AND char_length("idempotency_key") = 64
    ),
    CONSTRAINT "matchmaking_tickets_time_check" CHECK (
        "expires_at" > "created_at"
        AND ("matched_at" IS NULL OR "matched_at" >= "created_at")
        AND ("cancelled_at" IS NULL OR "cancelled_at" >= "created_at")
    ),
    CONSTRAINT "matchmaking_tickets_state_check" CHECK (
        ("status" = 'QUEUED' AND "pvp_match_id" IS NULL AND "matched_at" IS NULL AND "cancelled_at" IS NULL)
        OR ("status" IN ('MATCHED', 'COMPLETED') AND "pvp_match_id" IS NOT NULL AND "matched_at" IS NOT NULL AND "cancelled_at" IS NULL)
        OR ("status" = 'CANCELLED' AND "pvp_match_id" IS NULL AND "matched_at" IS NULL AND "cancelled_at" IS NOT NULL)
        OR ("status" IN ('EXPIRED', 'FAILED') AND "pvp_match_id" IS NULL AND "matched_at" IS NULL)
    )
);

CREATE UNIQUE INDEX "matchmaking_tickets_idempotency_key_key"
    ON "matchmaking_tickets"("idempotency_key");
CREATE INDEX "matchmaking_tickets_user_id_idx" ON "matchmaking_tickets"("user_id");
CREATE INDEX "matchmaking_tickets_build_revision_id_idx" ON "matchmaking_tickets"("build_revision_id");
CREATE INDEX "matchmaking_tickets_season_id_idx" ON "matchmaking_tickets"("season_id");
CREATE INDEX "matchmaking_tickets_content_release_id_idx" ON "matchmaking_tickets"("content_release_id");
CREATE INDEX "matchmaking_tickets_mission_definition_id_idx" ON "matchmaking_tickets"("mission_definition_id");
CREATE INDEX "matchmaking_tickets_pvp_match_id_idx" ON "matchmaking_tickets"("pvp_match_id");
CREATE INDEX "matchmaking_tickets_queue_region_status_mmr_created_at_idx"
    ON "matchmaking_tickets"("queue", "region", "status", "mmr", "created_at");
CREATE INDEX "matchmaking_tickets_user_id_status_created_at_id_idx"
    ON "matchmaking_tickets"("user_id", "status", "created_at", "id");
CREATE INDEX "matchmaking_tickets_status_expires_at_idx"
    ON "matchmaking_tickets"("status", "expires_at");
CREATE INDEX "matchmaking_tickets_created_at_id_idx"
    ON "matchmaking_tickets"("created_at", "id");
CREATE UNIQUE INDEX "matchmaking_tickets_one_active_user_idx"
    ON "matchmaking_tickets"("user_id") WHERE "status" IN ('QUEUED', 'MATCHED');

ALTER TABLE "matchmaking_tickets"
    ADD CONSTRAINT "matchmaking_tickets_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "matchmaking_tickets_build_revision_id_fkey"
        FOREIGN KEY ("build_revision_id") REFERENCES "ship_build_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "matchmaking_tickets_season_id_fkey"
        FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "matchmaking_tickets_content_release_id_fkey"
        FOREIGN KEY ("content_release_id") REFERENCES "content_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "matchmaking_tickets_mission_definition_id_fkey"
        FOREIGN KEY ("mission_definition_id") REFERENCES "mission_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "matchmaking_tickets_pvp_match_id_fkey"
        FOREIGN KEY ("pvp_match_id") REFERENCES "pvp_matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "matchmaking_tickets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "matchmaking_tickets" NO FORCE ROW LEVEL SECURITY;
CREATE POLICY "matchmaking_tickets_owner" ON "matchmaking_tickets" FOR ALL TO spacey_runtime
    USING ("user_id" = (SELECT "spacey_current_user_id"()))
    WITH CHECK ("user_id" = (SELECT "spacey_current_user_id"()));
CREATE POLICY "matchmaking_tickets_battle_worker" ON "matchmaking_tickets" FOR ALL TO spacey_battle_worker
    USING (true) WITH CHECK (true);

ALTER TABLE "pvp_matches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pvp_matches" NO FORCE ROW LEVEL SECURITY;
CREATE POLICY "pvp_matches_owner" ON "pvp_matches" FOR SELECT TO spacey_runtime
    USING (EXISTS (
        SELECT 1
        FROM "pvp_match_participants" participant
        WHERE participant."pvp_match_id" = "pvp_matches"."id"
          AND participant."user_id" = (SELECT "spacey_current_user_id"())
    ));
CREATE POLICY "pvp_matches_battle_worker" ON "pvp_matches" FOR ALL TO spacey_battle_worker
    USING (true) WITH CHECK (true);

CREATE FUNCTION "spacey_materialize_pvp_match"(
    requested_left_ticket_id uuid,
    requested_right_ticket_id uuid,
    requested_match_id uuid,
    requested_left_participant_id uuid,
    requested_right_participant_id uuid,
    requested_left_attempt_id uuid,
    requested_right_attempt_id uuid,
    requested_battle_session_id uuid,
    requested_outbox_id uuid,
    requested_seed bigint,
    requested_simulation_version text
)
RETURNS TABLE (
    match_id uuid,
    battle_session_id uuid,
    left_ticket_id uuid,
    left_attempt_id uuid,
    right_ticket_id uuid,
    right_attempt_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    left_ticket public.matchmaking_tickets%ROWTYPE;
    right_ticket public.matchmaking_tickets%ROWTYPE;
    caller_user_id uuid;
    left_window integer;
    right_window integer;
    rating_delta integer;
BEGIN
    IF requested_left_ticket_id = requested_right_ticket_id THEN
        RAISE EXCEPTION 'matchmaking tickets must be distinct' USING ERRCODE = '23514';
    END IF;
    IF requested_simulation_version IS NULL OR char_length(requested_simulation_version) NOT BETWEEN 1 AND 64 THEN
        RAISE EXCEPTION 'simulation version is invalid' USING ERRCODE = '23514';
    END IF;
    IF requested_seed <= 0 OR requested_seed > 4294967295 THEN
        RAISE EXCEPTION 'simulation seed is invalid' USING ERRCODE = '23514';
    END IF;

    SELECT * INTO left_ticket
    FROM public.matchmaking_tickets
    WHERE id = requested_left_ticket_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'left matchmaking ticket not found' USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO right_ticket
    FROM public.matchmaking_tickets
    WHERE id = requested_right_ticket_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'right matchmaking ticket not found' USING ERRCODE = 'P0002';
    END IF;

    caller_user_id := public.spacey_current_user_id();
    IF caller_user_id IS NULL OR caller_user_id NOT IN (left_ticket.user_id, right_ticket.user_id) THEN
        RAISE EXCEPTION 'caller does not own either matchmaking ticket' USING ERRCODE = '42501';
    END IF;
    IF left_ticket.user_id = right_ticket.user_id THEN
        RAISE EXCEPTION 'cannot match a player with itself' USING ERRCODE = '23514';
    END IF;
    IF left_ticket.status <> 'QUEUED' OR right_ticket.status <> 'QUEUED'
       OR left_ticket.expires_at <= CURRENT_TIMESTAMP OR right_ticket.expires_at <= CURRENT_TIMESTAMP THEN
        RAISE EXCEPTION 'matchmaking ticket is no longer queueable' USING ERRCODE = '40001';
    END IF;
    IF (left_ticket.queue, left_ticket.region, left_ticket.season_id, left_ticket.content_release_id, left_ticket.mission_definition_id)
       IS DISTINCT FROM
       (right_ticket.queue, right_ticket.region, right_ticket.season_id, right_ticket.content_release_id, right_ticket.mission_definition_id) THEN
        RAISE EXCEPTION 'matchmaking ticket policies are incompatible' USING ERRCODE = '23514';
    END IF;

    left_window := LEAST(
        left_ticket.max_mmr_window,
        left_ticket.base_mmr_window + FLOOR(GREATEST(0, EXTRACT(EPOCH FROM CURRENT_TIMESTAMP - left_ticket.created_at)))::integer
            * left_ticket.expansion_per_second
    );
    right_window := LEAST(
        right_ticket.max_mmr_window,
        right_ticket.base_mmr_window + FLOOR(GREATEST(0, EXTRACT(EPOCH FROM CURRENT_TIMESTAMP - right_ticket.created_at)))::integer
            * right_ticket.expansion_per_second
    );
    rating_delta := ABS(left_ticket.mmr - right_ticket.mmr);
    IF rating_delta > LEAST(left_window, right_window) THEN
        RAISE EXCEPTION 'MMR windows do not overlap' USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.pvp_matches (
        id, content_release_id, simulation_version, status, region, seed, created_at, updated_at
    ) VALUES (
        requested_match_id, left_ticket.content_release_id, requested_simulation_version,
        'MATCHED', left_ticket.region, requested_seed, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );

    INSERT INTO public.pvp_match_participants (
        id, pvp_match_id, user_id, build_revision_id, side, mmr_before, created_at
    ) VALUES
        (requested_left_participant_id, requested_match_id, left_ticket.user_id, left_ticket.build_revision_id, 0, left_ticket.mmr, CURRENT_TIMESTAMP),
        (requested_right_participant_id, requested_match_id, right_ticket.user_id, right_ticket.build_revision_id, 1, right_ticket.mmr, CURRENT_TIMESTAMP);

    INSERT INTO public.mission_attempts (
        id, user_id, mission_definition_id, content_release_id, build_revision_id,
        pvp_match_id, type, status, seed, simulation_version, idempotency_key, created_at, updated_at
    ) VALUES
        (requested_left_attempt_id, left_ticket.user_id, left_ticket.mission_definition_id,
         left_ticket.content_release_id, left_ticket.build_revision_id, requested_match_id,
         'PVP', 'CREATED', requested_seed, requested_simulation_version,
         'pvp-ticket:' || left_ticket.id::text, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        (requested_right_attempt_id, right_ticket.user_id, right_ticket.mission_definition_id,
         right_ticket.content_release_id, right_ticket.build_revision_id, requested_match_id,
         'PVP', 'CREATED', requested_seed, requested_simulation_version,
         'pvp-ticket:' || right_ticket.id::text, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

    INSERT INTO public.battle_sessions (
        id, pvp_match_id, content_release_id, status, simulation_version, created_at, updated_at
    ) VALUES (
        requested_battle_session_id, requested_match_id, left_ticket.content_release_id,
        'CREATED', requested_simulation_version, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );

    UPDATE public.matchmaking_tickets
    SET status = 'MATCHED', pvp_match_id = requested_match_id,
        matched_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id IN (left_ticket.id, right_ticket.id);

    INSERT INTO public.outbox_events (
        id, aggregate_type, aggregate_id, event_type, payload, status,
        attempt_count, available_at, idempotency_key, created_at, updated_at
    ) VALUES (
        requested_outbox_id, 'pvp_match', requested_match_id::text,
        'pvp.match.materialized',
        jsonb_build_object(
            'matchId', requested_match_id,
            'battleSessionId', requested_battle_session_id,
            'leftAttemptId', requested_left_attempt_id,
            'rightAttemptId', requested_right_attempt_id,
            'runtimeState', 'ready'
        ),
        'PENDING', 0, CURRENT_TIMESTAMP,
        'pvp-match-materialized:' || requested_match_id::text,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );

    RETURN QUERY SELECT
        requested_match_id,
        requested_battle_session_id,
        left_ticket.id,
        requested_left_attempt_id,
        right_ticket.id,
        requested_right_attempt_id;
END;
$$;
REVOKE ALL ON FUNCTION "spacey_materialize_pvp_match"(
    uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, bigint, text
) FROM PUBLIC;

CREATE FUNCTION "spacey_prepare_pvp_connection"(
    requested_ticket_id uuid,
    requested_ticket_hash text,
    requested_ticket_expires_at timestamptz
)
RETURNS TABLE (
    match_id uuid,
    battle_session_id uuid,
    seed bigint,
    content_version text,
    duration_seconds integer,
    participant_id uuid,
    user_id uuid,
    side integer,
    build_revision_id uuid,
    attempt_id uuid,
    definition_keys text[],
    previous_ticket_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    owned_ticket public.matchmaking_tickets%ROWTYPE;
    caller_user_id uuid;
    caller_participant_id uuid;
    caller_attempt_id uuid;
    old_ticket_hash text;
BEGIN
    caller_user_id := public.spacey_current_user_id();
    IF caller_user_id IS NULL THEN
        RAISE EXCEPTION 'player context is required' USING ERRCODE = '42501';
    END IF;
    IF requested_ticket_hash !~ '^[a-f0-9]{64}$'
       OR requested_ticket_expires_at <= CURRENT_TIMESTAMP
       OR requested_ticket_expires_at > CURRENT_TIMESTAMP + INTERVAL '60 seconds' THEN
        RAISE EXCEPTION 'battle ticket is invalid' USING ERRCODE = '23514';
    END IF;

    SELECT owned.* INTO owned_ticket
    FROM public.matchmaking_tickets owned
    WHERE owned.id = requested_ticket_id AND owned.user_id = caller_user_id
    FOR UPDATE;
    IF NOT FOUND OR owned_ticket.status <> 'MATCHED' OR owned_ticket.pvp_match_id IS NULL THEN
        RETURN;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.pvp_matches pvp
        WHERE pvp.id = owned_ticket.pvp_match_id
          AND pvp.status IN ('MATCHED', 'CONNECTING', 'ACTIVE')
    ) THEN
        RETURN;
    END IF;

    SELECT participant.id, participant.ws_ticket_hash
      INTO caller_participant_id, old_ticket_hash
    FROM public.pvp_match_participants participant
    WHERE participant.pvp_match_id = owned_ticket.pvp_match_id
      AND participant.user_id = caller_user_id
    FOR UPDATE;
    SELECT attempt.id INTO caller_attempt_id
    FROM public.mission_attempts attempt
    WHERE attempt.pvp_match_id = owned_ticket.pvp_match_id
      AND attempt.user_id = caller_user_id
      AND attempt.status IN ('CREATED', 'CONNECTING', 'ACTIVE', 'PAUSED')
      AND (attempt.reconnect_deadline IS NULL OR attempt.reconnect_deadline > CURRENT_TIMESTAMP)
    FOR UPDATE;
    IF caller_participant_id IS NULL OR caller_attempt_id IS NULL THEN
        RETURN;
    END IF;

    UPDATE public.pvp_match_participants
       SET ws_ticket_hash = requested_ticket_hash,
           ws_ticket_expires_at = requested_ticket_expires_at
     WHERE id = caller_participant_id;
    UPDATE public.mission_attempts
       SET ws_ticket_hash = requested_ticket_hash,
           ws_ticket_expires_at = requested_ticket_expires_at,
           status = CASE WHEN status = 'CREATED' THEN 'CONNECTING'::public.mission_attempt_status ELSE status END,
           updated_at = CURRENT_TIMESTAMP
     WHERE id = caller_attempt_id;
    UPDATE public.pvp_matches
       SET status = CASE WHEN status = 'MATCHED' THEN 'CONNECTING'::public.pvp_match_status ELSE status END,
           updated_at = CURRENT_TIMESTAMP
     WHERE id = owned_ticket.pvp_match_id;

    RETURN QUERY
    SELECT
        pvp.id,
        session.id,
        pvp.seed,
        release.version,
        mission.duration_seconds,
        participant.id,
        participant.user_id,
        participant.side,
        participant.build_revision_id,
        attempt.id,
        ARRAY(
            SELECT inventory.definition_key
            FROM public.build_revision_items installed
            JOIN public.inventory_items inventory ON inventory.id = installed.inventory_item_id
            WHERE installed.build_revision_id = participant.build_revision_id
            ORDER BY installed.slot_key, installed.id
        ),
        CASE WHEN participant.user_id = caller_user_id THEN old_ticket_hash ELSE NULL END
    FROM public.pvp_matches pvp
    JOIN public.battle_sessions session ON session.pvp_match_id = pvp.id
    JOIN public.matchmaking_tickets ticket ON ticket.id = requested_ticket_id
    JOIN public.content_releases release ON release.id = pvp.content_release_id
    JOIN public.mission_definitions mission ON mission.id = ticket.mission_definition_id
    JOIN public.pvp_match_participants participant ON participant.pvp_match_id = pvp.id
    JOIN public.mission_attempts attempt
      ON attempt.pvp_match_id = pvp.id AND attempt.user_id = participant.user_id
    WHERE pvp.id = owned_ticket.pvp_match_id
    ORDER BY participant.side;
END;
$$;
REVOKE ALL ON FUNCTION "spacey_prepare_pvp_connection"(uuid, text, timestamptz) FROM PUBLIC;
