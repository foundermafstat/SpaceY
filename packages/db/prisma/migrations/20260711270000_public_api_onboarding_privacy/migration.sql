-- Owner-scoped Public API onboarding, bounded credential overlap, and the
-- remaining privacy/retention maintenance needed by the partner contour.

ALTER TABLE "api_clients"
    ADD COLUMN "previous_client_secret_hash" TEXT,
    ADD COLUMN "previous_client_secret_expires_at" TIMESTAMPTZ(6),
    ADD CONSTRAINT "api_clients_previous_secret_pair_check" CHECK (
        ("previous_client_secret_hash" IS NULL) = ("previous_client_secret_expires_at" IS NULL)
    );

CREATE UNIQUE INDEX "api_clients_previous_client_secret_hash_key"
    ON "api_clients"("previous_client_secret_hash")
    WHERE "previous_client_secret_hash" IS NOT NULL;

ALTER TABLE "webhook_subscriptions"
    ADD COLUMN "previous_secret_hash" TEXT,
    ADD COLUMN "previous_secret_expires_at" TIMESTAMPTZ(6),
    ADD CONSTRAINT "webhook_subscriptions_previous_secret_pair_check" CHECK (
        ("previous_secret_hash" IS NULL) = ("previous_secret_expires_at" IS NULL)
    );

-- Direct player mutations remain owner-scoped. Authentication uses the narrow
-- SECURITY DEFINER functions below and never exposes a credential hash.
ALTER TABLE "api_clients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "api_clients" NO FORCE ROW LEVEL SECURITY;
CREATE POLICY "api_clients_owner" ON "api_clients" FOR ALL TO spacey_runtime
    USING (owner_user_id = public.spacey_current_user_id())
    WITH CHECK (owner_user_id = public.spacey_current_user_id());
CREATE POLICY "api_clients_admin" ON "api_clients" FOR ALL TO spacey_admin
    USING (true) WITH CHECK (true);
CREATE POLICY "api_clients_jobs_owner_read" ON "api_clients" FOR SELECT TO spacey_jobs
    USING (owner_user_id = public.spacey_current_user_id());
CREATE POLICY "api_clients_jobs_anonymize" ON "api_clients" FOR UPDATE TO spacey_jobs
    USING (owner_user_id = public.spacey_current_user_id())
    WITH CHECK (
        owner_user_id IS NULL
        AND status = 'REVOKED'::public.api_client_status
        AND client_secret_hash IS NULL
        AND previous_client_secret_hash IS NULL
    );

ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "api_keys" NO FORCE ROW LEVEL SECURITY;
CREATE POLICY "api_keys_owner" ON "api_keys" FOR ALL TO spacey_runtime
    USING (EXISTS (
        SELECT 1 FROM public.api_clients client
         WHERE client.id = api_keys.api_client_id
           AND client.owner_user_id = public.spacey_current_user_id()
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.api_clients client
         WHERE client.id = api_keys.api_client_id
           AND client.owner_user_id = public.spacey_current_user_id()
    ));
CREATE POLICY "api_keys_admin" ON "api_keys" FOR ALL TO spacey_admin
    USING (true) WITH CHECK (true);
CREATE POLICY "api_keys_jobs_owner_read" ON "api_keys" FOR SELECT TO spacey_jobs
    USING (EXISTS (
        SELECT 1 FROM public.api_clients client
         WHERE client.id = api_keys.api_client_id
           AND client.owner_user_id = public.spacey_current_user_id()
    ));
CREATE POLICY "api_keys_jobs_revoke" ON "api_keys" FOR UPDATE TO spacey_jobs
    USING (EXISTS (
        SELECT 1 FROM public.api_clients client
         WHERE client.id = api_keys.api_client_id
           AND client.owner_user_id = public.spacey_current_user_id()
    ))
    WITH CHECK (revoked_at IS NOT NULL AND cardinality(scopes) = 0);

ALTER TABLE "webhook_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_subscriptions" NO FORCE ROW LEVEL SECURITY;
CREATE POLICY "webhook_subscriptions_owner" ON "webhook_subscriptions" FOR ALL TO spacey_runtime
    USING (EXISTS (
        SELECT 1 FROM public.api_clients client
         WHERE client.id = webhook_subscriptions.api_client_id
           AND client.owner_user_id = public.spacey_current_user_id()
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.api_clients client
         WHERE client.id = webhook_subscriptions.api_client_id
           AND client.owner_user_id = public.spacey_current_user_id()
    ));
CREATE POLICY "webhook_subscriptions_admin" ON "webhook_subscriptions" FOR ALL TO spacey_admin
    USING (true) WITH CHECK (true);
CREATE POLICY "webhook_subscriptions_jobs_read" ON "webhook_subscriptions" FOR SELECT TO spacey_jobs
    USING (status = 'ACTIVE'::public.webhook_status);
CREATE POLICY "webhook_subscriptions_jobs_owner_read" ON "webhook_subscriptions" FOR SELECT TO spacey_jobs
    USING (EXISTS (
        SELECT 1 FROM public.api_clients client
         WHERE client.id = webhook_subscriptions.api_client_id
           AND client.owner_user_id = public.spacey_current_user_id()
    ));
CREATE POLICY "webhook_subscriptions_jobs_revoke" ON "webhook_subscriptions" FOR UPDATE TO spacey_jobs
    USING (EXISTS (
        SELECT 1 FROM public.api_clients client
         WHERE client.id = webhook_subscriptions.api_client_id
           AND client.owner_user_id = public.spacey_current_user_id()
    ))
    WITH CHECK (
        status = 'REVOKED'::public.webhook_status
        AND cardinality(event_types) = 0
        AND previous_secret_hash IS NULL
    );

CREATE POLICY "matchmaking_tickets_jobs_owner_read" ON "matchmaking_tickets" FOR SELECT TO spacey_jobs
    USING (user_id = public.spacey_current_user_id());
CREATE POLICY "pvp_matches_jobs_owner_read" ON "pvp_matches" FOR SELECT TO spacey_jobs
    USING (EXISTS (
        SELECT 1 FROM public.pvp_match_participants participant
         WHERE participant.pvp_match_id = pvp_matches.id
           AND participant.user_id = public.spacey_current_user_id()
    ));

GRANT SELECT ON
    "research_definitions", "user_research", "achievement_definitions", "user_achievements",
    "seasons", "season_participants", "matchmaking_tickets", "pvp_matches", "pvp_match_participants",
    "api_clients", "api_keys", "webhook_subscriptions", "stars_payment_events",
    "telegram_referrals", "telegram_support_tickets", "telegram_support_messages",
    "telegram_notification_preferences"
TO spacey_jobs;
GRANT UPDATE ON "api_clients", "api_keys", "webhook_subscriptions", "stars_payment_events" TO spacey_jobs;

CREATE FUNCTION "spacey_authenticate_public_oauth_client"(
    requested_client_id text,
    requested_secret_hash text
)
RETURNS TABLE (client_id text, scopes text[], rate_limit_per_minute integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT client.client_id, client.scopes, client.rate_limit_per_minute
      FROM public.api_clients client
     WHERE client.client_id = requested_client_id
       AND client.status = 'ACTIVE'::public.api_client_status
       AND (
           client.client_secret_hash = requested_secret_hash
           OR (
               client.previous_client_secret_hash = requested_secret_hash
               AND client.previous_client_secret_expires_at > pg_catalog.statement_timestamp()
           )
       )
     LIMIT 1
$$;
REVOKE ALL ON FUNCTION "spacey_authenticate_public_oauth_client"(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "spacey_authenticate_public_oauth_client"(text, text) TO spacey_runtime;

CREATE FUNCTION "spacey_get_active_public_client"(requested_client_id text)
RETURNS TABLE (client_id text, scopes text[], rate_limit_per_minute integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT client.client_id, client.scopes, client.rate_limit_per_minute
      FROM public.api_clients client
     WHERE client.client_id = requested_client_id
       AND client.status = 'ACTIVE'::public.api_client_status
     LIMIT 1
$$;
REVOKE ALL ON FUNCTION "spacey_get_active_public_client"(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "spacey_get_active_public_client"(text) TO spacey_runtime;

CREATE FUNCTION "spacey_authenticate_public_api_key"(requested_secret_hash text)
RETURNS TABLE (client_id text, scopes text[], rate_limit_per_minute integer)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH matched AS (
        SELECT key.id,
               client.client_id,
               ARRAY(
                   SELECT scope
                     FROM pg_catalog.unnest(key.scopes) AS allowed_scope(scope)
                    WHERE scope = ANY(client.scopes)
                    ORDER BY scope
               ) AS scopes,
               client.rate_limit_per_minute
          FROM public.api_keys key
          JOIN public.api_clients client ON client.id = key.api_client_id
         WHERE key.secret_hash = requested_secret_hash
           AND key.revoked_at IS NULL
           AND (key.expires_at IS NULL OR key.expires_at > pg_catalog.statement_timestamp())
           AND client.status = 'ACTIVE'::public.api_client_status
         LIMIT 1
         FOR UPDATE OF key
    ), touched AS (
        UPDATE public.api_keys key
           SET last_used_at = pg_catalog.statement_timestamp()
          FROM matched
         WHERE key.id = matched.id
        RETURNING key.id
    )
    SELECT matched.client_id, matched.scopes, matched.rate_limit_per_minute
      FROM matched JOIN touched ON touched.id = matched.id
$$;
REVOKE ALL ON FUNCTION "spacey_authenticate_public_api_key"(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "spacey_authenticate_public_api_key"(text) TO spacey_runtime;

-- Retention owner functions may bypass RLS; application and worker roles still
-- remain covered by their existing policies and grants.
ALTER TABLE "input_journal" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "replay_metadata" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "battle_checkpoints" NO FORCE ROW LEVEL SECURITY;

CREATE FUNCTION "spacey_jobs_apply_extended_retention"(p_batch_size integer)
RETURNS TABLE (
    oauth_overlap_secrets_cleared bigint,
    webhook_overlap_secrets_cleared bigint,
    api_keys_deleted bigint,
    input_journal_deleted bigint,
    replay_metadata_deleted bigint,
    battle_checkpoints_deleted bigint
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

    WITH candidates AS (
        SELECT client.id FROM public.api_clients client
         WHERE client.previous_client_secret_expires_at <= pg_catalog.statement_timestamp()
         ORDER BY client.previous_client_secret_expires_at, client.id
         FOR UPDATE SKIP LOCKED LIMIT p_batch_size
    )
    UPDATE public.api_clients client
       SET previous_client_secret_hash = NULL,
           previous_client_secret_expires_at = NULL,
           updated_at = pg_catalog.statement_timestamp()
      FROM candidates WHERE client.id = candidates.id;
    GET DIAGNOSTICS oauth_overlap_secrets_cleared = ROW_COUNT;

    WITH candidates AS (
        SELECT subscription.id FROM public.webhook_subscriptions subscription
         WHERE subscription.previous_secret_expires_at <= pg_catalog.statement_timestamp()
         ORDER BY subscription.previous_secret_expires_at, subscription.id
         FOR UPDATE SKIP LOCKED LIMIT p_batch_size
    )
    UPDATE public.webhook_subscriptions subscription
       SET previous_secret_hash = NULL,
           previous_secret_expires_at = NULL,
           updated_at = pg_catalog.statement_timestamp()
      FROM candidates WHERE subscription.id = candidates.id;
    GET DIAGNOSTICS webhook_overlap_secrets_cleared = ROW_COUNT;

    WITH candidates AS (
        SELECT key.id FROM public.api_keys key
         WHERE (key.revoked_at IS NOT NULL AND key.revoked_at < pg_catalog.statement_timestamp() - INTERVAL '30 days')
            OR (key.expires_at IS NOT NULL AND key.expires_at < pg_catalog.statement_timestamp() - INTERVAL '30 days')
         ORDER BY COALESCE(key.revoked_at, key.expires_at), key.id
         FOR UPDATE SKIP LOCKED LIMIT p_batch_size
    )
    DELETE FROM public.api_keys key USING candidates WHERE key.id = candidates.id;
    GET DIAGNOSTICS api_keys_deleted = ROW_COUNT;

    WITH candidates AS (
        SELECT journal.id
          FROM public.input_journal journal
          JOIN public.battle_sessions session ON session.id = journal.battle_session_id
         WHERE journal.created_at < pg_catalog.statement_timestamp() - INTERVAL '30 days'
           AND session.status IN ('ENDED'::public.battle_session_status, 'FAILED'::public.battle_session_status)
         ORDER BY journal.created_at, journal.id
         FOR UPDATE OF journal SKIP LOCKED LIMIT p_batch_size
    )
    DELETE FROM public.input_journal journal USING candidates WHERE journal.id = candidates.id;
    GET DIAGNOSTICS input_journal_deleted = ROW_COUNT;

    WITH candidates AS (
        SELECT replay.id FROM public.replay_metadata replay
         WHERE replay.expires_at <= pg_catalog.statement_timestamp()
         ORDER BY replay.expires_at, replay.id
         FOR UPDATE SKIP LOCKED LIMIT p_batch_size
    )
    DELETE FROM public.replay_metadata replay USING candidates WHERE replay.id = candidates.id;
    GET DIAGNOSTICS replay_metadata_deleted = ROW_COUNT;

    WITH candidates AS (
        SELECT checkpoint.id FROM public.battle_checkpoints checkpoint
         WHERE checkpoint.expires_at <= pg_catalog.statement_timestamp()
         ORDER BY checkpoint.expires_at, checkpoint.id
         FOR UPDATE SKIP LOCKED LIMIT p_batch_size
    )
    DELETE FROM public.battle_checkpoints checkpoint USING candidates WHERE checkpoint.id = candidates.id;
    GET DIAGNOSTICS battle_checkpoints_deleted = ROW_COUNT;

    RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION "spacey_jobs_apply_extended_retention"(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "spacey_jobs_apply_extended_retention"(integer) TO spacey_jobs;

CREATE INDEX "input_journal_terminal_retention_idx" ON "input_journal"("created_at", "battle_session_id", "id");
