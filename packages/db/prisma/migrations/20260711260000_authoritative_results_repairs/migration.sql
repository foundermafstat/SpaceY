ALTER TABLE "mission_attempts"
    ADD COLUMN "ticket_version" INTEGER NOT NULL DEFAULT 0,
    ADD CONSTRAINT "mission_attempts_ticket_version_check" CHECK ("ticket_version" >= 0);

CREATE TYPE "repair_quote_status" AS ENUM ('ACTIVE', 'COMMITTED', 'EXPIRED', 'INVALIDATED');

CREATE TABLE "repair_quotes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "inventory_item_id" UUID NOT NULL,
    "definition_key" TEXT NOT NULL,
    "durability_before" INTEGER NOT NULL,
    "currency" "wallet_currency" NOT NULL DEFAULT 'CREDITS',
    "cost" BIGINT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" "repair_quote_status" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "commit_idempotency_key" TEXT,
    "commit_request_hash" TEXT,
    "ledger_entry_id" UUID,
    "committed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "repair_quotes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "repair_quotes_durability_before_check" CHECK ("durability_before" BETWEEN 1 AND 9999),
    CONSTRAINT "repair_quotes_cost_check" CHECK ("cost" > 0),
    CONSTRAINT "repair_quotes_currency_check" CHECK ("currency" = 'CREDITS'),
    CONSTRAINT "repair_quotes_definition_key_check" CHECK (length("definition_key") BETWEEN 1 AND 128),
    CONSTRAINT "repair_quotes_idempotency_key_check" CHECK (length("idempotency_key") BETWEEN 16 AND 128),
    CONSTRAINT "repair_quotes_expiry_check" CHECK ("expires_at" > "created_at"),
    CONSTRAINT "repair_quotes_request_hash_check" CHECK ("request_hash" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "repair_quotes_commit_request_hash_check" CHECK (
        "commit_request_hash" IS NULL OR "commit_request_hash" ~ '^[a-f0-9]{64}$'
    ),
    CONSTRAINT "repair_quotes_commit_state_check" CHECK (
        ("status" = 'COMMITTED'
            AND "committed_at" IS NOT NULL
            AND "commit_idempotency_key" IS NOT NULL
            AND "commit_request_hash" IS NOT NULL
            AND "ledger_entry_id" IS NOT NULL)
        OR
        ("status" <> 'COMMITTED'
            AND "committed_at" IS NULL
            AND "commit_idempotency_key" IS NULL
            AND "commit_request_hash" IS NULL
            AND "ledger_entry_id" IS NULL)
    )
);

CREATE UNIQUE INDEX "repair_quotes_user_id_idempotency_key_key"
    ON "repair_quotes"("user_id", "idempotency_key");
CREATE UNIQUE INDEX "repair_quotes_commit_idempotency_key_key"
    ON "repair_quotes"("commit_idempotency_key")
    WHERE "commit_idempotency_key" IS NOT NULL;
CREATE UNIQUE INDEX "repair_quotes_ledger_entry_id_key"
    ON "repair_quotes"("ledger_entry_id")
    WHERE "ledger_entry_id" IS NOT NULL;
CREATE INDEX "repair_quotes_user_id_idx" ON "repair_quotes"("user_id");
CREATE INDEX "repair_quotes_inventory_item_id_idx" ON "repair_quotes"("inventory_item_id");
CREATE INDEX "repair_quotes_user_id_status_expires_at_idx" ON "repair_quotes"("user_id", "status", "expires_at");
CREATE INDEX "repair_quotes_created_at_id_idx" ON "repair_quotes"("created_at", "id");

ALTER TABLE "repair_quotes"
    ADD CONSTRAINT "repair_quotes_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "repair_quotes_inventory_item_id_fkey"
        FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "repair_quotes_ledger_entry_id_fkey"
        FOREIGN KEY ("ledger_entry_id") REFERENCES "wallet_ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "repair_quotes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "repair_quotes" FORCE ROW LEVEL SECURITY;
CREATE POLICY "repair_quotes_owner" ON "repair_quotes" FOR ALL
    USING ("user_id" = (SELECT "spacey_current_user_id"()))
    WITH CHECK (
        "user_id" = (SELECT "spacey_current_user_id"())
        AND EXISTS (
            SELECT 1
            FROM "inventory_items" item
            WHERE item."id" = "repair_quotes"."inventory_item_id"
              AND item."user_id" = "repair_quotes"."user_id"
        )
    );

GRANT SELECT, INSERT, UPDATE ON TABLE "repair_quotes" TO spacey_runtime;
