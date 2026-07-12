-- Stage 1 security invariants. This migration is forward-only; published
-- migrations remain untouched.

ALTER TYPE "user_status" ADD VALUE IF NOT EXISTS 'DELETION_PENDING' AFTER 'ACTIVE';

ALTER TABLE "mission_attempts"
    ADD COLUMN "request_hash" TEXT NOT NULL DEFAULT repeat('0', 64),
    ADD CONSTRAINT "mission_attempts_request_hash_check"
        CHECK ("request_hash" ~ '^[a-f0-9]{64}$');

ALTER TABLE "battle_sessions"
    ADD COLUMN "simulation_config" JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN "simulation_config_hash" TEXT NOT NULL DEFAULT repeat('0', 64),
    ADD CONSTRAINT "battle_sessions_simulation_config_hash_check"
        CHECK ("simulation_config_hash" ~ '^[a-f0-9]{64}$');

CREATE FUNCTION "spacey_require_active_user_for_session"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    player_status text;
BEGIN
    IF NEW.status = 'ACTIVE'::public.auth_session_status THEN
        SELECT status::text INTO player_status
        FROM public.users
        WHERE id = NEW.user_id
        FOR SHARE;
        IF player_status IS DISTINCT FROM 'ACTIVE' THEN
            RAISE EXCEPTION 'active auth session requires an active player'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "spacey_require_active_user_for_session"() FROM PUBLIC;

CREATE TRIGGER "auth_sessions_require_active_user"
BEFORE INSERT OR UPDATE OF "status", "user_id" ON "auth_sessions"
FOR EACH ROW EXECUTE FUNCTION "spacey_require_active_user_for_session"();

-- A battle may receive its snapshot once after a legacy/default insert (the
-- PvP materialization function inserts the session before the API computes
-- the typed snapshot). Once populated, both snapshot and hash are immutable.
CREATE FUNCTION "spacey_protect_battle_simulation_config"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF OLD.simulation_config IS DISTINCT FROM NEW.simulation_config
       OR OLD.simulation_config_hash IS DISTINCT FROM NEW.simulation_config_hash THEN
        IF OLD.simulation_config <> '{}'::jsonb
           OR OLD.simulation_config_hash <> repeat('0', 64) THEN
            RAISE EXCEPTION 'battle simulation config is immutable'
                USING ERRCODE = '23514';
        END IF;
        IF NEW.simulation_config = '{}'::jsonb
           OR NEW.simulation_config_hash = repeat('0', 64) THEN
            RAISE EXCEPTION 'battle simulation config must be populated atomically'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "spacey_protect_battle_simulation_config"() FROM PUBLIC;

CREATE TRIGGER "battle_sessions_simulation_config_immutable"
BEFORE UPDATE OF "simulation_config", "simulation_config_hash" ON "battle_sessions"
FOR EACH ROW EXECUTE FUNCTION "spacey_protect_battle_simulation_config"();

-- Definition rows can only belong to and be changed inside a DRAFT release.
-- Locking the release row also serializes definition edits with publication.
CREATE FUNCTION "spacey_require_draft_content_release"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    previous_release_id uuid;
    requested_release_id uuid;
    release_status public.content_release_status;
BEGIN
    IF TG_OP = 'DELETE' THEN
        requested_release_id := OLD.content_release_id;
    ELSE
        requested_release_id := NEW.content_release_id;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        previous_release_id := OLD.content_release_id;
        IF previous_release_id IS DISTINCT FROM requested_release_id THEN
            SELECT status INTO release_status
            FROM public.content_releases
            WHERE id = previous_release_id
            FOR SHARE;
            IF release_status IS DISTINCT FROM 'DRAFT'::public.content_release_status THEN
                RAISE EXCEPTION 'content definitions can only move from a draft release'
                    USING ERRCODE = '23514';
            END IF;
        END IF;
    END IF;

    SELECT status INTO release_status
    FROM public.content_releases
    WHERE id = requested_release_id
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'content release does not exist' USING ERRCODE = '23503';
    END IF;
    IF release_status <> 'DRAFT'::public.content_release_status THEN
        RAISE EXCEPTION 'content definitions are immutable outside a draft release'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "spacey_require_draft_content_release"() FROM PUBLIC;

CREATE TRIGGER "mission_definitions_require_draft_release"
BEFORE INSERT OR UPDATE OR DELETE ON "mission_definitions"
FOR EACH ROW EXECUTE FUNCTION "spacey_require_draft_content_release"();
CREATE TRIGGER "module_definitions_require_draft_release"
BEFORE INSERT OR UPDATE OR DELETE ON "module_definitions"
FOR EACH ROW EXECUTE FUNCTION "spacey_require_draft_content_release"();
CREATE TRIGGER "enemy_definitions_require_draft_release"
BEFORE INSERT OR UPDATE OR DELETE ON "enemy_definitions"
FOR EACH ROW EXECUTE FUNCTION "spacey_require_draft_content_release"();
CREATE TRIGGER "drop_tables_require_draft_release"
BEFORE INSERT OR UPDATE OR DELETE ON "drop_tables"
FOR EACH ROW EXECUTE FUNCTION "spacey_require_draft_content_release"();
CREATE TRIGGER "research_definitions_require_draft_release"
BEFORE INSERT OR UPDATE OR DELETE ON "research_definitions"
FOR EACH ROW EXECUTE FUNCTION "spacey_require_draft_content_release"();
CREATE TRIGGER "achievement_definitions_require_draft_release"
BEFORE INSERT OR UPDATE OR DELETE ON "achievement_definitions"
FOR EACH ROW EXECUTE FUNCTION "spacey_require_draft_content_release"();

-- A draft may be published, and the current published release may be retired.
-- Published/retired payload and metadata are otherwise append-only.
CREATE FUNCTION "spacey_protect_content_release"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'DRAFT'::public.content_release_status THEN
            RAISE EXCEPTION 'content releases must be created as drafts'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF OLD.status <> 'DRAFT'::public.content_release_status THEN
            RAISE EXCEPTION 'published or retired content releases cannot be deleted'
                USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;

    IF OLD.status = 'DRAFT'::public.content_release_status THEN
        IF NEW.status NOT IN (
            'DRAFT'::public.content_release_status,
            'PUBLISHED'::public.content_release_status
        ) THEN
            RAISE EXCEPTION 'invalid content release transition'
                USING ERRCODE = '23514';
        END IF;
        IF NEW.status = 'PUBLISHED'::public.content_release_status
           AND (NEW.published_at IS NULL OR NEW.config_hash !~ '^[a-f0-9]{64}$') THEN
            RAISE EXCEPTION 'published release requires published_at and canonical config hash'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    IF OLD.status = 'PUBLISHED'::public.content_release_status
       AND NEW.status = 'RETIRED'::public.content_release_status
       AND ROW(
            NEW.id, NEW.version, NEW.config_hash, NEW.schema_version,
            NEW.bootstrap_config, NEW.notes, NEW.created_by_admin_id,
            NEW.published_at, NEW.created_at
       ) IS NOT DISTINCT FROM ROW(
            OLD.id, OLD.version, OLD.config_hash, OLD.schema_version,
            OLD.bootstrap_config, OLD.notes, OLD.created_by_admin_id,
            OLD.published_at, OLD.created_at
       ) THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'published or retired content releases are immutable'
        USING ERRCODE = '23514';
END;
$$;
REVOKE ALL ON FUNCTION "spacey_protect_content_release"() FROM PUBLIC;

CREATE TRIGGER "content_releases_immutable_after_publish"
BEFORE INSERT OR UPDATE OR DELETE ON "content_releases"
FOR EACH ROW EXECUTE FUNCTION "spacey_protect_content_release"();

-- Returns both sides' immutable source material to the runtime that owns one
-- participant. It is used only while creating/backfilling a stored PvP config.
CREATE FUNCTION "spacey_load_pvp_simulation_source"(requested_match_id uuid)
RETURNS TABLE (
    match_id uuid,
    battle_session_id uuid,
    seed bigint,
    simulation_version text,
    content_version text,
    duration_seconds integer,
    participant_id uuid,
    user_id uuid,
    side integer,
    build_revision_id uuid,
    definition_keys text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF public.spacey_current_user_id() IS NULL OR NOT EXISTS (
        SELECT 1
        FROM public.pvp_match_participants owned
        WHERE owned.pvp_match_id = requested_match_id
          AND owned.user_id = public.spacey_current_user_id()
    ) THEN
        RAISE EXCEPTION 'caller is not a participant in the PvP match'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        pvp.id,
        session.id,
        pvp.seed,
        pvp.simulation_version,
        release.version,
        mission.duration_seconds,
        participant.id,
        participant.user_id,
        participant.side,
        participant.build_revision_id,
        ARRAY(
            SELECT inventory.definition_key
            FROM public.build_revision_items installed
            JOIN public.inventory_items inventory ON inventory.id = installed.inventory_item_id
            WHERE installed.build_revision_id = participant.build_revision_id
            ORDER BY installed.slot_key, installed.id
        )
    FROM public.pvp_matches pvp
    JOIN public.battle_sessions session ON session.pvp_match_id = pvp.id
    JOIN public.content_releases release ON release.id = pvp.content_release_id
    JOIN LATERAL (
        SELECT definition.duration_seconds
        FROM public.mission_attempts attempt
        JOIN public.mission_definitions definition ON definition.id = attempt.mission_definition_id
        WHERE attempt.pvp_match_id = pvp.id
        ORDER BY attempt.id
        LIMIT 1
    ) mission ON true
    JOIN public.pvp_match_participants participant ON participant.pvp_match_id = pvp.id
    WHERE pvp.id = requested_match_id
    ORDER BY participant.side;
END;
$$;
REVOKE ALL ON FUNCTION "spacey_load_pvp_simulation_source"(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "spacey_load_pvp_simulation_source"(uuid) TO spacey_runtime;
