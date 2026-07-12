#!/bin/sh
set -eu

config_dir=${SPACEY_CONFIG_DIR:-/etc/spacey}
secret_dir=${SPACEY_POSTGRES_SECRET_DIR:-$config_dir/postgres}

read_secret() {
  file=$1
  if [ ! -f "$file" ] || [ ! -s "$file" ]; then
    echo "Required PostgreSQL secret file is missing or empty: $file" >&2
    exit 64
  fi
  value=$(cat "$file")
  case "$value" in
    *"
"*) echo "PostgreSQL secret must contain exactly one line: $file" >&2; exit 64 ;;
  esac
  printf '%s' "$value"
}

export PGPASSWORD
export SPACEY_MIGRATOR_PASSWORD
export SPACEY_RUNTIME_PASSWORD
export SPACEY_BATTLE_PASSWORD
export SPACEY_ADMIN_PASSWORD
export SPACEY_JOBS_PASSWORD
export SPACEY_BOT_PASSWORD
export SPACEY_BACKUP_PASSWORD
export SPACEY_READONLY_PASSWORD

PGPASSWORD=$(read_secret "$secret_dir/superuser-password")
SPACEY_MIGRATOR_PASSWORD=$(read_secret "$secret_dir/migrator-password")
SPACEY_RUNTIME_PASSWORD=$(read_secret "$secret_dir/runtime-password")
SPACEY_BATTLE_PASSWORD=$(read_secret "$secret_dir/battle-worker-password")
SPACEY_ADMIN_PASSWORD=$(read_secret "$secret_dir/admin-password")
SPACEY_JOBS_PASSWORD=$(read_secret "$secret_dir/jobs-password")
SPACEY_BOT_PASSWORD=$(read_secret "$secret_dir/telegram-bot-password")
SPACEY_BACKUP_PASSWORD=$(read_secret "$secret_dir/backup-password")
SPACEY_READONLY_PASSWORD=$(read_secret "$secret_dir/readonly-password")

host=${POSTGRES_HOST:-postgres}
port=${POSTGRES_PORT:-5432}
database=${POSTGRES_DATABASE:?POSTGRES_DATABASE is required}
superuser=${POSTGRES_SUPERUSER:-spacey_bootstrap}

psql -h "$host" -p "$port" -U "$superuser" -d "$database" -v ON_ERROR_STOP=1 \
  -f /spacey-db-roles/roles.bootstrap.template.sql

psql -h "$host" -p "$port" -U "$superuser" -d "$database" -v ON_ERROR_STOP=1 <<'SQL'
\getenv migrator_password SPACEY_MIGRATOR_PASSWORD
\getenv runtime_password SPACEY_RUNTIME_PASSWORD
\getenv battle_password SPACEY_BATTLE_PASSWORD
\getenv admin_password SPACEY_ADMIN_PASSWORD
\getenv jobs_password SPACEY_JOBS_PASSWORD
\getenv bot_password SPACEY_BOT_PASSWORD
\getenv backup_password SPACEY_BACKUP_PASSWORD
\getenv readonly_password SPACEY_READONLY_PASSWORD

SELECT format('CREATE ROLE %I LOGIN', login_name)
FROM (VALUES
  ('spacey_migrator_login'),
  ('spacey_runtime_login'),
  ('spacey_battle_worker_login'),
  ('spacey_admin_login'),
  ('spacey_jobs_login'),
  ('spacey_telegram_bot_login'),
  ('spacey_backup_login'),
  ('spacey_readonly_login')
) roles(login_name)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = login_name)
\gexec

SELECT format(
  'ALTER ROLE %I LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
  login_name,
  login_password
)
FROM (VALUES
  ('spacey_migrator_login', :'migrator_password'),
  ('spacey_runtime_login', :'runtime_password'),
  ('spacey_battle_worker_login', :'battle_password'),
  ('spacey_admin_login', :'admin_password'),
  ('spacey_jobs_login', :'jobs_password'),
  ('spacey_telegram_bot_login', :'bot_password'),
  ('spacey_backup_login', :'backup_password'),
  ('spacey_readonly_login', :'readonly_password')
) roles(login_name, login_password)
\gexec

REVOKE spacey_migrator, spacey_runtime, spacey_battle_worker, spacey_telegram_bot,
  spacey_admin, spacey_jobs, spacey_backup, spacey_readonly
FROM spacey_migrator_login, spacey_runtime_login, spacey_battle_worker_login,
  spacey_admin_login, spacey_jobs_login, spacey_telegram_bot_login, spacey_backup_login, spacey_readonly_login;

GRANT spacey_migrator TO spacey_migrator_login;
GRANT spacey_runtime TO spacey_runtime_login;
GRANT spacey_battle_worker TO spacey_battle_worker_login;
GRANT spacey_admin TO spacey_admin_login;
GRANT spacey_jobs TO spacey_jobs_login;
GRANT spacey_telegram_bot TO spacey_telegram_bot_login;
GRANT spacey_backup TO spacey_backup_login;
GRANT spacey_readonly TO spacey_readonly_login;

-- Full logical dumps must see rows protected by RLS, but never receive write or role-management rights.
ALTER ROLE spacey_backup_login NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS CONNECTION LIMIT 2;

ALTER ROLE spacey_migrator_login SET statement_timeout = '0';
ALTER ROLE spacey_runtime_login SET statement_timeout = '5s';
ALTER ROLE spacey_runtime_login SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE spacey_battle_worker_login SET statement_timeout = '5s';
ALTER ROLE spacey_battle_worker_login SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE spacey_admin_login SET statement_timeout = '15s';
ALTER ROLE spacey_admin_login SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE spacey_jobs_login SET statement_timeout = '30s';
ALTER ROLE spacey_jobs_login SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE spacey_telegram_bot_login SET statement_timeout = '5s';
ALTER ROLE spacey_telegram_bot_login SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE spacey_backup_login SET statement_timeout = '0';
ALTER ROLE spacey_backup_login SET default_transaction_read_only = on;
ALTER ROLE spacey_readonly_login SET statement_timeout = '10s';
ALTER ROLE spacey_readonly_login SET default_transaction_read_only = on;
SQL

unset PGPASSWORD SPACEY_MIGRATOR_PASSWORD SPACEY_RUNTIME_PASSWORD SPACEY_BATTLE_PASSWORD
unset SPACEY_ADMIN_PASSWORD SPACEY_JOBS_PASSWORD SPACEY_BOT_PASSWORD SPACEY_BACKUP_PASSWORD SPACEY_READONLY_PASSWORD

echo "SpaceY PostgreSQL group roles and credential logins are synchronized."
