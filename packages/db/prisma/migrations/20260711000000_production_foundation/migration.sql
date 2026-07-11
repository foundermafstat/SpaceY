-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "auth_session_status" AS ENUM ('ACTIVE', 'ROTATED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "content_release_status" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "build_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "inventory_item_state" AS ENUM ('AVAILABLE', 'INSTALLED', 'DAMAGED', 'DESTROYED', 'CONSUMED');

-- CreateEnum
CREATE TYPE "wallet_currency" AS ENUM ('CREDITS', 'SCRAP', 'ALLOY', 'DATA_SHARDS', 'STARS');

-- CreateEnum
CREATE TYPE "mission_attempt_type" AS ENUM ('PVE', 'PVP');

-- CreateEnum
CREATE TYPE "mission_attempt_status" AS ENUM ('CREATED', 'CONNECTING', 'ACTIVE', 'PAUSED', 'COMPLETED', 'FAILED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "mission_type" AS ENUM ('SALVAGE', 'ESCORT', 'MINING', 'INTERCEPT', 'DEFENSE');

-- CreateEnum
CREATE TYPE "mission_risk" AS ENUM ('GREEN', 'YELLOW', 'RED');

-- CreateEnum
CREATE TYPE "mission_outcome" AS ENUM ('VICTORY', 'DEFEAT', 'DRAW', 'FORFEIT', 'ERROR');

-- CreateEnum
CREATE TYPE "pvp_match_status" AS ENUM ('MATCHED', 'CONNECTING', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "api_client_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "webhook_status" AS ENUM ('ACTIVE', 'PAUSED', 'REVOKED');

-- CreateEnum
CREATE TYPE "webhook_delivery_status" AS ENUM ('PENDING', 'DELIVERING', 'DELIVERED', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "admin_user_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "outbox_status" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "job_status" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "stars_payment_event_type" AS ENUM ('PRE_CHECKOUT', 'PAID', 'REFUNDED', 'CHARGEBACK');

-- CreateEnum
CREATE TYPE "season_status" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "research_status" AS ENUM ('LOCKED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "battle_session_status" AS ENUM ('CREATED', 'ACTIVE', 'PAUSED', 'RECOVERING', 'ENDED', 'FAILED');

-- CreateEnum
CREATE TYPE "legacy_import_status" AS ENUM ('PENDING', 'IMPORTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "player_command_status" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "status" "user_status" NOT NULL DEFAULT 'ACTIVE',
    "display_name" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "time_zone" TEXT NOT NULL DEFAULT 'UTC',
    "avatar_url" TEXT,
    "profile_public" BOOLEAN NOT NULL DEFAULT false,
    "analytics_consent_at" TIMESTAMPTZ(6),
    "terms_accepted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_identities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "telegram_user_id" BIGINT NOT NULL,
    "username" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "language_code" TEXT,
    "is_premium" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "telegram_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_auth_replays" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "init_data_hash" TEXT NOT NULL,
    "telegram_user_id" BIGINT,
    "auth_date" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_auth_replays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_family" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "status" "auth_session_status" NOT NULL DEFAULT 'ACTIVE',
    "rotated_from_id" UUID,
    "replaced_by_id" UUID,
    "reuse_detected_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "last_used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "ip_hash" TEXT,
    "user_agent_hash" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_releases" (
    "id" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "status" "content_release_status" NOT NULL DEFAULT 'DRAFT',
    "config_hash" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "bootstrap_config" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT,
    "created_by_admin_id" UUID,
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "content_releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mission_definitions" (
    "id" UUID NOT NULL,
    "content_release_id" UUID NOT NULL,
    "drop_table_id" UUID,
    "key" TEXT NOT NULL,
    "type" "mission_type" NOT NULL,
    "risk" "mission_risk" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "objective" JSONB NOT NULL,
    "enemy_roster" JSONB NOT NULL,
    "reward_definition" JSONB NOT NULL,
    "duration_seconds" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mission_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ship_builds" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "build_status" NOT NULL DEFAULT 'ACTIVE',
    "current_revision_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ship_builds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ship_build_revisions" (
    "id" UUID NOT NULL,
    "build_id" UUID NOT NULL,
    "content_release_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "snapshot_hash" TEXT NOT NULL,
    "total_mass" INTEGER NOT NULL,
    "total_power" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ship_build_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "content_release_id" UUID NOT NULL,
    "definition_key" TEXT NOT NULL,
    "state" "inventory_item_state" NOT NULL DEFAULT 'AVAILABLE',
    "durability" INTEGER NOT NULL DEFAULT 10000,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "acquired_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "build_revision_items" (
    "id" UUID NOT NULL,
    "build_revision_id" UUID NOT NULL,
    "inventory_item_id" UUID NOT NULL,
    "slot_key" TEXT NOT NULL,
    "placement" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "build_revision_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_transitions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "inventory_item_id" UUID NOT NULL,
    "from_state" "inventory_item_state",
    "to_state" "inventory_item_state" NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_balances" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "currency" "wallet_currency" NOT NULL,
    "balance" BIGINT NOT NULL DEFAULT 0,
    "version" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "wallet_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_ledger_entries" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "wallet_balance_id" UUID NOT NULL,
    "currency" "wallet_currency" NOT NULL,
    "delta" BIGINT NOT NULL,
    "balance_after" BIGINT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pvp_matches" (
    "id" UUID NOT NULL,
    "content_release_id" UUID NOT NULL,
    "simulation_version" TEXT NOT NULL,
    "status" "pvp_match_status" NOT NULL DEFAULT 'MATCHED',
    "region" TEXT NOT NULL,
    "seed" BIGINT NOT NULL,
    "started_at" TIMESTAMPTZ(6),
    "ended_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pvp_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pvp_match_participants" (
    "id" UUID NOT NULL,
    "pvp_match_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "build_revision_id" UUID NOT NULL,
    "side" INTEGER NOT NULL,
    "mmr_before" INTEGER NOT NULL,
    "mmr_after" INTEGER,
    "outcome" "mission_outcome",
    "ws_ticket_hash" TEXT,
    "ws_ticket_expires_at" TIMESTAMPTZ(6),
    "disconnected_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pvp_match_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mission_attempts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "mission_definition_id" UUID NOT NULL,
    "content_release_id" UUID NOT NULL,
    "build_revision_id" UUID NOT NULL,
    "pvp_match_id" UUID,
    "type" "mission_attempt_type" NOT NULL,
    "status" "mission_attempt_status" NOT NULL DEFAULT 'CREATED',
    "seed" BIGINT NOT NULL,
    "simulation_version" TEXT NOT NULL,
    "ws_ticket_hash" TEXT,
    "ws_ticket_expires_at" TIMESTAMPTZ(6),
    "idempotency_key" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6),
    "disconnected_at" TIMESTAMPTZ(6),
    "reconnect_deadline" TIMESTAMPTZ(6),
    "ended_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mission_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mission_results" (
    "id" UUID NOT NULL,
    "mission_attempt_id" UUID NOT NULL,
    "outcome" "mission_outcome" NOT NULL,
    "final_tick" INTEGER NOT NULL,
    "state_hash" TEXT NOT NULL,
    "metrics" JSONB NOT NULL,
    "rewards" JSONB NOT NULL,
    "damage" JSONB NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "finished_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mission_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replay_metadata" (
    "id" UUID NOT NULL,
    "mission_attempt_id" UUID,
    "pvp_match_id" UUID,
    "storage_key" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "compression" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "tick_count" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "replay_metadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_clients" (
    "id" UUID NOT NULL,
    "owner_user_id" UUID,
    "client_id" TEXT NOT NULL,
    "client_secret_hash" TEXT,
    "name" TEXT NOT NULL,
    "status" "api_client_status" NOT NULL DEFAULT 'ACTIVE',
    "scopes" TEXT[],
    "rate_limit_per_minute" INTEGER NOT NULL DEFAULT 60,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "api_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
    "api_client_id" UUID NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scopes" TEXT[],
    "last_used_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_subscriptions" (
    "id" UUID NOT NULL,
    "api_client_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "event_types" TEXT[],
    "status" "webhook_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "webhook_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL,
    "webhook_subscription_id" UUID NOT NULL,
    "outbox_event_id" UUID,
    "event_id" UUID NOT NULL,
    "status" "webhook_delivery_status" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6),
    "response_status" INTEGER,
    "last_error" TEXT,
    "delivered_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "linked_user_id" UUID,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "status" "admin_user_status" NOT NULL DEFAULT 'ACTIVE',
    "totp_secret_encrypted" BYTEA,
    "recovery_code_hashes" TEXT[],
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_roles" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "permissions" TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "admin_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_user_roles" (
    "id" UUID NOT NULL,
    "admin_user_id" UUID NOT NULL,
    "admin_role_id" UUID NOT NULL,
    "granted_by_admin_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webauthn_credentials" (
    "id" UUID NOT NULL,
    "admin_user_id" UUID NOT NULL,
    "credential_id" BYTEA NOT NULL,
    "public_key" BYTEA NOT NULL,
    "sign_count" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[],
    "aaguid" TEXT,
    "backup_eligible" BOOLEAN NOT NULL DEFAULT false,
    "backup_state" BOOLEAN NOT NULL DEFAULT false,
    "last_used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webauthn_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_logs" (
    "id" UUID NOT NULL,
    "admin_user_id" UUID,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "before_state" JSONB,
    "after_state" JSONB,
    "reason" TEXT NOT NULL,
    "correlation_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "ip_hash" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "outbox_status" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMPTZ(6),
    "locked_by" TEXT,
    "published_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_idempotency_keys" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "job_name" TEXT NOT NULL,
    "status" "job_status" NOT NULL DEFAULT 'RUNNING',
    "payload_hash" TEXT NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "job_idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "module_definitions" (
    "id" UUID NOT NULL,
    "content_release_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "rarity" TEXT NOT NULL,
    "shape" JSONB NOT NULL,
    "stats" JSONB NOT NULL,
    "damage_states" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "module_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enemy_definitions" (
    "id" UUID NOT NULL,
    "content_release_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "archetype" TEXT NOT NULL,
    "stats" JSONB NOT NULL,
    "behavior" JSONB NOT NULL,
    "loadout" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "enemy_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drop_tables" (
    "id" UUID NOT NULL,
    "content_release_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "entries" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "drop_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "battle_sessions" (
    "id" UUID NOT NULL,
    "mission_attempt_id" UUID,
    "pvp_match_id" UUID,
    "content_release_id" UUID NOT NULL,
    "status" "battle_session_status" NOT NULL DEFAULT 'CREATED',
    "worker_id" TEXT,
    "simulation_version" TEXT NOT NULL,
    "last_tick" INTEGER NOT NULL DEFAULT 0,
    "last_input_sequence" BIGINT NOT NULL DEFAULT 0,
    "last_checkpoint_sequence" INTEGER NOT NULL DEFAULT 0,
    "checkpoint_interval_ticks" INTEGER NOT NULL DEFAULT 60,
    "state_hash" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "ended_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "battle_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "battle_checkpoints" (
    "id" UUID NOT NULL,
    "battle_session_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "tick" INTEGER NOT NULL,
    "input_sequence" BIGINT NOT NULL,
    "state_payload" BYTEA NOT NULL,
    "state_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "battle_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "input_journal" (
    "id" UUID NOT NULL,
    "battle_session_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "sequence" BIGINT NOT NULL,
    "client_sequence" BIGINT NOT NULL,
    "target_tick" INTEGER NOT NULL,
    "input_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "input_journal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legacy_build_imports" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "imported_build_id" UUID,
    "source_schema_version" INTEGER NOT NULL DEFAULT 3,
    "source_hash" TEXT NOT NULL,
    "source_snapshot" JSONB NOT NULL,
    "status" "legacy_import_status" NOT NULL DEFAULT 'PENDING',
    "idempotency_key" TEXT NOT NULL,
    "error_code" TEXT,
    "imported_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "legacy_build_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_command_idempotency" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" "player_command_status" NOT NULL DEFAULT 'RUNNING',
    "response" JSONB,
    "error_code" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "player_command_idempotency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_progression" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "experience" BIGINT NOT NULL DEFAULT 0,
    "reputation" BIGINT NOT NULL DEFAULT 0,
    "version" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "player_progression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_definitions" (
    "id" UUID NOT NULL,
    "content_release_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "cost" JSONB NOT NULL,
    "prerequisites" JSONB NOT NULL DEFAULT '[]',
    "effects" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "research_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_research" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "research_definition_id" UUID NOT NULL,
    "status" "research_status" NOT NULL DEFAULT 'LOCKED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_research_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievement_definitions" (
    "id" UUID NOT NULL,
    "content_release_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "rewards" JSONB NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "achievement_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_achievements" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "achievement_definition_id" UUID NOT NULL,
    "progress" BIGINT NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMPTZ(6),
    "claimed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seasons" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "status" "season_status" NOT NULL DEFAULT 'DRAFT',
    "rules" JSONB NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "season_participants" (
    "id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "rating" INTEGER NOT NULL DEFAULT 1000,
    "tier" TEXT NOT NULL DEFAULT 'unranked',
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "season_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stars_payment_events" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "telegram_update_id" BIGINT NOT NULL,
    "telegram_payment_charge_id" TEXT,
    "provider_payment_charge_id" TEXT,
    "invoice_payload" TEXT NOT NULL,
    "event_type" "stars_payment_event_type" NOT NULL,
    "total_amount" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XTR',
    "raw_event" JSONB NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "processed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stars_payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "users_status_created_at_id_idx" ON "users"("status", "created_at", "id");

-- CreateIndex
CREATE INDEX "users_created_at_id_idx" ON "users"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_identities_user_id_key" ON "telegram_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_identities_telegram_user_id_key" ON "telegram_identities"("telegram_user_id");

-- CreateIndex
CREATE INDEX "telegram_identities_created_at_id_idx" ON "telegram_identities"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_auth_replays_init_data_hash_key" ON "telegram_auth_replays"("init_data_hash");

-- CreateIndex
CREATE INDEX "telegram_auth_replays_user_id_idx" ON "telegram_auth_replays"("user_id");

-- CreateIndex
CREATE INDEX "telegram_auth_replays_expires_at_idx" ON "telegram_auth_replays"("expires_at");

-- CreateIndex
CREATE INDEX "telegram_auth_replays_created_at_id_idx" ON "telegram_auth_replays"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_refresh_token_hash_key" ON "auth_sessions"("refresh_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_replaced_by_id_key" ON "auth_sessions"("replaced_by_id");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");

-- CreateIndex
CREATE INDEX "auth_sessions_rotated_from_id_idx" ON "auth_sessions"("rotated_from_id");

-- CreateIndex
CREATE INDEX "auth_sessions_token_family_created_at_idx" ON "auth_sessions"("token_family", "created_at");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_status_expires_at_idx" ON "auth_sessions"("user_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "auth_sessions_created_at_id_idx" ON "auth_sessions"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "content_releases_version_key" ON "content_releases"("version");

-- CreateIndex
CREATE UNIQUE INDEX "content_releases_config_hash_key" ON "content_releases"("config_hash");

-- CreateIndex
CREATE INDEX "content_releases_created_by_admin_id_idx" ON "content_releases"("created_by_admin_id");

-- CreateIndex
CREATE INDEX "content_releases_status_published_at_idx" ON "content_releases"("status", "published_at");

-- CreateIndex
CREATE INDEX "content_releases_created_at_id_idx" ON "content_releases"("created_at", "id");

-- CreateIndex
CREATE INDEX "mission_definitions_content_release_id_idx" ON "mission_definitions"("content_release_id");

-- CreateIndex
CREATE INDEX "mission_definitions_drop_table_id_idx" ON "mission_definitions"("drop_table_id");

-- CreateIndex
CREATE INDEX "mission_definitions_type_risk_enabled_idx" ON "mission_definitions"("type", "risk", "enabled");

-- CreateIndex
CREATE INDEX "mission_definitions_enabled_key_idx" ON "mission_definitions"("enabled", "key");

-- CreateIndex
CREATE INDEX "mission_definitions_created_at_id_idx" ON "mission_definitions"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "mission_definitions_content_release_id_key_key" ON "mission_definitions"("content_release_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ship_builds_current_revision_id_key" ON "ship_builds"("current_revision_id");

-- CreateIndex
CREATE INDEX "ship_builds_user_id_idx" ON "ship_builds"("user_id");

-- CreateIndex
CREATE INDEX "ship_builds_status_updated_at_idx" ON "ship_builds"("status", "updated_at");

-- CreateIndex
CREATE INDEX "ship_builds_created_at_id_idx" ON "ship_builds"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ship_builds_user_id_name_key" ON "ship_builds"("user_id", "name");

-- CreateIndex
CREATE INDEX "ship_build_revisions_build_id_idx" ON "ship_build_revisions"("build_id");

-- CreateIndex
CREATE INDEX "ship_build_revisions_content_release_id_idx" ON "ship_build_revisions"("content_release_id");

-- CreateIndex
CREATE INDEX "ship_build_revisions_created_at_id_idx" ON "ship_build_revisions"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ship_build_revisions_build_id_version_key" ON "ship_build_revisions"("build_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ship_build_revisions_build_id_snapshot_hash_key" ON "ship_build_revisions"("build_id", "snapshot_hash");

-- CreateIndex
CREATE INDEX "inventory_items_user_id_idx" ON "inventory_items"("user_id");

-- CreateIndex
CREATE INDEX "inventory_items_content_release_id_idx" ON "inventory_items"("content_release_id");

-- CreateIndex
CREATE INDEX "inventory_items_user_id_state_created_at_id_idx" ON "inventory_items"("user_id", "state", "created_at", "id");

-- CreateIndex
CREATE INDEX "inventory_items_definition_key_state_idx" ON "inventory_items"("definition_key", "state");

-- CreateIndex
CREATE INDEX "inventory_items_created_at_id_idx" ON "inventory_items"("created_at", "id");

-- CreateIndex
CREATE INDEX "build_revision_items_build_revision_id_idx" ON "build_revision_items"("build_revision_id");

-- CreateIndex
CREATE INDEX "build_revision_items_inventory_item_id_idx" ON "build_revision_items"("inventory_item_id");

-- CreateIndex
CREATE INDEX "build_revision_items_created_at_id_idx" ON "build_revision_items"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "build_revision_items_build_revision_id_slot_key_key" ON "build_revision_items"("build_revision_id", "slot_key");

-- CreateIndex
CREATE UNIQUE INDEX "build_revision_items_build_revision_id_inventory_item_id_key" ON "build_revision_items"("build_revision_id", "inventory_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_transitions_idempotency_key_key" ON "inventory_transitions"("idempotency_key");

-- CreateIndex
CREATE INDEX "inventory_transitions_user_id_idx" ON "inventory_transitions"("user_id");

-- CreateIndex
CREATE INDEX "inventory_transitions_inventory_item_id_idx" ON "inventory_transitions"("inventory_item_id");

-- CreateIndex
CREATE INDEX "inventory_transitions_user_id_created_at_id_idx" ON "inventory_transitions"("user_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "inventory_transitions_source_type_source_id_idx" ON "inventory_transitions"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "wallet_balances_user_id_idx" ON "wallet_balances"("user_id");

-- CreateIndex
CREATE INDEX "wallet_balances_created_at_id_idx" ON "wallet_balances"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_balances_user_id_currency_key" ON "wallet_balances"("user_id", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_ledger_entries_idempotency_key_key" ON "wallet_ledger_entries"("idempotency_key");

-- CreateIndex
CREATE INDEX "wallet_ledger_entries_user_id_idx" ON "wallet_ledger_entries"("user_id");

-- CreateIndex
CREATE INDEX "wallet_ledger_entries_wallet_balance_id_idx" ON "wallet_ledger_entries"("wallet_balance_id");

-- CreateIndex
CREATE INDEX "wallet_ledger_entries_user_id_currency_created_at_id_idx" ON "wallet_ledger_entries"("user_id", "currency", "created_at", "id");

-- CreateIndex
CREATE INDEX "wallet_ledger_entries_source_type_source_id_idx" ON "wallet_ledger_entries"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "wallet_ledger_entries_created_at_id_idx" ON "wallet_ledger_entries"("created_at", "id");

-- CreateIndex
CREATE INDEX "pvp_matches_content_release_id_idx" ON "pvp_matches"("content_release_id");

-- CreateIndex
CREATE INDEX "pvp_matches_status_region_created_at_idx" ON "pvp_matches"("status", "region", "created_at");

-- CreateIndex
CREATE INDEX "pvp_matches_created_at_id_idx" ON "pvp_matches"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pvp_match_participants_ws_ticket_hash_key" ON "pvp_match_participants"("ws_ticket_hash");

-- CreateIndex
CREATE INDEX "pvp_match_participants_pvp_match_id_idx" ON "pvp_match_participants"("pvp_match_id");

-- CreateIndex
CREATE INDEX "pvp_match_participants_user_id_idx" ON "pvp_match_participants"("user_id");

-- CreateIndex
CREATE INDEX "pvp_match_participants_build_revision_id_idx" ON "pvp_match_participants"("build_revision_id");

-- CreateIndex
CREATE INDEX "pvp_match_participants_user_id_created_at_id_idx" ON "pvp_match_participants"("user_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "pvp_match_participants_created_at_id_idx" ON "pvp_match_participants"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pvp_match_participants_pvp_match_id_user_id_key" ON "pvp_match_participants"("pvp_match_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "pvp_match_participants_pvp_match_id_side_key" ON "pvp_match_participants"("pvp_match_id", "side");

-- CreateIndex
CREATE UNIQUE INDEX "mission_attempts_ws_ticket_hash_key" ON "mission_attempts"("ws_ticket_hash");

-- CreateIndex
CREATE UNIQUE INDEX "mission_attempts_idempotency_key_key" ON "mission_attempts"("idempotency_key");

-- CreateIndex
CREATE INDEX "mission_attempts_user_id_idx" ON "mission_attempts"("user_id");

-- CreateIndex
CREATE INDEX "mission_attempts_mission_definition_id_idx" ON "mission_attempts"("mission_definition_id");

-- CreateIndex
CREATE INDEX "mission_attempts_content_release_id_idx" ON "mission_attempts"("content_release_id");

-- CreateIndex
CREATE INDEX "mission_attempts_build_revision_id_idx" ON "mission_attempts"("build_revision_id");

-- CreateIndex
CREATE INDEX "mission_attempts_pvp_match_id_idx" ON "mission_attempts"("pvp_match_id");

-- CreateIndex
CREATE INDEX "mission_attempts_user_id_status_created_at_id_idx" ON "mission_attempts"("user_id", "status", "created_at", "id");

-- CreateIndex
CREATE INDEX "mission_attempts_status_reconnect_deadline_idx" ON "mission_attempts"("status", "reconnect_deadline");

-- CreateIndex
CREATE INDEX "mission_attempts_created_at_id_idx" ON "mission_attempts"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "mission_results_mission_attempt_id_key" ON "mission_results"("mission_attempt_id");

-- CreateIndex
CREATE UNIQUE INDEX "mission_results_idempotency_key_key" ON "mission_results"("idempotency_key");

-- CreateIndex
CREATE INDEX "mission_results_mission_attempt_id_idx" ON "mission_results"("mission_attempt_id");

-- CreateIndex
CREATE INDEX "mission_results_outcome_finished_at_idx" ON "mission_results"("outcome", "finished_at");

-- CreateIndex
CREATE INDEX "mission_results_created_at_id_idx" ON "mission_results"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "replay_metadata_mission_attempt_id_key" ON "replay_metadata"("mission_attempt_id");

-- CreateIndex
CREATE UNIQUE INDEX "replay_metadata_pvp_match_id_key" ON "replay_metadata"("pvp_match_id");

-- CreateIndex
CREATE UNIQUE INDEX "replay_metadata_storage_key_key" ON "replay_metadata"("storage_key");

-- CreateIndex
CREATE INDEX "replay_metadata_mission_attempt_id_idx" ON "replay_metadata"("mission_attempt_id");

-- CreateIndex
CREATE INDEX "replay_metadata_pvp_match_id_idx" ON "replay_metadata"("pvp_match_id");

-- CreateIndex
CREATE INDEX "replay_metadata_expires_at_idx" ON "replay_metadata"("expires_at");

-- CreateIndex
CREATE INDEX "replay_metadata_created_at_id_idx" ON "replay_metadata"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "api_clients_client_id_key" ON "api_clients"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_clients_client_secret_hash_key" ON "api_clients"("client_secret_hash");

-- CreateIndex
CREATE INDEX "api_clients_owner_user_id_idx" ON "api_clients"("owner_user_id");

-- CreateIndex
CREATE INDEX "api_clients_status_created_at_idx" ON "api_clients"("status", "created_at");

-- CreateIndex
CREATE INDEX "api_clients_created_at_id_idx" ON "api_clients"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_prefix_key" ON "api_keys"("key_prefix");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_secret_hash_key" ON "api_keys"("secret_hash");

-- CreateIndex
CREATE INDEX "api_keys_api_client_id_idx" ON "api_keys"("api_client_id");

-- CreateIndex
CREATE INDEX "api_keys_api_client_id_created_at_id_idx" ON "api_keys"("api_client_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "api_keys_expires_at_idx" ON "api_keys"("expires_at");

-- CreateIndex
CREATE INDEX "webhook_subscriptions_api_client_id_idx" ON "webhook_subscriptions"("api_client_id");

-- CreateIndex
CREATE INDEX "webhook_subscriptions_status_created_at_idx" ON "webhook_subscriptions"("status", "created_at");

-- CreateIndex
CREATE INDEX "webhook_subscriptions_created_at_id_idx" ON "webhook_subscriptions"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_subscriptions_api_client_id_url_key" ON "webhook_subscriptions"("api_client_id", "url");

-- CreateIndex
CREATE INDEX "webhook_deliveries_webhook_subscription_id_idx" ON "webhook_deliveries"("webhook_subscription_id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_outbox_event_id_idx" ON "webhook_deliveries"("outbox_event_id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_next_attempt_at_idx" ON "webhook_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "webhook_deliveries_created_at_id_idx" ON "webhook_deliveries"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_deliveries_webhook_subscription_id_event_id_key" ON "webhook_deliveries"("webhook_subscription_id", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_linked_user_id_key" ON "admin_users"("linked_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "admin_users_linked_user_id_idx" ON "admin_users"("linked_user_id");

-- CreateIndex
CREATE INDEX "admin_users_status_created_at_idx" ON "admin_users"("status", "created_at");

-- CreateIndex
CREATE INDEX "admin_users_created_at_id_idx" ON "admin_users"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_roles_key_key" ON "admin_roles"("key");

-- CreateIndex
CREATE INDEX "admin_roles_created_at_id_idx" ON "admin_roles"("created_at", "id");

-- CreateIndex
CREATE INDEX "admin_user_roles_admin_user_id_idx" ON "admin_user_roles"("admin_user_id");

-- CreateIndex
CREATE INDEX "admin_user_roles_admin_role_id_idx" ON "admin_user_roles"("admin_role_id");

-- CreateIndex
CREATE INDEX "admin_user_roles_granted_by_admin_user_id_idx" ON "admin_user_roles"("granted_by_admin_user_id");

-- CreateIndex
CREATE INDEX "admin_user_roles_created_at_id_idx" ON "admin_user_roles"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_user_roles_admin_user_id_admin_role_id_key" ON "admin_user_roles"("admin_user_id", "admin_role_id");

-- CreateIndex
CREATE UNIQUE INDEX "webauthn_credentials_credential_id_key" ON "webauthn_credentials"("credential_id");

-- CreateIndex
CREATE INDEX "webauthn_credentials_admin_user_id_idx" ON "webauthn_credentials"("admin_user_id");

-- CreateIndex
CREATE INDEX "webauthn_credentials_admin_user_id_created_at_id_idx" ON "webauthn_credentials"("admin_user_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_audit_logs_idempotency_key_key" ON "admin_audit_logs"("idempotency_key");

-- CreateIndex
CREATE INDEX "admin_audit_logs_admin_user_id_idx" ON "admin_audit_logs"("admin_user_id");

-- CreateIndex
CREATE INDEX "admin_audit_logs_resource_type_resource_id_created_at_idx" ON "admin_audit_logs"("resource_type", "resource_id", "created_at");

-- CreateIndex
CREATE INDEX "admin_audit_logs_correlation_id_idx" ON "admin_audit_logs"("correlation_id");

-- CreateIndex
CREATE INDEX "admin_audit_logs_created_at_id_idx" ON "admin_audit_logs"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_idempotency_key_key" ON "outbox_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "outbox_events_status_available_at_id_idx" ON "outbox_events"("status", "available_at", "id");

-- CreateIndex
CREATE INDEX "outbox_events_aggregate_type_aggregate_id_created_at_idx" ON "outbox_events"("aggregate_type", "aggregate_id", "created_at");

-- CreateIndex
CREATE INDEX "outbox_events_created_at_id_idx" ON "outbox_events"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "job_idempotency_keys_key_key" ON "job_idempotency_keys"("key");

-- CreateIndex
CREATE INDEX "job_idempotency_keys_queue_job_name_status_idx" ON "job_idempotency_keys"("queue", "job_name", "status");

-- CreateIndex
CREATE INDEX "job_idempotency_keys_expires_at_idx" ON "job_idempotency_keys"("expires_at");

-- CreateIndex
CREATE INDEX "job_idempotency_keys_created_at_id_idx" ON "job_idempotency_keys"("created_at", "id");

-- CreateIndex
CREATE INDEX "module_definitions_content_release_id_idx" ON "module_definitions"("content_release_id");

-- CreateIndex
CREATE INDEX "module_definitions_category_enabled_idx" ON "module_definitions"("category", "enabled");

-- CreateIndex
CREATE INDEX "module_definitions_created_at_id_idx" ON "module_definitions"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "module_definitions_content_release_id_key_key" ON "module_definitions"("content_release_id", "key");

-- CreateIndex
CREATE INDEX "enemy_definitions_content_release_id_idx" ON "enemy_definitions"("content_release_id");

-- CreateIndex
CREATE INDEX "enemy_definitions_archetype_enabled_idx" ON "enemy_definitions"("archetype", "enabled");

-- CreateIndex
CREATE INDEX "enemy_definitions_created_at_id_idx" ON "enemy_definitions"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "enemy_definitions_content_release_id_key_key" ON "enemy_definitions"("content_release_id", "key");

-- CreateIndex
CREATE INDEX "drop_tables_content_release_id_idx" ON "drop_tables"("content_release_id");

-- CreateIndex
CREATE INDEX "drop_tables_enabled_key_idx" ON "drop_tables"("enabled", "key");

-- CreateIndex
CREATE INDEX "drop_tables_created_at_id_idx" ON "drop_tables"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "drop_tables_content_release_id_key_key" ON "drop_tables"("content_release_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "battle_sessions_mission_attempt_id_key" ON "battle_sessions"("mission_attempt_id");

-- CreateIndex
CREATE UNIQUE INDEX "battle_sessions_pvp_match_id_key" ON "battle_sessions"("pvp_match_id");

-- CreateIndex
CREATE INDEX "battle_sessions_mission_attempt_id_idx" ON "battle_sessions"("mission_attempt_id");

-- CreateIndex
CREATE INDEX "battle_sessions_pvp_match_id_idx" ON "battle_sessions"("pvp_match_id");

-- CreateIndex
CREATE INDEX "battle_sessions_content_release_id_idx" ON "battle_sessions"("content_release_id");

-- CreateIndex
CREATE INDEX "battle_sessions_status_worker_id_updated_at_idx" ON "battle_sessions"("status", "worker_id", "updated_at");

-- CreateIndex
CREATE INDEX "battle_sessions_created_at_id_idx" ON "battle_sessions"("created_at", "id");

-- CreateIndex
CREATE INDEX "battle_checkpoints_battle_session_id_idx" ON "battle_checkpoints"("battle_session_id");

-- CreateIndex
CREATE INDEX "battle_checkpoints_expires_at_idx" ON "battle_checkpoints"("expires_at");

-- CreateIndex
CREATE INDEX "battle_checkpoints_created_at_id_idx" ON "battle_checkpoints"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "battle_checkpoints_battle_session_id_sequence_key" ON "battle_checkpoints"("battle_session_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "battle_checkpoints_battle_session_id_tick_key" ON "battle_checkpoints"("battle_session_id", "tick");

-- CreateIndex
CREATE UNIQUE INDEX "input_journal_idempotency_key_key" ON "input_journal"("idempotency_key");

-- CreateIndex
CREATE INDEX "input_journal_battle_session_id_idx" ON "input_journal"("battle_session_id");

-- CreateIndex
CREATE INDEX "input_journal_user_id_idx" ON "input_journal"("user_id");

-- CreateIndex
CREATE INDEX "input_journal_battle_session_id_target_tick_sequence_idx" ON "input_journal"("battle_session_id", "target_tick", "sequence");

-- CreateIndex
CREATE INDEX "input_journal_user_id_created_at_id_idx" ON "input_journal"("user_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "input_journal_created_at_id_idx" ON "input_journal"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "input_journal_battle_session_id_sequence_key" ON "input_journal"("battle_session_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "input_journal_battle_session_id_user_id_client_sequence_key" ON "input_journal"("battle_session_id", "user_id", "client_sequence");

-- CreateIndex
CREATE UNIQUE INDEX "legacy_build_imports_user_id_key" ON "legacy_build_imports"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "legacy_build_imports_imported_build_id_key" ON "legacy_build_imports"("imported_build_id");

-- CreateIndex
CREATE UNIQUE INDEX "legacy_build_imports_idempotency_key_key" ON "legacy_build_imports"("idempotency_key");

-- CreateIndex
CREATE INDEX "legacy_build_imports_imported_build_id_idx" ON "legacy_build_imports"("imported_build_id");

-- CreateIndex
CREATE INDEX "legacy_build_imports_status_created_at_idx" ON "legacy_build_imports"("status", "created_at");

-- CreateIndex
CREATE INDEX "legacy_build_imports_created_at_id_idx" ON "legacy_build_imports"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "legacy_build_imports_user_id_source_hash_key" ON "legacy_build_imports"("user_id", "source_hash");

-- CreateIndex
CREATE INDEX "player_command_idempotency_user_id_idx" ON "player_command_idempotency"("user_id");

-- CreateIndex
CREATE INDEX "player_command_idempotency_expires_at_idx" ON "player_command_idempotency"("expires_at");

-- CreateIndex
CREATE INDEX "player_command_idempotency_user_id_created_at_id_idx" ON "player_command_idempotency"("user_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "player_command_idempotency_created_at_id_idx" ON "player_command_idempotency"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "player_command_idempotency_user_id_scope_key_key" ON "player_command_idempotency"("user_id", "scope", "key");

-- CreateIndex
CREATE UNIQUE INDEX "player_progression_user_id_key" ON "player_progression"("user_id");

-- CreateIndex
CREATE INDEX "player_progression_created_at_id_idx" ON "player_progression"("created_at", "id");

-- CreateIndex
CREATE INDEX "research_definitions_content_release_id_idx" ON "research_definitions"("content_release_id");

-- CreateIndex
CREATE INDEX "research_definitions_created_at_id_idx" ON "research_definitions"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "research_definitions_content_release_id_key_key" ON "research_definitions"("content_release_id", "key");

-- CreateIndex
CREATE INDEX "user_research_user_id_idx" ON "user_research"("user_id");

-- CreateIndex
CREATE INDEX "user_research_research_definition_id_idx" ON "user_research"("research_definition_id");

-- CreateIndex
CREATE INDEX "user_research_user_id_status_created_at_id_idx" ON "user_research"("user_id", "status", "created_at", "id");

-- CreateIndex
CREATE INDEX "user_research_created_at_id_idx" ON "user_research"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "user_research_user_id_research_definition_id_key" ON "user_research"("user_id", "research_definition_id");

-- CreateIndex
CREATE INDEX "achievement_definitions_content_release_id_idx" ON "achievement_definitions"("content_release_id");

-- CreateIndex
CREATE INDEX "achievement_definitions_created_at_id_idx" ON "achievement_definitions"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "achievement_definitions_content_release_id_key_key" ON "achievement_definitions"("content_release_id", "key");

-- CreateIndex
CREATE INDEX "user_achievements_user_id_idx" ON "user_achievements"("user_id");

-- CreateIndex
CREATE INDEX "user_achievements_achievement_definition_id_idx" ON "user_achievements"("achievement_definition_id");

-- CreateIndex
CREATE INDEX "user_achievements_user_id_completed_at_created_at_id_idx" ON "user_achievements"("user_id", "completed_at", "created_at", "id");

-- CreateIndex
CREATE INDEX "user_achievements_created_at_id_idx" ON "user_achievements"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "user_achievements_user_id_achievement_definition_id_key" ON "user_achievements"("user_id", "achievement_definition_id");

-- CreateIndex
CREATE UNIQUE INDEX "seasons_key_key" ON "seasons"("key");

-- CreateIndex
CREATE INDEX "seasons_status_starts_at_ends_at_idx" ON "seasons"("status", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "seasons_created_at_id_idx" ON "seasons"("created_at", "id");

-- CreateIndex
CREATE INDEX "season_participants_season_id_idx" ON "season_participants"("season_id");

-- CreateIndex
CREATE INDEX "season_participants_user_id_idx" ON "season_participants"("user_id");

-- CreateIndex
CREATE INDEX "season_participants_season_id_rating_id_idx" ON "season_participants"("season_id", "rating", "id");

-- CreateIndex
CREATE INDEX "season_participants_user_id_created_at_id_idx" ON "season_participants"("user_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "season_participants_created_at_id_idx" ON "season_participants"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "season_participants_season_id_user_id_key" ON "season_participants"("season_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "stars_payment_events_telegram_update_id_key" ON "stars_payment_events"("telegram_update_id");

-- CreateIndex
CREATE UNIQUE INDEX "stars_payment_events_telegram_payment_charge_id_key" ON "stars_payment_events"("telegram_payment_charge_id");

-- CreateIndex
CREATE UNIQUE INDEX "stars_payment_events_provider_payment_charge_id_key" ON "stars_payment_events"("provider_payment_charge_id");

-- CreateIndex
CREATE UNIQUE INDEX "stars_payment_events_idempotency_key_key" ON "stars_payment_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "stars_payment_events_user_id_idx" ON "stars_payment_events"("user_id");

-- CreateIndex
CREATE INDEX "stars_payment_events_invoice_payload_created_at_idx" ON "stars_payment_events"("invoice_payload", "created_at");

-- CreateIndex
CREATE INDEX "stars_payment_events_event_type_created_at_idx" ON "stars_payment_events"("event_type", "created_at");

-- CreateIndex
CREATE INDEX "stars_payment_events_created_at_id_idx" ON "stars_payment_events"("created_at", "id");

-- AddForeignKey
ALTER TABLE "telegram_identities" ADD CONSTRAINT "telegram_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_auth_replays" ADD CONSTRAINT "telegram_auth_replays_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_rotated_from_id_fkey" FOREIGN KEY ("rotated_from_id") REFERENCES "auth_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_replaced_by_id_fkey" FOREIGN KEY ("replaced_by_id") REFERENCES "auth_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_releases" ADD CONSTRAINT "content_releases_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_definitions" ADD CONSTRAINT "mission_definitions_content_release_id_fkey" FOREIGN KEY ("content_release_id") REFERENCES "content_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_definitions" ADD CONSTRAINT "mission_definitions_drop_table_id_fkey" FOREIGN KEY ("drop_table_id") REFERENCES "drop_tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ship_builds" ADD CONSTRAINT "ship_builds_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ship_builds" ADD CONSTRAINT "ship_builds_current_revision_id_fkey" FOREIGN KEY ("current_revision_id") REFERENCES "ship_build_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ship_build_revisions" ADD CONSTRAINT "ship_build_revisions_build_id_fkey" FOREIGN KEY ("build_id") REFERENCES "ship_builds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ship_build_revisions" ADD CONSTRAINT "ship_build_revisions_content_release_id_fkey" FOREIGN KEY ("content_release_id") REFERENCES "content_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_content_release_id_fkey" FOREIGN KEY ("content_release_id") REFERENCES "content_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "build_revision_items" ADD CONSTRAINT "build_revision_items_build_revision_id_fkey" FOREIGN KEY ("build_revision_id") REFERENCES "ship_build_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "build_revision_items" ADD CONSTRAINT "build_revision_items_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transitions" ADD CONSTRAINT "inventory_transitions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transitions" ADD CONSTRAINT "inventory_transitions_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_balances" ADD CONSTRAINT "wallet_balances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_ledger_entries" ADD CONSTRAINT "wallet_ledger_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_ledger_entries" ADD CONSTRAINT "wallet_ledger_entries_wallet_balance_id_fkey" FOREIGN KEY ("wallet_balance_id") REFERENCES "wallet_balances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pvp_matches" ADD CONSTRAINT "pvp_matches_content_release_id_fkey" FOREIGN KEY ("content_release_id") REFERENCES "content_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pvp_match_participants" ADD CONSTRAINT "pvp_match_participants_pvp_match_id_fkey" FOREIGN KEY ("pvp_match_id") REFERENCES "pvp_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pvp_match_participants" ADD CONSTRAINT "pvp_match_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pvp_match_participants" ADD CONSTRAINT "pvp_match_participants_build_revision_id_fkey" FOREIGN KEY ("build_revision_id") REFERENCES "ship_build_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_attempts" ADD CONSTRAINT "mission_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_attempts" ADD CONSTRAINT "mission_attempts_mission_definition_id_fkey" FOREIGN KEY ("mission_definition_id") REFERENCES "mission_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_attempts" ADD CONSTRAINT "mission_attempts_content_release_id_fkey" FOREIGN KEY ("content_release_id") REFERENCES "content_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_attempts" ADD CONSTRAINT "mission_attempts_build_revision_id_fkey" FOREIGN KEY ("build_revision_id") REFERENCES "ship_build_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_attempts" ADD CONSTRAINT "mission_attempts_pvp_match_id_fkey" FOREIGN KEY ("pvp_match_id") REFERENCES "pvp_matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_results" ADD CONSTRAINT "mission_results_mission_attempt_id_fkey" FOREIGN KEY ("mission_attempt_id") REFERENCES "mission_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replay_metadata" ADD CONSTRAINT "replay_metadata_mission_attempt_id_fkey" FOREIGN KEY ("mission_attempt_id") REFERENCES "mission_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replay_metadata" ADD CONSTRAINT "replay_metadata_pvp_match_id_fkey" FOREIGN KEY ("pvp_match_id") REFERENCES "pvp_matches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_clients" ADD CONSTRAINT "api_clients_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_api_client_id_fkey" FOREIGN KEY ("api_client_id") REFERENCES "api_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_api_client_id_fkey" FOREIGN KEY ("api_client_id") REFERENCES "api_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_subscription_id_fkey" FOREIGN KEY ("webhook_subscription_id") REFERENCES "webhook_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_outbox_event_id_fkey" FOREIGN KEY ("outbox_event_id") REFERENCES "outbox_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_linked_user_id_fkey" FOREIGN KEY ("linked_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_user_roles" ADD CONSTRAINT "admin_user_roles_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_user_roles" ADD CONSTRAINT "admin_user_roles_admin_role_id_fkey" FOREIGN KEY ("admin_role_id") REFERENCES "admin_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_user_roles" ADD CONSTRAINT "admin_user_roles_granted_by_admin_user_id_fkey" FOREIGN KEY ("granted_by_admin_user_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module_definitions" ADD CONSTRAINT "module_definitions_content_release_id_fkey" FOREIGN KEY ("content_release_id") REFERENCES "content_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enemy_definitions" ADD CONSTRAINT "enemy_definitions_content_release_id_fkey" FOREIGN KEY ("content_release_id") REFERENCES "content_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drop_tables" ADD CONSTRAINT "drop_tables_content_release_id_fkey" FOREIGN KEY ("content_release_id") REFERENCES "content_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_sessions" ADD CONSTRAINT "battle_sessions_mission_attempt_id_fkey" FOREIGN KEY ("mission_attempt_id") REFERENCES "mission_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_sessions" ADD CONSTRAINT "battle_sessions_pvp_match_id_fkey" FOREIGN KEY ("pvp_match_id") REFERENCES "pvp_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_sessions" ADD CONSTRAINT "battle_sessions_content_release_id_fkey" FOREIGN KEY ("content_release_id") REFERENCES "content_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_checkpoints" ADD CONSTRAINT "battle_checkpoints_battle_session_id_fkey" FOREIGN KEY ("battle_session_id") REFERENCES "battle_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "input_journal" ADD CONSTRAINT "input_journal_battle_session_id_fkey" FOREIGN KEY ("battle_session_id") REFERENCES "battle_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "input_journal" ADD CONSTRAINT "input_journal_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legacy_build_imports" ADD CONSTRAINT "legacy_build_imports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legacy_build_imports" ADD CONSTRAINT "legacy_build_imports_imported_build_id_fkey" FOREIGN KEY ("imported_build_id") REFERENCES "ship_builds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_command_idempotency" ADD CONSTRAINT "player_command_idempotency_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_progression" ADD CONSTRAINT "player_progression_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_definitions" ADD CONSTRAINT "research_definitions_content_release_id_fkey" FOREIGN KEY ("content_release_id") REFERENCES "content_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_research" ADD CONSTRAINT "user_research_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_research" ADD CONSTRAINT "user_research_research_definition_id_fkey" FOREIGN KEY ("research_definition_id") REFERENCES "research_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievement_definitions" ADD CONSTRAINT "achievement_definitions_content_release_id_fkey" FOREIGN KEY ("content_release_id") REFERENCES "content_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_achievement_definition_id_fkey" FOREIGN KEY ("achievement_definition_id") REFERENCES "achievement_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_participants" ADD CONSTRAINT "season_participants_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_participants" ADD CONSTRAINT "season_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stars_payment_events" ADD CONSTRAINT "stars_payment_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Production invariants not expressible in the Prisma schema.
ALTER TABLE "auth_sessions"
    ADD CONSTRAINT "auth_sessions_expiry_check" CHECK ("expires_at" > "created_at"),
    ADD CONSTRAINT "auth_sessions_rotation_check" CHECK (
        ("rotated_from_id" IS NULL OR "rotated_from_id" <> "id")
        AND ("replaced_by_id" IS NULL OR "replaced_by_id" <> "id")
    );

ALTER TABLE "content_releases"
    ADD CONSTRAINT "content_releases_schema_version_check" CHECK ("schema_version" > 0);

ALTER TABLE "mission_definitions"
    ADD CONSTRAINT "mission_definitions_duration_check" CHECK ("duration_seconds" > 0);

ALTER TABLE "ship_build_revisions"
    ADD CONSTRAINT "ship_build_revisions_version_check" CHECK ("version" > 0),
    ADD CONSTRAINT "ship_build_revisions_schema_version_check" CHECK ("schema_version" > 0),
    ADD CONSTRAINT "ship_build_revisions_totals_check" CHECK ("total_mass" >= 0 AND "total_power" >= 0);

ALTER TABLE "inventory_items"
    ADD CONSTRAINT "inventory_items_durability_check" CHECK ("durability" BETWEEN 0 AND 10000);

ALTER TABLE "wallet_balances"
    ADD CONSTRAINT "wallet_balances_balance_check" CHECK ("balance" >= 0),
    ADD CONSTRAINT "wallet_balances_version_check" CHECK ("version" >= 0);

ALTER TABLE "wallet_ledger_entries"
    ADD CONSTRAINT "wallet_ledger_entries_delta_check" CHECK ("delta" <> 0),
    ADD CONSTRAINT "wallet_ledger_entries_balance_check" CHECK ("balance_after" >= 0);

ALTER TABLE "pvp_matches"
    ADD CONSTRAINT "pvp_matches_time_check" CHECK (
        "ended_at" IS NULL OR "started_at" IS NULL OR "ended_at" >= "started_at"
    );

ALTER TABLE "pvp_match_participants"
    ADD CONSTRAINT "pvp_match_participants_side_check" CHECK ("side" BETWEEN 0 AND 1),
    ADD CONSTRAINT "pvp_match_participants_ticket_expiry_check" CHECK (
        "ws_ticket_hash" IS NULL OR "ws_ticket_expires_at" IS NOT NULL
    );

ALTER TABLE "mission_attempts"
    ADD CONSTRAINT "mission_attempts_type_match_check" CHECK (
        ("type" = 'PVE' AND "pvp_match_id" IS NULL)
        OR ("type" = 'PVP' AND "pvp_match_id" IS NOT NULL)
    ),
    ADD CONSTRAINT "mission_attempts_ticket_expiry_check" CHECK (
        "ws_ticket_hash" IS NULL OR "ws_ticket_expires_at" IS NOT NULL
    ),
    ADD CONSTRAINT "mission_attempts_time_check" CHECK (
        ("ended_at" IS NULL OR "started_at" IS NULL OR "ended_at" >= "started_at")
        AND ("reconnect_deadline" IS NULL OR "disconnected_at" IS NULL OR "reconnect_deadline" >= "disconnected_at")
    );

ALTER TABLE "mission_results"
    ADD CONSTRAINT "mission_results_final_tick_check" CHECK ("final_tick" >= 0);

ALTER TABLE "replay_metadata"
    ADD CONSTRAINT "replay_metadata_parent_check" CHECK (
        (("mission_attempt_id" IS NOT NULL)::integer + ("pvp_match_id" IS NOT NULL)::integer) = 1
    ),
    ADD CONSTRAINT "replay_metadata_size_check" CHECK ("size_bytes" >= 0 AND "tick_count" >= 0),
    ADD CONSTRAINT "replay_metadata_expiry_check" CHECK ("expires_at" > "created_at");

ALTER TABLE "api_clients"
    ADD CONSTRAINT "api_clients_rate_limit_check" CHECK ("rate_limit_per_minute" > 0);

ALTER TABLE "api_keys"
    ADD CONSTRAINT "api_keys_expiry_check" CHECK ("expires_at" IS NULL OR "expires_at" > "created_at");

ALTER TABLE "webhook_deliveries"
    ADD CONSTRAINT "webhook_deliveries_attempt_count_check" CHECK ("attempt_count" >= 0),
    ADD CONSTRAINT "webhook_deliveries_response_status_check" CHECK (
        "response_status" IS NULL OR "response_status" BETWEEN 100 AND 599
    );

ALTER TABLE "admin_audit_logs"
    ADD CONSTRAINT "admin_audit_logs_reason_check" CHECK (length(btrim("reason")) > 0);

ALTER TABLE "outbox_events"
    ADD CONSTRAINT "outbox_events_attempt_count_check" CHECK ("attempt_count" >= 0);

ALTER TABLE "job_idempotency_keys"
    ADD CONSTRAINT "job_idempotency_keys_expiry_check" CHECK ("expires_at" > "created_at");

ALTER TABLE "player_progression"
    ADD CONSTRAINT "player_progression_values_check" CHECK (
        "level" >= 1 AND "experience" >= 0 AND "reputation" >= 0 AND "version" >= 0
    );

ALTER TABLE "user_research"
    ADD CONSTRAINT "user_research_progress_check" CHECK ("progress" BETWEEN 0 AND 10000),
    ADD CONSTRAINT "user_research_time_check" CHECK (
        "completed_at" IS NULL OR "started_at" IS NULL OR "completed_at" >= "started_at"
    );

ALTER TABLE "user_achievements"
    ADD CONSTRAINT "user_achievements_progress_check" CHECK ("progress" >= 0),
    ADD CONSTRAINT "user_achievements_claim_check" CHECK (
        "claimed_at" IS NULL OR ("completed_at" IS NOT NULL AND "claimed_at" >= "completed_at")
    );

ALTER TABLE "seasons"
    ADD CONSTRAINT "seasons_time_check" CHECK ("ends_at" > "starts_at");

ALTER TABLE "season_participants"
    ADD CONSTRAINT "season_participants_values_check" CHECK (
        "rating" >= 0 AND "wins" >= 0 AND "losses" >= 0 AND "draws" >= 0
    );

ALTER TABLE "stars_payment_events"
    ADD CONSTRAINT "stars_payment_events_amount_check" CHECK ("total_amount" > 0),
    ADD CONSTRAINT "stars_payment_events_currency_check" CHECK ("currency" = 'XTR');

-- Cross-column ownership/version integrity for duplicated hot-path keys.
CREATE UNIQUE INDEX "inventory_items_id_user_id_key" ON "inventory_items"("id", "user_id");
ALTER TABLE "inventory_transitions"
    ADD CONSTRAINT "inventory_transitions_item_owner_fkey"
    FOREIGN KEY ("inventory_item_id", "user_id")
    REFERENCES "inventory_items"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "wallet_balances_id_user_id_currency_key"
    ON "wallet_balances"("id", "user_id", "currency");
ALTER TABLE "wallet_ledger_entries"
    ADD CONSTRAINT "wallet_ledger_entries_balance_owner_currency_fkey"
    FOREIGN KEY ("wallet_balance_id", "user_id", "currency")
    REFERENCES "wallet_balances"("id", "user_id", "currency") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "mission_definitions_id_release_key"
    ON "mission_definitions"("id", "content_release_id");
ALTER TABLE "mission_attempts"
    ADD CONSTRAINT "mission_attempts_definition_release_fkey"
    FOREIGN KEY ("mission_definition_id", "content_release_id")
    REFERENCES "mission_definitions"("id", "content_release_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Small indexes for the high-frequency queues and active session paths.
CREATE UNIQUE INDEX "content_releases_one_published_idx"
    ON "content_releases" ((true)) WHERE "status" = 'PUBLISHED';
CREATE UNIQUE INDEX "auth_sessions_one_active_family_idx"
    ON "auth_sessions"("token_family") WHERE "status" = 'ACTIVE' AND "revoked_at" IS NULL;
CREATE INDEX "auth_sessions_active_user_idx"
    ON "auth_sessions"("user_id", "expires_at") WHERE "status" = 'ACTIVE' AND "revoked_at" IS NULL;
CREATE INDEX "outbox_events_ready_idx"
    ON "outbox_events"("available_at", "id") WHERE "status" IN ('PENDING', 'FAILED');
CREATE INDEX "webhook_deliveries_ready_idx"
    ON "webhook_deliveries"("next_attempt_at", "id") WHERE "status" IN ('PENDING', 'FAILED');
CREATE INDEX "job_idempotency_keys_expired_idx"
    ON "job_idempotency_keys"("expires_at", "id") WHERE "status" <> 'RUNNING';

-- Ledger, transition, payment and audit histories are append-only.
CREATE FUNCTION "spacey_reject_history_mutation"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;
REVOKE ALL ON FUNCTION "spacey_reject_history_mutation"() FROM PUBLIC;

CREATE TRIGGER "wallet_ledger_entries_append_only"
    BEFORE UPDATE OR DELETE ON "wallet_ledger_entries"
    FOR EACH ROW EXECUTE FUNCTION "spacey_reject_history_mutation"();
CREATE TRIGGER "inventory_transitions_append_only"
    BEFORE UPDATE OR DELETE ON "inventory_transitions"
    FOR EACH ROW EXECUTE FUNCTION "spacey_reject_history_mutation"();
CREATE TRIGGER "admin_audit_logs_append_only"
    BEFORE UPDATE OR DELETE ON "admin_audit_logs"
    FOR EACH ROW EXECUTE FUNCTION "spacey_reject_history_mutation"();
CREATE TRIGGER "stars_payment_events_append_only"
    BEFORE UPDATE OR DELETE ON "stars_payment_events"
    FOR EACH ROW EXECUTE FUNCTION "spacey_reject_history_mutation"();
CREATE TRIGGER "mission_results_append_only"
    BEFORE UPDATE OR DELETE ON "mission_results"
    FOR EACH ROW EXECUTE FUNCTION "spacey_reject_history_mutation"();
CREATE TRIGGER "ship_build_revisions_immutable"
    BEFORE UPDATE ON "ship_build_revisions"
    FOR EACH ROW EXECUTE FUNCTION "spacey_reject_history_mutation"();
CREATE TRIGGER "build_revision_items_immutable"
    BEFORE UPDATE ON "build_revision_items"
    FOR EACH ROW EXECUTE FUNCTION "spacey_reject_history_mutation"();

-- Request handlers set this with SET LOCAL spacey.user_id = '<uuid>' inside a transaction.
CREATE FUNCTION "spacey_current_user_id"()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
    SELECT NULLIF(current_setting('spacey.user_id', true), '')::uuid
$$;
REVOKE ALL ON FUNCTION "spacey_current_user_id"() FROM PUBLIC;

-- Directly-owned player tables.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
CREATE POLICY "users_owner" ON "users" FOR ALL
    USING ("id" = (SELECT "spacey_current_user_id"()))
    WITH CHECK ("id" = (SELECT "spacey_current_user_id"()));

ALTER TABLE "ship_builds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ship_builds" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ship_builds_owner" ON "ship_builds" FOR ALL
    USING ("user_id" = (SELECT "spacey_current_user_id"()))
    WITH CHECK ("user_id" = (SELECT "spacey_current_user_id"()));

ALTER TABLE "inventory_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY "inventory_items_owner" ON "inventory_items" FOR ALL
    USING ("user_id" = (SELECT "spacey_current_user_id"()))
    WITH CHECK ("user_id" = (SELECT "spacey_current_user_id"()));

ALTER TABLE "inventory_transitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_transitions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "inventory_transitions_owner" ON "inventory_transitions" FOR ALL
    USING ("user_id" = (SELECT "spacey_current_user_id"()))
    WITH CHECK ("user_id" = (SELECT "spacey_current_user_id"()));

ALTER TABLE "wallet_balances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "wallet_balances" FORCE ROW LEVEL SECURITY;
CREATE POLICY "wallet_balances_owner" ON "wallet_balances" FOR ALL
    USING ("user_id" = (SELECT "spacey_current_user_id"()))
    WITH CHECK ("user_id" = (SELECT "spacey_current_user_id"()));

ALTER TABLE "wallet_ledger_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "wallet_ledger_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY "wallet_ledger_entries_owner" ON "wallet_ledger_entries" FOR ALL
    USING ("user_id" = (SELECT "spacey_current_user_id"()))
    WITH CHECK ("user_id" = (SELECT "spacey_current_user_id"()));

ALTER TABLE "mission_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mission_attempts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "mission_attempts_owner" ON "mission_attempts" FOR ALL
    USING ("user_id" = (SELECT "spacey_current_user_id"()))
    WITH CHECK ("user_id" = (SELECT "spacey_current_user_id"()));

ALTER TABLE "pvp_match_participants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pvp_match_participants" FORCE ROW LEVEL SECURITY;
CREATE POLICY "pvp_match_participants_owner" ON "pvp_match_participants" FOR ALL
    USING ("user_id" = (SELECT "spacey_current_user_id"()))
    WITH CHECK ("user_id" = (SELECT "spacey_current_user_id"()));

ALTER TABLE "player_progression" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "player_progression" FORCE ROW LEVEL SECURITY;
CREATE POLICY "player_progression_owner" ON "player_progression" FOR ALL
    USING ("user_id" = (SELECT "spacey_current_user_id"()))
    WITH CHECK ("user_id" = (SELECT "spacey_current_user_id"()));

ALTER TABLE "user_research" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_research" FORCE ROW LEVEL SECURITY;
CREATE POLICY "user_research_owner" ON "user_research" FOR ALL
    USING ("user_id" = (SELECT "spacey_current_user_id"()))
    WITH CHECK ("user_id" = (SELECT "spacey_current_user_id"()));

ALTER TABLE "user_achievements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_achievements" FORCE ROW LEVEL SECURITY;
CREATE POLICY "user_achievements_owner" ON "user_achievements" FOR ALL
    USING ("user_id" = (SELECT "spacey_current_user_id"()))
    WITH CHECK ("user_id" = (SELECT "spacey_current_user_id"()));

ALTER TABLE "season_participants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "season_participants" FORCE ROW LEVEL SECURITY;
CREATE POLICY "season_participants_owner" ON "season_participants" FOR ALL
    USING ("user_id" = (SELECT "spacey_current_user_id"()))
    WITH CHECK ("user_id" = (SELECT "spacey_current_user_id"()));

-- Child resources inherit ownership through indexed parent keys.
ALTER TABLE "ship_build_revisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ship_build_revisions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ship_build_revisions_owner" ON "ship_build_revisions" FOR ALL
    USING (EXISTS (
        SELECT 1 FROM "ship_builds" b
        WHERE b."id" = "ship_build_revisions"."build_id"
          AND b."user_id" = (SELECT "spacey_current_user_id"())
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM "ship_builds" b
        WHERE b."id" = "ship_build_revisions"."build_id"
          AND b."user_id" = (SELECT "spacey_current_user_id"())
    ));

ALTER TABLE "build_revision_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "build_revision_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY "build_revision_items_owner" ON "build_revision_items" FOR ALL
    USING (EXISTS (
        SELECT 1 FROM "ship_build_revisions" r
        JOIN "ship_builds" b ON b."id" = r."build_id"
        WHERE r."id" = "build_revision_items"."build_revision_id"
          AND b."user_id" = (SELECT "spacey_current_user_id"())
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM "ship_build_revisions" r
        JOIN "ship_builds" b ON b."id" = r."build_id"
        WHERE r."id" = "build_revision_items"."build_revision_id"
          AND b."user_id" = (SELECT "spacey_current_user_id"())
    ));

ALTER TABLE "mission_results" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mission_results" FORCE ROW LEVEL SECURITY;
CREATE POLICY "mission_results_owner" ON "mission_results" FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM "mission_attempts" a
        WHERE a."id" = "mission_results"."mission_attempt_id"
          AND a."user_id" = (SELECT "spacey_current_user_id"())
    ));
CREATE POLICY "mission_results_owner_insert" ON "mission_results" FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM "mission_attempts" a
        WHERE a."id" = "mission_results"."mission_attempt_id"
          AND a."user_id" = (SELECT "spacey_current_user_id"())
    ));

ALTER TABLE "replay_metadata" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "replay_metadata" FORCE ROW LEVEL SECURITY;
CREATE POLICY "replay_metadata_owner" ON "replay_metadata" FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM "mission_attempts" a
            WHERE a."id" = "replay_metadata"."mission_attempt_id"
              AND a."user_id" = (SELECT "spacey_current_user_id"())
        )
        OR EXISTS (
            SELECT 1 FROM "pvp_match_participants" p
            WHERE p."pvp_match_id" = "replay_metadata"."pvp_match_id"
              AND p."user_id" = (SELECT "spacey_current_user_id"())
        )
    );
CREATE POLICY "replay_metadata_owner_insert" ON "replay_metadata" FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM "mission_attempts" a
            WHERE a."id" = "replay_metadata"."mission_attempt_id"
              AND a."user_id" = (SELECT "spacey_current_user_id"())
        )
        OR EXISTS (
            SELECT 1 FROM "pvp_match_participants" p
            WHERE p."pvp_match_id" = "replay_metadata"."pvp_match_id"
              AND p."user_id" = (SELECT "spacey_current_user_id"())
        )
    );

-- Versioned combat content and recoverable battle runtime invariants.
ALTER TABLE "module_definitions"
    ADD CONSTRAINT "module_definitions_labels_check" CHECK (
        length(btrim("category")) > 0
        AND length(btrim("kind")) > 0
        AND length(btrim("rarity")) > 0
    );

ALTER TABLE "battle_sessions"
    ADD CONSTRAINT "battle_sessions_parent_check" CHECK (
        (("mission_attempt_id" IS NOT NULL)::integer + ("pvp_match_id" IS NOT NULL)::integer) = 1
    ),
    ADD CONSTRAINT "battle_sessions_counters_check" CHECK (
        "last_tick" >= 0
        AND "last_input_sequence" >= 0
        AND "last_checkpoint_sequence" >= 0
        AND "checkpoint_interval_ticks" = 60
    ),
    ADD CONSTRAINT "battle_sessions_time_check" CHECK (
        "ended_at" IS NULL OR "started_at" IS NULL OR "ended_at" >= "started_at"
    );

ALTER TABLE "battle_checkpoints"
    ADD CONSTRAINT "battle_checkpoints_counters_check" CHECK (
        "sequence" >= 0 AND "tick" >= 0 AND "input_sequence" >= 0
    ),
    ADD CONSTRAINT "battle_checkpoints_expiry_check" CHECK ("expires_at" > "created_at");

ALTER TABLE "input_journal"
    ADD CONSTRAINT "input_journal_counters_check" CHECK (
        "sequence" >= 0 AND "client_sequence" >= 0 AND "target_tick" >= 0
    );

ALTER TABLE "legacy_build_imports"
    ADD CONSTRAINT "legacy_build_imports_schema_check" CHECK ("source_schema_version" = 3),
    ADD CONSTRAINT "legacy_build_imports_status_check" CHECK (
        ("status" = 'PENDING' AND "imported_build_id" IS NULL AND "imported_at" IS NULL)
        OR ("status" = 'IMPORTED' AND "imported_build_id" IS NOT NULL AND "imported_at" IS NOT NULL AND "error_code" IS NULL)
        OR ("status" = 'REJECTED' AND "imported_build_id" IS NULL AND "error_code" IS NOT NULL)
    );

ALTER TABLE "player_command_idempotency"
    ADD CONSTRAINT "player_command_idempotency_expiry_check" CHECK ("expires_at" > "created_at"),
    ADD CONSTRAINT "player_command_idempotency_result_check" CHECK (
        ("status" = 'RUNNING' AND "response" IS NULL AND "error_code" IS NULL)
        OR ("status" = 'SUCCEEDED' AND "response" IS NOT NULL AND "error_code" IS NULL)
        OR ("status" = 'FAILED' AND "error_code" IS NOT NULL)
    );

CREATE UNIQUE INDEX "drop_tables_id_release_key" ON "drop_tables"("id", "content_release_id");
ALTER TABLE "mission_definitions"
    ADD CONSTRAINT "mission_definitions_drop_table_release_fkey"
    FOREIGN KEY ("drop_table_id", "content_release_id")
    REFERENCES "drop_tables"("id", "content_release_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "mission_attempts_id_release_key"
    ON "mission_attempts"("id", "content_release_id");
CREATE UNIQUE INDEX "pvp_matches_id_release_key"
    ON "pvp_matches"("id", "content_release_id");
ALTER TABLE "battle_sessions"
    ADD CONSTRAINT "battle_sessions_attempt_release_fkey"
    FOREIGN KEY ("mission_attempt_id", "content_release_id")
    REFERENCES "mission_attempts"("id", "content_release_id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "battle_sessions_match_release_fkey"
    FOREIGN KEY ("pvp_match_id", "content_release_id")
    REFERENCES "pvp_matches"("id", "content_release_id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ship_builds_id_user_id_key" ON "ship_builds"("id", "user_id");
ALTER TABLE "legacy_build_imports"
    ADD CONSTRAINT "legacy_build_imports_build_owner_fkey"
    FOREIGN KEY ("imported_build_id", "user_id")
    REFERENCES "ship_builds"("id", "user_id") ON DELETE SET NULL ("imported_build_id") ON UPDATE CASCADE;

CREATE FUNCTION "spacey_validate_input_journal_owner"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.battle_sessions s
        LEFT JOIN public.mission_attempts a ON a.id = s.mission_attempt_id
        LEFT JOIN public.pvp_match_participants p ON p.pvp_match_id = s.pvp_match_id
        WHERE s.id = NEW.battle_session_id
          AND (a.user_id = NEW.user_id OR p.user_id = NEW.user_id)
    ) THEN
        RAISE EXCEPTION 'input user does not own or participate in battle session'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "spacey_validate_input_journal_owner"() FROM PUBLIC;

CREATE TRIGGER "input_journal_owner_guard"
    BEFORE INSERT ON "input_journal"
    FOR EACH ROW EXECUTE FUNCTION "spacey_validate_input_journal_owner"();
CREATE TRIGGER "input_journal_immutable"
    BEFORE UPDATE ON "input_journal"
    FOR EACH ROW EXECUTE FUNCTION "spacey_reject_history_mutation"();
CREATE TRIGGER "battle_checkpoints_immutable"
    BEFORE UPDATE ON "battle_checkpoints"
    FOR EACH ROW EXECUTE FUNCTION "spacey_reject_history_mutation"();

ALTER TABLE "battle_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "battle_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "battle_sessions_owner" ON "battle_sessions" FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM "mission_attempts" a
            WHERE a."id" = "battle_sessions"."mission_attempt_id"
              AND a."user_id" = (SELECT "spacey_current_user_id"())
        )
        OR EXISTS (
            SELECT 1 FROM "pvp_match_participants" p
            WHERE p."pvp_match_id" = "battle_sessions"."pvp_match_id"
              AND p."user_id" = (SELECT "spacey_current_user_id"())
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM "mission_attempts" a
            WHERE a."id" = "battle_sessions"."mission_attempt_id"
              AND a."user_id" = (SELECT "spacey_current_user_id"())
        )
        OR EXISTS (
            SELECT 1 FROM "pvp_match_participants" p
            WHERE p."pvp_match_id" = "battle_sessions"."pvp_match_id"
              AND p."user_id" = (SELECT "spacey_current_user_id"())
        )
    );

ALTER TABLE "battle_checkpoints" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "battle_checkpoints" FORCE ROW LEVEL SECURITY;
CREATE POLICY "battle_checkpoints_owner" ON "battle_checkpoints" FOR ALL
    USING (EXISTS (
        SELECT 1 FROM "battle_sessions" s
        WHERE s."id" = "battle_checkpoints"."battle_session_id"
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM "battle_sessions" s
        WHERE s."id" = "battle_checkpoints"."battle_session_id"
    ));

ALTER TABLE "input_journal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "input_journal" FORCE ROW LEVEL SECURITY;
CREATE POLICY "input_journal_owner" ON "input_journal" FOR ALL
    USING (
        "user_id" = (SELECT "spacey_current_user_id"())
        AND EXISTS (
            SELECT 1 FROM "battle_sessions" s
            WHERE s."id" = "input_journal"."battle_session_id"
        )
    )
    WITH CHECK (
        "user_id" = (SELECT "spacey_current_user_id"())
        AND EXISTS (
            SELECT 1 FROM "battle_sessions" s
            WHERE s."id" = "input_journal"."battle_session_id"
        )
    );

ALTER TABLE "legacy_build_imports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "legacy_build_imports" FORCE ROW LEVEL SECURITY;
CREATE POLICY "legacy_build_imports_owner" ON "legacy_build_imports" FOR ALL
    USING ("user_id" = (SELECT "spacey_current_user_id"()))
    WITH CHECK ("user_id" = (SELECT "spacey_current_user_id"()));

ALTER TABLE "player_command_idempotency" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "player_command_idempotency" FORCE ROW LEVEL SECURITY;
CREATE POLICY "player_command_idempotency_owner" ON "player_command_idempotency" FOR ALL
    USING ("user_id" = (SELECT "spacey_current_user_id"()))
    WITH CHECK ("user_id" = (SELECT "spacey_current_user_id"()));

-- Only the object owner may bypass these two policies, exclusively through the
-- consent-filtered SECURITY DEFINER leaderboard below. Application roles remain
-- subject to RLS and never receive table-owner membership.
ALTER TABLE "users" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "season_participants" NO FORCE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX "seasons_one_active_idx" ON "seasons" ((true)) WHERE "status" = 'ACTIVE';

CREATE FUNCTION "spacey_public_leaderboard"(requested_limit integer DEFAULT 50)
RETURNS TABLE (
    rank bigint,
    season_key text,
    user_id uuid,
    display_name text,
    rating integer,
    tier text,
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
        dense_rank() OVER (ORDER BY sp.rating DESC) AS rank,
        s.key AS season_key,
        u.id AS user_id,
        COALESCE(u.display_name, 'Pilot') AS display_name,
        sp.rating,
        sp.tier,
        sp.wins,
        sp.losses,
        sp.draws
    FROM public.seasons s
    JOIN public.season_participants sp ON sp.season_id = s.id
    JOIN public.users u ON u.id = sp.user_id
    WHERE s.status = 'ACTIVE'
      AND s.starts_at <= CURRENT_TIMESTAMP
      AND s.ends_at > CURRENT_TIMESTAMP
      AND u.status = 'ACTIVE'
      AND u.deleted_at IS NULL
      AND u.profile_public = true
    ORDER BY sp.rating DESC, sp.id
    LIMIT LEAST(GREATEST(COALESCE(requested_limit, 50), 1), 100)
$$;
REVOKE ALL ON FUNCTION "spacey_public_leaderboard"(integer) FROM PUBLIC;
