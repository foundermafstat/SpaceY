CREATE TYPE "telegram_bot_update_status" AS ENUM ('PROCESSING', 'COMPLETED');
CREATE TYPE "telegram_support_ticket_status" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "telegram_support_message_kind" AS ENUM ('REQUEST', 'MESSAGE');

CREATE TABLE "telegram_bot_updates" (
    "update_id" BIGINT NOT NULL,
    "status" "telegram_bot_update_status" NOT NULL DEFAULT 'PROCESSING',
    "claimed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "attempt_count" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "telegram_bot_updates_pkey" PRIMARY KEY ("update_id"),
    CONSTRAINT "telegram_bot_updates_id_check" CHECK ("update_id" >= 0),
    CONSTRAINT "telegram_bot_updates_attempt_count_check" CHECK ("attempt_count" > 0),
    CONSTRAINT "telegram_bot_updates_completion_check" CHECK (
        ("status" = 'PROCESSING' AND "completed_at" IS NULL)
        OR ("status" = 'COMPLETED' AND "completed_at" IS NOT NULL)
    )
);

CREATE TABLE "telegram_referrals" (
    "id" UUID NOT NULL,
    "telegram_user_id" BIGINT NOT NULL,
    "referral_code" TEXT NOT NULL,
    "telegram_update_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "telegram_referrals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "telegram_referrals_user_id_check" CHECK ("telegram_user_id" > 0),
    CONSTRAINT "telegram_referrals_update_id_check" CHECK ("telegram_update_id" >= 0),
    CONSTRAINT "telegram_referrals_code_check" CHECK ("referral_code" ~ '^[A-Za-z0-9_-]{1,64}$')
);

CREATE TABLE "telegram_support_tickets" (
    "id" UUID NOT NULL,
    "telegram_user_id" BIGINT NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "status" "telegram_support_ticket_status" NOT NULL DEFAULT 'OPEN',
    "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "telegram_support_tickets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "telegram_support_tickets_user_id_check" CHECK ("telegram_user_id" > 0),
    CONSTRAINT "telegram_support_tickets_time_check" CHECK (
        ("status" = 'OPEN' AND "closed_at" IS NULL)
        OR ("status" = 'CLOSED' AND "closed_at" IS NOT NULL AND "closed_at" >= "opened_at")
    )
);

CREATE TABLE "telegram_support_messages" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "telegram_update_id" BIGINT NOT NULL,
    "telegram_user_id" BIGINT NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "kind" "telegram_support_message_kind" NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "telegram_support_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "telegram_support_messages_update_id_check" CHECK ("telegram_update_id" >= 0),
    CONSTRAINT "telegram_support_messages_user_id_check" CHECK ("telegram_user_id" > 0),
    CONSTRAINT "telegram_support_messages_text_check" CHECK (char_length("text") BETWEEN 1 AND 4096),
    CONSTRAINT "telegram_support_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id")
        REFERENCES "telegram_support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "telegram_notification_preferences" (
    "telegram_user_id" BIGINT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "source_update_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "telegram_notification_preferences_pkey" PRIMARY KEY ("telegram_user_id"),
    CONSTRAINT "telegram_notification_preferences_user_id_check" CHECK ("telegram_user_id" > 0),
    CONSTRAINT "telegram_notification_preferences_update_id_check" CHECK ("source_update_id" >= 0)
);

CREATE INDEX "telegram_bot_updates_status_claimed_at_idx"
    ON "telegram_bot_updates"("status", "claimed_at");
CREATE INDEX "telegram_bot_updates_created_at_update_id_idx"
    ON "telegram_bot_updates"("created_at", "update_id");

CREATE UNIQUE INDEX "telegram_referrals_telegram_update_id_key"
    ON "telegram_referrals"("telegram_update_id");
CREATE INDEX "telegram_referrals_telegram_user_id_created_at_idx"
    ON "telegram_referrals"("telegram_user_id", "created_at");
CREATE INDEX "telegram_referrals_referral_code_created_at_idx"
    ON "telegram_referrals"("referral_code", "created_at");
CREATE INDEX "telegram_referrals_created_at_id_idx"
    ON "telegram_referrals"("created_at", "id");

CREATE UNIQUE INDEX "telegram_support_tickets_one_open_user_idx"
    ON "telegram_support_tickets"("telegram_user_id") WHERE "status" = 'OPEN';
CREATE INDEX "telegram_support_tickets_telegram_user_id_status_updated_at_idx"
    ON "telegram_support_tickets"("telegram_user_id", "status", "updated_at");
CREATE INDEX "telegram_support_tickets_status_updated_at_idx"
    ON "telegram_support_tickets"("status", "updated_at");
CREATE INDEX "telegram_support_tickets_created_at_id_idx"
    ON "telegram_support_tickets"("created_at", "id");

CREATE UNIQUE INDEX "telegram_support_messages_telegram_update_id_key"
    ON "telegram_support_messages"("telegram_update_id");
CREATE INDEX "telegram_support_messages_ticket_id_created_at_idx"
    ON "telegram_support_messages"("ticket_id", "created_at");
CREATE INDEX "telegram_support_messages_telegram_user_id_created_at_idx"
    ON "telegram_support_messages"("telegram_user_id", "created_at");
CREATE INDEX "telegram_support_messages_created_at_id_idx"
    ON "telegram_support_messages"("created_at", "id");

CREATE UNIQUE INDEX "telegram_notification_preferences_source_update_id_key"
    ON "telegram_notification_preferences"("source_update_id");
CREATE INDEX "telegram_notification_preferences_enabled_updated_at_idx"
    ON "telegram_notification_preferences"("enabled", "updated_at");
