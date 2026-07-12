-- Reclaim PvE attempts that issued a connection ticket but never attached to
-- a battle worker. PvP no-show is finalized by the battle worker's separate
-- 20-second policy and must not be handled here.

CREATE INDEX "mission_attempts_stale_pve_connecting_idx"
    ON "mission_attempts"("updated_at", "id")
    WHERE "type" = 'PVE' AND "status" = 'CONNECTING';

-- SECURITY DEFINER maintenance functions are owned by the NOLOGIN migrator.
-- Application roles remain subject to the existing RLS policies.
ALTER TABLE "battle_sessions" NO FORCE ROW LEVEL SECURITY;

CREATE FUNCTION "spacey_jobs_abandon_stale_connecting_attempts"(p_batch_size integer)
RETURNS TABLE (
    attempt_id uuid,
    session_id uuid,
    user_id uuid,
    ticket_hash text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_batch_size < 1 OR p_batch_size > 1000 THEN
        RAISE EXCEPTION 'batch size must be between 1 and 1000'
            USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    WITH candidates AS MATERIALIZED (
        SELECT
            attempt.id,
            attempt.user_id,
            attempt.ws_ticket_hash,
            session.id AS session_id
        FROM public.mission_attempts attempt
        LEFT JOIN public.battle_sessions session
          ON session.mission_attempt_id = attempt.id
        WHERE attempt.type = 'PVE'::public.mission_attempt_type
          AND attempt.status = 'CONNECTING'::public.mission_attempt_status
          AND attempt.updated_at <= CURRENT_TIMESTAMP - INTERVAL '60 seconds'
        ORDER BY attempt.updated_at, attempt.id
        FOR UPDATE OF attempt SKIP LOCKED
        LIMIT p_batch_size
    ), abandoned AS (
        UPDATE public.mission_attempts attempt
           SET status = 'ABANDONED'::public.mission_attempt_status,
               ended_at = CURRENT_TIMESTAMP,
               disconnected_at = NULL,
               reconnect_deadline = NULL,
               ws_ticket_hash = NULL,
               ws_ticket_expires_at = NULL,
               updated_at = CURRENT_TIMESTAMP
          FROM candidates candidate
         WHERE attempt.id = candidate.id
           AND attempt.type = 'PVE'::public.mission_attempt_type
           AND attempt.status = 'CONNECTING'::public.mission_attempt_status
           AND attempt.updated_at <= CURRENT_TIMESTAMP - INTERVAL '60 seconds'
        RETURNING attempt.id, candidate.session_id, candidate.user_id, candidate.ws_ticket_hash
    ), ended_sessions AS (
        UPDATE public.battle_sessions session
           SET status = 'ENDED'::public.battle_session_status,
               worker_id = NULL,
               ended_at = COALESCE(session.ended_at, CURRENT_TIMESTAMP),
               updated_at = CURRENT_TIMESTAMP
          FROM abandoned
         WHERE session.id = abandoned.session_id
           AND session.status = 'CREATED'::public.battle_session_status
        RETURNING session.id
    )
    SELECT
        abandoned.id,
        abandoned.session_id,
        abandoned.user_id,
        abandoned.ws_ticket_hash
    FROM abandoned
    LEFT JOIN ended_sessions ON ended_sessions.id = abandoned.session_id;
END;
$$;

REVOKE ALL ON FUNCTION "spacey_jobs_abandon_stale_connecting_attempts"(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "spacey_jobs_abandon_stale_connecting_attempts"(integer) TO spacey_jobs;
