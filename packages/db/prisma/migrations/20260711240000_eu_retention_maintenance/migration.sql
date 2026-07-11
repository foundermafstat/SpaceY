-- Bounded EU retention maintenance. Retention cutoffs are fixed in code/SQL;
-- application configuration can change only cadence and batch size.

CREATE INDEX "auth_sessions_client_hash_retention_idx"
    ON "auth_sessions"("created_at", "id")
    WHERE "ip_hash" IS NOT NULL OR "user_agent_hash" IS NOT NULL;

CREATE INDEX "auth_sessions_expired_retention_idx"
    ON "auth_sessions"("expires_at", "id");

CREATE INDEX "privacy_requests_terminal_retention_idx"
    ON "privacy_requests"("retention_until", "id")
    WHERE "status" IN ('COMPLETED', 'FAILED');

-- SECURITY DEFINER retention is owned by the migration owner. Application
-- roles remain covered by the existing policies and table grants.
ALTER TABLE "privacy_requests" NO FORCE ROW LEVEL SECURITY;

CREATE INDEX "webhook_deliveries_terminal_retention_idx"
    ON "webhook_deliveries"("status", "updated_at", "id")
    WHERE "status" IN ('DELIVERED', 'DEAD');

CREATE INDEX "outbox_events_published_retention_idx"
    ON "outbox_events"("published_at", "id")
    WHERE "status" = 'PUBLISHED';

CREATE FUNCTION "spacey_jobs_purge_admin_audit_logs"(p_batch_size integer)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    deleted_count bigint;
BEGIN
    IF p_batch_size IS NULL OR p_batch_size < 1 OR p_batch_size > 5000 THEN
        RAISE EXCEPTION 'retention batch size must be between 1 and 5000'
            USING ERRCODE = '22023';
    END IF;

    PERFORM pg_catalog.set_config('spacey.admin_audit_retention_purge', 'on', true);

    WITH candidates AS (
        SELECT audit.id
          FROM public.admin_audit_logs AS audit
         WHERE audit.created_at < pg_catalog.statement_timestamp() - INTERVAL '1 year'
         ORDER BY audit.created_at, audit.id
         FOR UPDATE SKIP LOCKED
         LIMIT p_batch_size
    )
    DELETE FROM public.admin_audit_logs AS audit
     USING candidates
     WHERE audit.id = candidates.id;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;
REVOKE ALL ON FUNCTION "spacey_jobs_purge_admin_audit_logs"(integer) FROM PUBLIC;

-- Direct UPDATE/DELETE remains forbidden. The only exception is a delete made
-- by the owner of the narrow SECURITY DEFINER function above, while its
-- transaction-local guard is set, and only for rows older than one year.
CREATE FUNCTION "spacey_reject_admin_audit_mutation"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
    purge_owner name;
BEGIN
    SELECT pg_get_userbyid(proowner)
      INTO purge_owner
      FROM pg_proc
     WHERE oid = 'public.spacey_jobs_purge_admin_audit_logs(integer)'::regprocedure;

    IF TG_OP = 'DELETE'
       AND current_setting('spacey.admin_audit_retention_purge', true) = 'on'
       AND CURRENT_USER = purge_owner
       AND OLD.created_at < statement_timestamp() - INTERVAL '1 year'
    THEN
        RETURN OLD;
    END IF;

    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;
REVOKE ALL ON FUNCTION "spacey_reject_admin_audit_mutation"() FROM PUBLIC;

DROP TRIGGER "admin_audit_logs_append_only" ON "admin_audit_logs";
CREATE TRIGGER "admin_audit_logs_append_only"
    BEFORE UPDATE OR DELETE ON "admin_audit_logs"
    FOR EACH ROW EXECUTE FUNCTION "spacey_reject_admin_audit_mutation"();

-- The jobs role receives no broad DELETE grant on operational tables. This
-- function owns the complete fixed-cutoff policy and acquires the transaction
-- advisory lock even when invoked outside the application scheduler.
CREATE FUNCTION "spacey_jobs_apply_eu_retention"(p_batch_size integer)
RETURNS TABLE (
    skipped_lock boolean,
    auth_sessions_deleted bigint,
    auth_sessions_scrubbed bigint,
    telegram_auth_replays_deleted bigint,
    privacy_requests_deleted bigint,
    webhook_deliveries_deleted bigint,
    outbox_events_deleted bigint,
    admin_audit_logs_deleted bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_batch_size IS NULL OR p_batch_size < 1 OR p_batch_size > 5000 THEN
        RAISE EXCEPTION 'retention batch size must be between 1 and 5000'
            USING ERRCODE = '22023';
    END IF;

    auth_sessions_deleted := 0;
    auth_sessions_scrubbed := 0;
    telegram_auth_replays_deleted := 0;
    privacy_requests_deleted := 0;
    webhook_deliveries_deleted := 0;
    outbox_events_deleted := 0;
    admin_audit_logs_deleted := 0;
    skipped_lock := NOT pg_catalog.pg_try_advisory_xact_lock(1397768515, 1163483732);
    IF skipped_lock THEN
        RETURN NEXT;
        RETURN;
    END IF;

    WITH candidates AS (
        SELECT session.id
          FROM public.auth_sessions AS session
         WHERE session.expires_at < pg_catalog.statement_timestamp() - INTERVAL '30 days'
         ORDER BY session.expires_at, session.id
         FOR UPDATE SKIP LOCKED
         LIMIT p_batch_size
    )
    DELETE FROM public.auth_sessions AS session
     USING candidates
     WHERE session.id = candidates.id;
    GET DIAGNOSTICS auth_sessions_deleted = ROW_COUNT;

    WITH candidates AS (
        SELECT session.id
          FROM public.auth_sessions AS session
         WHERE session.created_at < pg_catalog.statement_timestamp() - INTERVAL '30 days'
           AND (session.ip_hash IS NOT NULL OR session.user_agent_hash IS NOT NULL)
         ORDER BY session.created_at, session.id
         FOR UPDATE SKIP LOCKED
         LIMIT p_batch_size
    )
    UPDATE public.auth_sessions AS session
       SET ip_hash = NULL, user_agent_hash = NULL, updated_at = pg_catalog.statement_timestamp()
      FROM candidates
     WHERE session.id = candidates.id;
    GET DIAGNOSTICS auth_sessions_scrubbed = ROW_COUNT;

    WITH candidates AS (
        SELECT replay.id
          FROM public.telegram_auth_replays AS replay
         WHERE replay.created_at < pg_catalog.statement_timestamp() - INTERVAL '30 days'
         ORDER BY replay.created_at, replay.id
         FOR UPDATE SKIP LOCKED
         LIMIT p_batch_size
    )
    DELETE FROM public.telegram_auth_replays AS replay
     USING candidates
     WHERE replay.id = candidates.id;
    GET DIAGNOSTICS telegram_auth_replays_deleted = ROW_COUNT;

    WITH candidates AS (
        SELECT request.id
          FROM public.privacy_requests AS request
         WHERE request.status IN ('COMPLETED', 'FAILED')
           AND request.retention_until < pg_catalog.statement_timestamp()
         ORDER BY request.retention_until, request.id
         FOR UPDATE SKIP LOCKED
         LIMIT p_batch_size
    )
    DELETE FROM public.privacy_requests AS request
     USING candidates
     WHERE request.id = candidates.id;
    GET DIAGNOSTICS privacy_requests_deleted = ROW_COUNT;

    WITH candidates AS (
        SELECT delivery.id
          FROM public.webhook_deliveries AS delivery
         WHERE (delivery.status = 'DELIVERED' AND delivery.updated_at < pg_catalog.statement_timestamp() - INTERVAL '30 days')
            OR (delivery.status = 'DEAD' AND delivery.updated_at < pg_catalog.statement_timestamp() - INTERVAL '90 days')
         ORDER BY delivery.updated_at, delivery.id
         FOR UPDATE SKIP LOCKED
         LIMIT p_batch_size
    )
    DELETE FROM public.webhook_deliveries AS delivery
     USING candidates
     WHERE delivery.id = candidates.id;
    GET DIAGNOSTICS webhook_deliveries_deleted = ROW_COUNT;

    WITH candidates AS (
        SELECT event.id
          FROM public.outbox_events AS event
         WHERE event.status = 'PUBLISHED'
           AND event.published_at < pg_catalog.statement_timestamp() - INTERVAL '30 days'
           AND NOT EXISTS (
               SELECT 1
                 FROM public.webhook_deliveries AS delivery
                WHERE delivery.outbox_event_id = event.id
                  AND delivery.status IN ('PENDING', 'DELIVERING', 'FAILED')
           )
         ORDER BY event.published_at, event.id
         FOR UPDATE OF event SKIP LOCKED
         LIMIT p_batch_size
    )
    DELETE FROM public.outbox_events AS event
     USING candidates
     WHERE event.id = candidates.id;
    GET DIAGNOSTICS outbox_events_deleted = ROW_COUNT;

    SELECT public.spacey_jobs_purge_admin_audit_logs(p_batch_size)
      INTO admin_audit_logs_deleted;
    RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION "spacey_jobs_apply_eu_retention"(integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "spacey_jobs_purge_admin_audit_logs"(integer) TO spacey_jobs;
GRANT EXECUTE ON FUNCTION "spacey_jobs_apply_eu_retention"(integer) TO spacey_jobs;
