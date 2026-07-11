-- EU privacy workflow foundation. No live data migration or external storage call is performed here.

CREATE TYPE "privacy_request_type" AS ENUM ('EXPORT', 'DELETE');
CREATE TYPE "privacy_request_status" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

ALTER TABLE "users" ADD COLUMN "analytics_consent_updated_at" TIMESTAMPTZ(6);

CREATE TABLE "privacy_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "privacy_request_type" NOT NULL,
    "status" "privacy_request_status" NOT NULL DEFAULT 'PENDING',
    "request_hash" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processing_started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "failure_code" TEXT,
    "export_object_key" TEXT,
    "export_object_version" TEXT,
    "export_content_type" TEXT,
    "export_content_sha256" TEXT,
    "export_size_bytes" BIGINT,
    "export_encryption_algorithm" TEXT,
    "export_encryption_key_id" TEXT,
    "export_expires_at" TIMESTAMPTZ(6),
    "anonymized_at" TIMESTAMPTZ(6),
    "retention_policy_version" TEXT NOT NULL DEFAULT 'eu-v1',
    "retention_until" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "privacy_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "privacy_requests_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "privacy_requests_request_hash_check"
        CHECK ("request_hash" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "privacy_requests_idempotency_key_check"
        CHECK (length("idempotency_key") BETWEEN 16 AND 128),
    CONSTRAINT "privacy_requests_retention_check"
        CHECK ("retention_until" > "requested_at"),
    CONSTRAINT "privacy_requests_export_size_check"
        CHECK ("export_size_bytes" IS NULL OR "export_size_bytes" >= 0),
    CONSTRAINT "privacy_requests_export_hash_check"
        CHECK ("export_content_sha256" IS NULL OR "export_content_sha256" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "privacy_requests_status_timestamps_check" CHECK (
        ("status" = 'PENDING' AND "processing_started_at" IS NULL AND "completed_at" IS NULL AND "failed_at" IS NULL)
        OR ("status" = 'PROCESSING' AND "processing_started_at" IS NOT NULL AND "completed_at" IS NULL)
        OR ("status" = 'COMPLETED' AND "processing_started_at" IS NOT NULL AND "completed_at" IS NOT NULL
            AND "failed_at" IS NULL AND "failure_code" IS NULL)
        OR ("status" = 'FAILED' AND "processing_started_at" IS NOT NULL AND "completed_at" IS NULL
            AND "failed_at" IS NOT NULL AND "failure_code" IS NOT NULL)
    ),
    CONSTRAINT "privacy_requests_result_shape_check" CHECK (
        (
            "type" = 'EXPORT'
            AND "anonymized_at" IS NULL
            AND (
                "status" <> 'COMPLETED'
                OR (
                    "export_object_key" IS NOT NULL
                    AND "export_content_type" = 'application/json'
                    AND "export_content_sha256" IS NOT NULL
                    AND "export_size_bytes" IS NOT NULL
                    AND "export_encryption_algorithm" IS NOT NULL
                    AND "export_encryption_key_id" IS NOT NULL
                    AND "export_expires_at" IS NOT NULL
                    AND "export_expires_at" > "completed_at"
                )
            )
        )
        OR (
            "type" = 'DELETE'
            AND "export_object_key" IS NULL
            AND "export_object_version" IS NULL
            AND "export_content_type" IS NULL
            AND "export_content_sha256" IS NULL
            AND "export_size_bytes" IS NULL
            AND "export_encryption_algorithm" IS NULL
            AND "export_encryption_key_id" IS NULL
            AND "export_expires_at" IS NULL
            AND ("status" <> 'COMPLETED' OR "anonymized_at" IS NOT NULL)
        )
    )
);

CREATE UNIQUE INDEX "privacy_requests_user_id_idempotency_key_key"
    ON "privacy_requests"("user_id", "idempotency_key");
CREATE INDEX "privacy_requests_user_id_idx" ON "privacy_requests"("user_id");
CREATE INDEX "privacy_requests_user_id_requested_at_id_idx"
    ON "privacy_requests"("user_id", "requested_at", "id");
CREATE INDEX "privacy_requests_status_requested_at_id_idx"
    ON "privacy_requests"("status", "requested_at", "id");
CREATE INDEX "privacy_requests_retention_until_idx" ON "privacy_requests"("retention_until");
CREATE INDEX "privacy_requests_pending_idx"
    ON "privacy_requests"("requested_at", "id")
    WHERE "status" IN ('PENDING', 'PROCESSING', 'FAILED');

ALTER TABLE "privacy_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "privacy_requests" FORCE ROW LEVEL SECURITY;

CREATE POLICY "privacy_requests_owner_select" ON "privacy_requests"
    FOR SELECT TO spacey_runtime
    USING ("user_id" = (SELECT "spacey_current_user_id"()));

CREATE POLICY "privacy_requests_owner_insert" ON "privacy_requests"
    FOR INSERT TO spacey_runtime
    WITH CHECK ("user_id" = (SELECT "spacey_current_user_id"()));

CREATE POLICY "privacy_requests_jobs" ON "privacy_requests"
    FOR ALL TO spacey_jobs
    USING (true)
    WITH CHECK (true);

GRANT SELECT, INSERT ON "privacy_requests" TO spacey_runtime;
GRANT SELECT, UPDATE ON "privacy_requests" TO spacey_jobs;

-- Jobs receive only the reads needed for a controlled canonical export.
GRANT SELECT ON
    "users",
    "telegram_identities",
    "auth_sessions",
    "ship_builds",
    "ship_build_revisions",
    "build_revision_items",
    "inventory_items",
    "wallet_balances",
    "wallet_ledger_entries",
    "mission_attempts",
    "mission_results",
    "player_progression"
TO spacey_jobs;

-- Deletion is soft at the user boundary. Financial ledgers, payment records and audit history stay intact.
GRANT UPDATE ON "users", "auth_sessions" TO spacey_jobs;
GRANT SELECT, UPDATE ON "telegram_auth_replays" TO spacey_jobs;
GRANT SELECT, DELETE ON "telegram_identities" TO spacey_jobs;
GRANT SELECT, DELETE ON
    "telegram_referrals",
    "telegram_support_messages",
    "telegram_support_tickets",
    "telegram_notification_preferences"
TO spacey_jobs;
GRANT INSERT ON "outbox_events" TO spacey_jobs;
GRANT EXECUTE ON FUNCTION "spacey_current_user_id"() TO spacey_jobs;
