-- CreateEnum
CREATE TYPE "admin_authentication_method" AS ENUM ('WEBAUTHN', 'TOTP_RECOVERY');
CREATE TYPE "admin_webauthn_challenge_purpose" AS ENUM ('AUTHENTICATION', 'REGISTRATION');

-- CreateTable
CREATE TABLE "admin_sessions" (
    "id" UUID NOT NULL,
    "admin_user_id" UUID NOT NULL,
    "webauthn_credential_id" UUID,
    "token_hash" TEXT NOT NULL,
    "authentication_method" "admin_authentication_method" NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "last_used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "admin_sessions_token_hash_check" CHECK (length("token_hash") = 64),
    CONSTRAINT "admin_sessions_expiry_check" CHECK ("expires_at" > "created_at"),
    CONSTRAINT "admin_sessions_auth_credential_check" CHECK (
        ("authentication_method" = 'WEBAUTHN' AND "webauthn_credential_id" IS NOT NULL)
        OR ("authentication_method" = 'TOTP_RECOVERY' AND "webauthn_credential_id" IS NULL)
    )
);

-- CreateTable
CREATE TABLE "admin_webauthn_challenges" (
    "id" UUID NOT NULL,
    "admin_user_id" UUID NOT NULL,
    "purpose" "admin_webauthn_challenge_purpose" NOT NULL,
    "challenge_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_webauthn_challenges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "admin_webauthn_challenges_hash_check" CHECK (length("challenge_hash") = 64),
    CONSTRAINT "admin_webauthn_challenges_expiry_check" CHECK ("expires_at" > "created_at")
);

-- CreateTable
CREATE TABLE "content_definition_revisions" (
    "id" UUID NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "before_state" JSONB NOT NULL,
    "after_state" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_admin_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_definition_revisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "content_definition_revisions_type_check" CHECK (
        "resource_type" IN ('mission', 'module', 'enemy', 'drop-table')
    ),
    CONSTRAINT "content_definition_revisions_revision_check" CHECK ("revision" > 0),
    CONSTRAINT "content_definition_revisions_reason_check" CHECK (length(btrim("reason")) > 0)
);

-- AlterTable
ALTER TABLE "admin_audit_logs"
    ADD COLUMN "admin_session_id" UUID,
    ADD COLUMN "authentication_method" "admin_authentication_method",
    ADD COLUMN "actor_role" TEXT,
    ADD COLUMN "case_id" TEXT;

ALTER TABLE "admin_users"
    ADD COLUMN "totp_secret_key_version" TEXT,
    ADD COLUMN "totp_last_accepted_step" BIGINT,
    ADD COLUMN "totp_failed_attempts" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "totp_locked_until" TIMESTAMPTZ(6),
    ADD CONSTRAINT "admin_users_totp_secret_version_check" CHECK (
        ("totp_secret_encrypted" IS NULL AND "totp_secret_key_version" IS NULL)
        OR ("totp_secret_encrypted" IS NOT NULL AND "totp_secret_key_version" IS NOT NULL)
    ),
    ADD CONSTRAINT "admin_users_totp_failed_attempts_check" CHECK ("totp_failed_attempts" >= 0),
    ADD CONSTRAINT "admin_users_totp_last_step_check" CHECK (
        "totp_last_accepted_step" IS NULL OR "totp_last_accepted_step" >= 0
    );

-- CreateIndex
CREATE UNIQUE INDEX "admin_sessions_token_hash_key" ON "admin_sessions"("token_hash");
CREATE INDEX "admin_sessions_admin_user_id_idx" ON "admin_sessions"("admin_user_id");
CREATE INDEX "admin_sessions_webauthn_credential_id_idx" ON "admin_sessions"("webauthn_credential_id");
CREATE INDEX "admin_sessions_admin_user_id_revoked_at_expires_at_idx"
    ON "admin_sessions"("admin_user_id", "revoked_at", "expires_at");
CREATE INDEX "admin_sessions_expires_at_id_idx" ON "admin_sessions"("expires_at", "id");
CREATE INDEX "admin_webauthn_challenges_admin_user_id_idx" ON "admin_webauthn_challenges"("admin_user_id");
CREATE INDEX "admin_webauthn_challenges_purpose_expires_at_idx"
    ON "admin_webauthn_challenges"("purpose", "expires_at");
CREATE INDEX "admin_webauthn_challenges_expires_at_consumed_at_idx"
    ON "admin_webauthn_challenges"("expires_at", "consumed_at");

CREATE UNIQUE INDEX "content_definition_revisions_resource_type_resource_id_revision_key"
    ON "content_definition_revisions"("resource_type", "resource_id", "revision");
CREATE INDEX "content_definition_revisions_resource_type_resource_id_created_at_idx"
    ON "content_definition_revisions"("resource_type", "resource_id", "created_at");
CREATE INDEX "content_definition_revisions_created_by_admin_id_idx"
    ON "content_definition_revisions"("created_by_admin_id");
CREATE INDEX "content_definition_revisions_created_at_id_idx"
    ON "content_definition_revisions"("created_at", "id");
CREATE INDEX "admin_audit_logs_admin_session_id_idx" ON "admin_audit_logs"("admin_session_id");
CREATE INDEX "admin_audit_logs_case_id_created_at_idx" ON "admin_audit_logs"("case_id", "created_at");
CREATE INDEX "admin_users_totp_locked_until_idx" ON "admin_users"("totp_locked_until");

-- AddForeignKey
ALTER TABLE "admin_sessions"
    ADD CONSTRAINT "admin_sessions_admin_user_id_fkey"
    FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_sessions"
    ADD CONSTRAINT "admin_sessions_webauthn_credential_id_fkey"
    FOREIGN KEY ("webauthn_credential_id") REFERENCES "webauthn_credentials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "admin_webauthn_challenges"
    ADD CONSTRAINT "admin_webauthn_challenges_admin_user_id_fkey"
    FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "content_definition_revisions"
    ADD CONSTRAINT "content_definition_revisions_created_by_admin_id_fkey"
    FOREIGN KEY ("created_by_admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Revision history is immutable just like audit and ledger history.
CREATE TRIGGER "content_definition_revisions_append_only"
    BEFORE UPDATE OR DELETE ON "content_definition_revisions"
    FOR EACH ROW EXECUTE FUNCTION "spacey_reject_history_mutation"();

-- The admin login cannot update balances directly. This narrow function locks
-- one wallet row, applies an idempotent delta and appends its ledger entry in
-- the caller's transaction; the API appends the immutable admin audit before
-- that same transaction commits.
CREATE FUNCTION "spacey_admin_adjust_wallet"(
    p_balance_id uuid,
    p_ledger_id uuid,
    p_player_id uuid,
    p_currency wallet_currency,
    p_delta bigint,
    p_idempotency_key text,
    p_source_id uuid,
    p_metadata jsonb
)
RETURNS TABLE (
    before_balance bigint,
    after_balance bigint,
    wallet_version bigint,
    idempotent boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    wallet_row public.wallet_balances%ROWTYPE;
    ledger_row public.wallet_ledger_entries%ROWTYPE;
    ledger_metadata jsonb;
BEGIN
    IF p_delta = 0 THEN
        RAISE EXCEPTION 'admin wallet delta cannot be zero' USING ERRCODE = '22023';
    END IF;
    IF length(btrim(p_idempotency_key)) = 0
       OR length(btrim(COALESCE(p_metadata->>'caseId', ''))) = 0
       OR length(btrim(COALESCE(p_metadata->>'reason', ''))) = 0 THEN
        RAISE EXCEPTION 'idempotency key, caseId and reason are required' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.wallet_balances (id, user_id, currency, balance, version, updated_at)
    SELECT p_balance_id, id, p_currency, 0, 0, now()
    FROM public.users
    WHERE id = p_player_id
    ON CONFLICT (user_id, currency) DO NOTHING;

    SELECT * INTO wallet_row
    FROM public.wallet_balances
    WHERE user_id = p_player_id AND currency = p_currency
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'player was not found' USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO ledger_row
    FROM public.wallet_ledger_entries
    WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
        IF ledger_row.user_id IS DISTINCT FROM p_player_id
           OR ledger_row.currency IS DISTINCT FROM p_currency
           OR ledger_row.delta IS DISTINCT FROM p_delta
           OR ledger_row.source_id IS DISTINCT FROM p_source_id
           OR (ledger_row.metadata - 'walletVersion') IS DISTINCT FROM p_metadata THEN
            RAISE EXCEPTION 'economy idempotency key was already used' USING ERRCODE = '23505';
        END IF;

        RETURN QUERY SELECT
            ledger_row.balance_after - ledger_row.delta,
            ledger_row.balance_after,
            (ledger_row.metadata->>'walletVersion')::bigint,
            true;
        RETURN;
    END IF;

    IF wallet_row.balance + p_delta < 0 THEN
        RAISE EXCEPTION 'wallet balance cannot be negative' USING ERRCODE = '23514';
    END IF;

    UPDATE public.wallet_balances
    SET balance = wallet_row.balance + p_delta,
        version = wallet_row.version + 1,
        updated_at = now()
    WHERE id = wallet_row.id
    RETURNING * INTO wallet_row;

    ledger_metadata := p_metadata || jsonb_build_object('walletVersion', wallet_row.version);
    INSERT INTO public.wallet_ledger_entries (
        id, user_id, wallet_balance_id, currency, delta, balance_after,
        source_type, source_id, idempotency_key, metadata
    ) VALUES (
        p_ledger_id, p_player_id, wallet_row.id, p_currency, p_delta,
        wallet_row.balance, 'ADMIN_ADJUSTMENT', p_source_id,
        p_idempotency_key, ledger_metadata
    );

    RETURN QUERY SELECT
        wallet_row.balance - p_delta,
        wallet_row.balance,
        wallet_row.version,
        false;
END;
$$;
REVOKE ALL ON FUNCTION "spacey_admin_adjust_wallet"(uuid, uuid, uuid, wallet_currency, bigint, text, uuid, jsonb)
    FROM PUBLIC;

-- SECURITY DEFINER executes as the migrator-owned function. Narrow policies
-- let that owner cross player RLS without granting the admin login table access.
CREATE POLICY "users_migrator_select" ON "users"
    FOR SELECT TO spacey_migrator USING (true);
CREATE POLICY "wallet_balances_migrator_select" ON "wallet_balances"
    FOR SELECT TO spacey_migrator USING (true);
CREATE POLICY "wallet_balances_migrator_insert" ON "wallet_balances"
    FOR INSERT TO spacey_migrator WITH CHECK (true);
CREATE POLICY "wallet_balances_migrator_update" ON "wallet_balances"
    FOR UPDATE TO spacey_migrator USING (true) WITH CHECK (true);
CREATE POLICY "wallet_ledger_entries_migrator_select" ON "wallet_ledger_entries"
    FOR SELECT TO spacey_migrator USING (true);
CREATE POLICY "wallet_ledger_entries_migrator_insert" ON "wallet_ledger_entries"
    FOR INSERT TO spacey_migrator WITH CHECK (true);
