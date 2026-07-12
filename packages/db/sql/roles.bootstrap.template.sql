\set ON_ERROR_STOP on

-- Run through the Docker data-plane access-bootstrap profile before migrations.
-- These are NOLOGIN group roles. Credential-bearing logins are synchronized from
-- root-owned secret files, receive one group role, and are never committed.
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
        'spacey_backup',
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
GRANT pg_read_all_data TO spacey_backup;

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
ALTER ROLE spacey_backup SET statement_timeout = '0';
ALTER ROLE spacey_backup SET default_transaction_read_only = on;
ALTER ROLE spacey_readonly SET statement_timeout = '10s';
ALTER ROLE spacey_readonly SET default_transaction_read_only = on;
