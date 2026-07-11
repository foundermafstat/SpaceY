\set ON_ERROR_STOP on

-- Run once as the Neon project owner before the baseline migration.
-- These are NOLOGIN group roles. Create credential-bearing login roles through
-- the platform secret manager, grant them one group role, and never commit them.
-- PostgreSQL does not apply these group-role GUC defaults at member login: mirror
-- the matching timeout/read-only settings onto each credential-bearing login role.
DO $$
DECLARE
    role_name text;
BEGIN
    EXECUTE format(
        'REVOKE CONNECT, TEMPORARY ON DATABASE %I FROM PUBLIC',
        current_database()
    );

    FOREACH role_name IN ARRAY ARRAY[
        'spacey_migrator',
        'spacey_runtime',
        'spacey_battle_worker',
        'spacey_telegram_bot',
        'spacey_admin',
        'spacey_jobs',
        'spacey_readonly'
    ] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            EXECUTE format('CREATE ROLE %I NOLOGIN', role_name);
        END IF;

        EXECUTE format(
            'ALTER ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
            role_name
        );
        EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), role_name);
    END LOOP;
END;
$$;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO spacey_migrator;
GRANT USAGE ON SCHEMA public TO spacey_runtime, spacey_battle_worker, spacey_telegram_bot, spacey_admin, spacey_jobs, spacey_readonly;

ALTER ROLE spacey_runtime SET statement_timeout = '5s';
ALTER ROLE spacey_runtime SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE spacey_battle_worker SET statement_timeout = '5s';
ALTER ROLE spacey_battle_worker SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE spacey_telegram_bot SET statement_timeout = '5s';
ALTER ROLE spacey_telegram_bot SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE spacey_admin SET statement_timeout = '15s';
ALTER ROLE spacey_admin SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE spacey_jobs SET statement_timeout = '30s';
ALTER ROLE spacey_jobs SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE spacey_readonly SET statement_timeout = '10s';
ALTER ROLE spacey_readonly SET default_transaction_read_only = on;
