-- Service roles remain NOBYPASSRLS. These policies grant only operations that
-- are also present in roles.grants.template.sql; table grants remain decisive.
CREATE POLICY "inventory_items_battle_worker" ON "inventory_items"
    FOR ALL TO spacey_battle_worker USING (true) WITH CHECK (true);
CREATE POLICY "inventory_transitions_battle_worker" ON "inventory_transitions"
    FOR ALL TO spacey_battle_worker USING (true) WITH CHECK (true);
CREATE POLICY "wallet_balances_battle_worker" ON "wallet_balances"
    FOR ALL TO spacey_battle_worker USING (true) WITH CHECK (true);
CREATE POLICY "wallet_ledger_entries_battle_worker" ON "wallet_ledger_entries"
    FOR ALL TO spacey_battle_worker USING (true) WITH CHECK (true);
CREATE POLICY "mission_attempts_battle_worker" ON "mission_attempts"
    FOR ALL TO spacey_battle_worker USING (true) WITH CHECK (true);
CREATE POLICY "pvp_match_participants_battle_worker" ON "pvp_match_participants"
    FOR ALL TO spacey_battle_worker USING (true) WITH CHECK (true);
CREATE POLICY "player_progression_battle_worker" ON "player_progression"
    FOR ALL TO spacey_battle_worker USING (true) WITH CHECK (true);
CREATE POLICY "user_research_battle_worker" ON "user_research"
    FOR ALL TO spacey_battle_worker USING (true) WITH CHECK (true);
CREATE POLICY "user_achievements_battle_worker" ON "user_achievements"
    FOR ALL TO spacey_battle_worker USING (true) WITH CHECK (true);
CREATE POLICY "season_participants_battle_worker" ON "season_participants"
    FOR ALL TO spacey_battle_worker USING (true) WITH CHECK (true);
CREATE POLICY "mission_results_battle_worker" ON "mission_results"
    FOR ALL TO spacey_battle_worker USING (true) WITH CHECK (true);
CREATE POLICY "replay_metadata_battle_worker" ON "replay_metadata"
    FOR ALL TO spacey_battle_worker USING (true) WITH CHECK (true);
CREATE POLICY "battle_sessions_battle_worker" ON "battle_sessions"
    FOR ALL TO spacey_battle_worker USING (true) WITH CHECK (true);
CREATE POLICY "battle_checkpoints_battle_worker" ON "battle_checkpoints"
    FOR ALL TO spacey_battle_worker USING (true) WITH CHECK (true);
CREATE POLICY "input_journal_battle_worker" ON "input_journal"
    FOR ALL TO spacey_battle_worker USING (true) WITH CHECK (true);

-- SECURITY DEFINER public views are owned by the migration owner. Application
-- roles still remain subject to RLS on direct table access.
ALTER TABLE "player_progression" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mission_attempts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "pvp_match_participants" NO FORCE ROW LEVEL SECURITY;

CREATE FUNCTION "spacey_public_profile"(requested_user_id uuid)
RETURNS TABLE (
    id uuid,
    display_name text,
    avatar_url text,
    joined_at timestamptz,
    level integer,
    season_rating integer,
    wins integer,
    losses integer,
    draws integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT
        u.id,
        COALESCE(u.display_name, 'Pilot') AS display_name,
        u.avatar_url,
        u.created_at AS joined_at,
        COALESCE(pp.level, 1) AS level,
        active_season.rating AS season_rating,
        COALESCE(active_season.wins, 0) AS wins,
        COALESCE(active_season.losses, 0) AS losses,
        COALESCE(active_season.draws, 0) AS draws
    FROM public.users u
    LEFT JOIN public.player_progression pp ON pp.user_id = u.id
    LEFT JOIN LATERAL (
        SELECT sp.rating, sp.wins, sp.losses, sp.draws
        FROM public.season_participants sp
        JOIN public.seasons s ON s.id = sp.season_id
        WHERE sp.user_id = u.id
          AND s.status = 'ACTIVE'
          AND s.starts_at <= CURRENT_TIMESTAMP
          AND s.ends_at > CURRENT_TIMESTAMP
        ORDER BY s.starts_at DESC, s.id DESC
        LIMIT 1
    ) active_season ON true
    WHERE u.id = requested_user_id
      AND u.status = 'ACTIVE'
      AND u.deleted_at IS NULL
      AND u.profile_public = true
$$;
REVOKE ALL ON FUNCTION "spacey_public_profile"(uuid) FROM PUBLIC;

CREATE FUNCTION "spacey_public_aggregate_stats"()
RETURNS TABLE (
    consented_players bigint,
    completed_battles bigint,
    completed_pvp_matches bigint,
    published_content_version text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT
        (
            SELECT count(*)
            FROM public.users u
            WHERE u.status = 'ACTIVE'
              AND u.deleted_at IS NULL
              AND u.analytics_consent_at IS NOT NULL
        ) AS consented_players,
        (
            SELECT count(*)
            FROM public.mission_attempts a
            JOIN public.users u ON u.id = a.user_id
            WHERE a.status = 'COMPLETED'
              AND u.status = 'ACTIVE'
              AND u.deleted_at IS NULL
              AND u.analytics_consent_at IS NOT NULL
        ) AS completed_battles,
        (
            SELECT count(*)
            FROM public.pvp_matches m
            WHERE m.status = 'COMPLETED'
              AND EXISTS (
                  SELECT 1 FROM public.pvp_match_participants participant
                  WHERE participant.pvp_match_id = m.id
              )
              AND NOT EXISTS (
                  SELECT 1
                  FROM public.pvp_match_participants participant
                  JOIN public.users u ON u.id = participant.user_id
                  WHERE participant.pvp_match_id = m.id
                    AND (u.status <> 'ACTIVE' OR u.deleted_at IS NOT NULL OR u.analytics_consent_at IS NULL)
              )
        ) AS completed_pvp_matches,
        (
            SELECT release.version
            FROM public.content_releases release
            WHERE release.status = 'PUBLISHED'
            ORDER BY release.published_at DESC NULLS LAST, release.id DESC
            LIMIT 1
        ) AS published_content_version
$$;
REVOKE ALL ON FUNCTION "spacey_public_aggregate_stats"() FROM PUBLIC;
