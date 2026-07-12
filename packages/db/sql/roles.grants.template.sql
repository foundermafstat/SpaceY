\set ON_ERROR_STOP on

-- Run after migrations as the object owner. Re-run after adding tables.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public
    FROM spacey_runtime, spacey_battle_worker, spacey_telegram_bot, spacey_admin, spacey_jobs, spacey_readonly;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public
    FROM spacey_runtime, spacey_battle_worker, spacey_telegram_bot, spacey_admin, spacey_jobs, spacey_readonly;

GRANT SELECT ON
    content_releases,
    mission_definitions,
    module_definitions,
    enemy_definitions,
    drop_tables,
    research_definitions,
    achievement_definitions,
    seasons
TO spacey_runtime, spacey_battle_worker, spacey_admin, spacey_jobs, spacey_readonly;

GRANT SELECT, INSERT, UPDATE ON
    users,
    telegram_identities,
    auth_sessions,
    ship_builds,
    inventory_items,
    wallet_balances,
    mission_attempts,
    matchmaking_tickets,
    player_progression,
    user_research,
    user_achievements,
    season_participants,
    legacy_build_imports,
    player_command_idempotency,
    repair_quotes
TO spacey_runtime;
GRANT SELECT ON pvp_matches, pvp_match_participants TO spacey_runtime;
GRANT SELECT, INSERT ON privacy_requests TO spacey_runtime;
GRANT SELECT, INSERT ON
    telegram_auth_replays,
    ship_build_revisions,
    build_revision_items,
    inventory_transitions,
    wallet_ledger_entries,
    mission_results,
    replay_metadata
TO spacey_runtime;
GRANT SELECT, INSERT, UPDATE ON battle_sessions TO spacey_runtime;
GRANT SELECT ON battle_checkpoints, input_journal TO spacey_runtime;

GRANT SELECT, INSERT, UPDATE ON
    api_clients,
    api_keys,
    webhook_subscriptions
TO spacey_runtime;
GRANT SELECT ON webhook_deliveries, stars_payment_events TO spacey_runtime;
GRANT INSERT ON outbox_events TO spacey_runtime;

GRANT SELECT ON
    users,
    ship_builds,
    ship_build_revisions,
    build_revision_items,
    inventory_items,
    wallet_balances,
    mission_attempts,
    matchmaking_tickets,
    pvp_matches,
    pvp_match_participants,
    battle_sessions,
    player_progression,
    user_research,
    user_achievements,
    season_participants
TO spacey_battle_worker;
GRANT INSERT, UPDATE ON
    mission_attempts,
    pvp_matches,
    pvp_match_participants,
    wallet_balances,
    inventory_items,
    player_progression,
    user_research,
    user_achievements,
    season_participants,
    battle_sessions
TO spacey_battle_worker;
GRANT UPDATE ON matchmaking_tickets TO spacey_battle_worker;
GRANT SELECT, INSERT ON
    mission_results,
    replay_metadata,
    wallet_ledger_entries,
    inventory_transitions,
    input_journal
TO spacey_battle_worker;
GRANT SELECT, INSERT, DELETE ON battle_checkpoints TO spacey_battle_worker;
GRANT INSERT ON outbox_events TO spacey_battle_worker;

GRANT SELECT, INSERT, UPDATE ON
    telegram_bot_updates,
    telegram_support_tickets,
    telegram_notification_preferences
TO spacey_telegram_bot;
GRANT SELECT, INSERT ON
    telegram_referrals,
    telegram_support_messages
TO spacey_telegram_bot;

GRANT SELECT, INSERT, UPDATE ON
    content_releases,
    mission_definitions,
    module_definitions,
    enemy_definitions,
    drop_tables,
    research_definitions,
    achievement_definitions,
    seasons,
    admin_users,
    admin_roles,
    admin_user_roles,
    webauthn_credentials,
    admin_sessions,
    admin_webauthn_challenges,
    api_clients,
    api_keys,
    webhook_subscriptions
TO spacey_admin;
GRANT SELECT, INSERT ON admin_audit_logs, content_definition_revisions, outbox_events TO spacey_admin;
GRANT SELECT ON webhook_deliveries, stars_payment_events TO spacey_admin;

GRANT SELECT, INSERT, UPDATE ON outbox_events TO spacey_jobs;
GRANT SELECT, INSERT, UPDATE, DELETE ON job_idempotency_keys TO spacey_jobs;
GRANT SELECT, UPDATE ON privacy_requests TO spacey_jobs;
GRANT SELECT ON
    users,
    telegram_identities,
    auth_sessions,
    ship_builds,
    ship_build_revisions,
    build_revision_items,
    inventory_items,
    wallet_balances,
    wallet_ledger_entries,
    mission_attempts,
    mission_results,
    player_progression,
    research_definitions,
    user_research,
    achievement_definitions,
    user_achievements,
    seasons,
    season_participants,
    matchmaking_tickets,
    pvp_matches,
    pvp_match_participants,
    api_keys
TO spacey_jobs;
GRANT UPDATE ON users, auth_sessions TO spacey_jobs;
GRANT SELECT, UPDATE ON telegram_auth_replays TO spacey_jobs;
GRANT SELECT, DELETE ON telegram_identities, telegram_referrals, telegram_support_messages,
    telegram_support_tickets, telegram_notification_preferences
TO spacey_jobs;
GRANT SELECT ON webhook_subscriptions, api_clients, stars_payment_events TO spacey_jobs;
GRANT UPDATE ON api_clients, api_keys, webhook_subscriptions TO spacey_jobs;
GRANT SELECT, INSERT, UPDATE ON webhook_deliveries TO spacey_jobs;
GRANT INSERT ON stars_payment_events TO spacey_jobs;

GRANT EXECUTE ON FUNCTION spacey_current_user_id() TO spacey_runtime, spacey_battle_worker, spacey_jobs;
GRANT EXECUTE ON FUNCTION spacey_authenticate_public_oauth_client(text, text) TO spacey_runtime;
GRANT EXECUTE ON FUNCTION spacey_authenticate_public_api_key(text) TO spacey_runtime;
GRANT EXECUTE ON FUNCTION spacey_get_active_public_client(text) TO spacey_runtime;
GRANT EXECUTE ON FUNCTION spacey_jobs_apply_extended_retention(integer) TO spacey_jobs;
GRANT EXECUTE ON FUNCTION spacey_anonymize_stars_payment_events(uuid) TO spacey_jobs;
GRANT EXECUTE ON FUNCTION spacey_materialize_pvp_match(
    uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, bigint, text
) TO spacey_runtime;
GRANT EXECUTE ON FUNCTION spacey_prepare_pvp_connection(uuid, text, timestamptz)
TO spacey_runtime;
GRANT EXECUTE ON FUNCTION spacey_load_pvp_simulation_source(uuid) TO spacey_runtime;
GRANT EXECUTE ON FUNCTION spacey_assert_owned_build_launchable(uuid) TO spacey_runtime;
GRANT EXECUTE ON FUNCTION spacey_validate_input_journal_owner() TO spacey_battle_worker;
GRANT EXECUTE ON FUNCTION spacey_public_leaderboard(integer) TO spacey_runtime, spacey_readonly;
GRANT EXECUTE ON FUNCTION spacey_admin_adjust_wallet(uuid, uuid, uuid, wallet_currency, bigint, text, uuid, jsonb)
TO spacey_admin;
GRANT EXECUTE ON FUNCTION spacey_public_profile(uuid) TO spacey_runtime, spacey_readonly;
GRANT EXECUTE ON FUNCTION spacey_public_aggregate_stats() TO spacey_runtime, spacey_readonly;
GRANT EXECUTE ON FUNCTION spacey_jobs_purge_admin_audit_logs(integer) TO spacey_jobs;
GRANT EXECUTE ON FUNCTION spacey_jobs_apply_eu_retention(integer) TO spacey_jobs;
GRANT EXECUTE ON FUNCTION spacey_jobs_abandon_stale_connecting_attempts(integer) TO spacey_jobs;

ALTER DEFAULT PRIVILEGES FOR ROLE spacey_migrator IN SCHEMA public
    REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE spacey_migrator IN SCHEMA public
    REVOKE ALL ON FUNCTIONS FROM PUBLIC;
-- The credential-bearing migration login owns objects unless it explicitly
-- SET ROLE first, so protect defaults for the actual grants executor as well.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE ALL ON FUNCTIONS FROM PUBLIC;
