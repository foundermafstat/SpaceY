-- Preserve immutable Stars financial facts while allowing one narrow,
-- audited-by-shape GDPR anonymization transition from the jobs worker.
DROP TRIGGER "stars_payment_events_append_only" ON "stars_payment_events";

CREATE FUNCTION "spacey_guard_stars_payment_event_mutation"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF TG_OP <> 'UPDATE'
       OR pg_catalog.current_setting('spacey.privacy_anonymization', true) IS DISTINCT FROM 'on'
       OR OLD.user_id IS NULL
       OR NEW.user_id IS NOT NULL
       OR NEW.invoice_payload IS DISTINCT FROM ('deleted:' || OLD.id::text)
       OR NEW.raw_event IS DISTINCT FROM '{}'::jsonb
       OR NEW.id IS DISTINCT FROM OLD.id
       OR NEW.telegram_update_id IS DISTINCT FROM OLD.telegram_update_id
       OR NEW.telegram_payment_charge_id IS DISTINCT FROM OLD.telegram_payment_charge_id
       OR NEW.provider_payment_charge_id IS DISTINCT FROM OLD.provider_payment_charge_id
       OR NEW.event_type IS DISTINCT FROM OLD.event_type
       OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
       OR NEW.processed_at IS DISTINCT FROM OLD.processed_at
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'stars_payment_events is append-only'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "spacey_guard_stars_payment_event_mutation"() FROM PUBLIC;

CREATE TRIGGER "stars_payment_events_append_only"
    BEFORE UPDATE OR DELETE ON "stars_payment_events"
    FOR EACH ROW EXECUTE FUNCTION "spacey_guard_stars_payment_event_mutation"();

CREATE FUNCTION "spacey_anonymize_stars_payment_events"(requested_user_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    affected_rows bigint;
BEGIN
    IF requested_user_id IS NULL THEN
        RAISE EXCEPTION 'requested user id is required' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_catalog.set_config('spacey.privacy_anonymization', 'on', true);
    UPDATE public.stars_payment_events
       SET user_id = NULL,
           invoice_payload = 'deleted:' || id::text,
           raw_event = '{}'::jsonb
     WHERE user_id = requested_user_id;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    RETURN affected_rows;
END;
$$;
REVOKE ALL ON FUNCTION "spacey_anonymize_stars_payment_events"(uuid) FROM PUBLIC;
REVOKE UPDATE ON "stars_payment_events" FROM spacey_jobs;
GRANT EXECUTE ON FUNCTION "spacey_anonymize_stars_payment_events"(uuid) TO spacey_jobs;
