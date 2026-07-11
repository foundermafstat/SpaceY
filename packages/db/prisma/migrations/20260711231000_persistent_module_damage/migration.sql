-- Persistent module damage launch guard and battle-worker access to the exact
-- immutable build revision pinned by an active authoritative attempt.

CREATE UNIQUE INDEX "mission_attempts_one_active_build_revision_idx"
    ON "mission_attempts"("build_revision_id")
    WHERE "status" IN ('CREATED', 'CONNECTING', 'ACTIVE', 'PAUSED');

CREATE POLICY "build_revision_items_battle_worker" ON "build_revision_items"
    FOR SELECT TO spacey_battle_worker
    USING (EXISTS (
        SELECT 1
        FROM "mission_attempts" attempt
        WHERE attempt."build_revision_id" = "build_revision_items"."build_revision_id"
          AND attempt."status" IN ('CREATED', 'CONNECTING', 'ACTIVE', 'PAUSED')
    ));

CREATE FUNCTION "spacey_assert_build_launchable_internal"(
    requested_build_revision_id uuid,
    allowed_matchmaking_ticket_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    caller_user_id uuid;
    installed_item_count integer;
    invalid_item_count integer;
BEGIN
    caller_user_id := public.spacey_current_user_id();
    IF caller_user_id IS NULL THEN
        RAISE EXCEPTION 'player context is required' USING ERRCODE = '42501';
    END IF;

    -- Lock the owning build first. Build commands use the same build -> items
    -- order, so current-revision validation cannot race a revision switch.
    PERFORM build.id
    FROM public.ship_build_revisions revision
    JOIN public.ship_builds build ON build.id = revision.build_id
    WHERE revision.id = requested_build_revision_id
      AND build.user_id = caller_user_id
      AND build.status = 'ACTIVE'
      AND build.current_revision_id = revision.id
    FOR UPDATE OF build;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'only the current owned build revision can launch'
            USING ERRCODE = '23514';
    END IF;

    -- This item lock order matches build mutation and battle finalization.
    PERFORM inventory.id
    FROM public.ship_build_revisions revision
    JOIN public.build_revision_items installed ON installed.build_revision_id = revision.id
    JOIN public.inventory_items inventory ON inventory.id = installed.inventory_item_id
    WHERE revision.id = requested_build_revision_id
      AND inventory.user_id = caller_user_id
    ORDER BY inventory.id
    FOR SHARE OF inventory;
    GET DIAGNOSTICS installed_item_count = ROW_COUNT;

    IF installed_item_count = 0 THEN
        RAISE EXCEPTION 'build revision has no launchable installed items' USING ERRCODE = '23514';
    END IF;

    SELECT count(*)::integer
      INTO invalid_item_count
    FROM public.ship_build_revisions revision
    JOIN public.ship_builds build ON build.id = revision.build_id
    JOIN public.build_revision_items installed ON installed.build_revision_id = revision.id
    JOIN public.inventory_items inventory ON inventory.id = installed.inventory_item_id
    LEFT JOIN public.module_definitions definition
      ON definition.content_release_id = revision.content_release_id
     AND definition.key = inventory.definition_key
     AND definition.enabled = true
    WHERE revision.id = requested_build_revision_id
      AND build.user_id = caller_user_id
      AND (
          inventory.user_id <> caller_user_id
          OR inventory.content_release_id <> revision.content_release_id
          OR definition.id IS NULL
          OR NOT (
              (inventory.state = 'INSTALLED' AND inventory.durability BETWEEN 7000 AND 10000)
              OR (inventory.state = 'DAMAGED' AND inventory.durability BETWEEN 1 AND 6999)
          )
      );
    IF invalid_item_count <> 0 THEN
        RAISE EXCEPTION 'build revision contains unavailable, inconsistent or destroyed items'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.mission_attempts attempt
        WHERE attempt.build_revision_id = requested_build_revision_id
          AND attempt.user_id = caller_user_id
          AND attempt.status IN ('CREATED', 'CONNECTING', 'ACTIVE', 'PAUSED')
    ) THEN
        RAISE EXCEPTION 'build revision is already used by an active battle'
            USING ERRCODE = '23514';
    END IF;

    IF allowed_matchmaking_ticket_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM public.matchmaking_tickets ticket
        WHERE ticket.id = allowed_matchmaking_ticket_id
          AND ticket.user_id = caller_user_id
          AND ticket.build_revision_id = requested_build_revision_id
          AND ticket.status IN ('QUEUED', 'MATCHED')
    ) THEN
        RAISE EXCEPTION 'scoped matchmaking reservation is invalid'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.matchmaking_tickets ticket
        WHERE ticket.user_id = caller_user_id
          AND ticket.build_revision_id = requested_build_revision_id
          AND ticket.status IN ('QUEUED', 'MATCHED')
          AND ticket.id IS DISTINCT FROM allowed_matchmaking_ticket_id
    ) THEN
        RAISE EXCEPTION 'build revision is reserved by active matchmaking'
            USING ERRCODE = '23514';
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION "spacey_assert_build_launchable_internal"(uuid, uuid) FROM PUBLIC;

CREATE FUNCTION "spacey_assert_owned_build_launchable"(requested_build_revision_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public.spacey_assert_build_launchable_internal(requested_build_revision_id, NULL);
END;
$$;
REVOKE ALL ON FUNCTION "spacey_assert_owned_build_launchable"(uuid) FROM PUBLIC;

CREATE FUNCTION "spacey_validate_mission_attempt_build"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    previous_user_id text;
    allowed_matchmaking_ticket_id uuid;
BEGIN
    previous_user_id := current_setting('spacey.user_id', true);
    PERFORM set_config('spacey.user_id', NEW.user_id::text, true);

    IF NEW.type = 'PVP' THEN
        SELECT ticket.id
          INTO allowed_matchmaking_ticket_id
        FROM public.matchmaking_tickets ticket
        JOIN public.pvp_match_participants participant
          ON participant.pvp_match_id = NEW.pvp_match_id
         AND participant.user_id = NEW.user_id
         AND participant.build_revision_id = NEW.build_revision_id
        JOIN public.pvp_matches pvp ON pvp.id = participant.pvp_match_id
        WHERE ticket.user_id = NEW.user_id
          AND ticket.build_revision_id = NEW.build_revision_id
          AND ticket.mission_definition_id = NEW.mission_definition_id
          AND ticket.content_release_id = NEW.content_release_id
          AND ticket.status = 'QUEUED'
          AND pvp.content_release_id = NEW.content_release_id
        ORDER BY ticket.id
        LIMIT 1
        FOR UPDATE OF ticket;
        IF allowed_matchmaking_ticket_id IS NULL THEN
            RAISE EXCEPTION 'PvP attempt has no matching scoped reservation'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    PERFORM public.spacey_assert_build_launchable_internal(
        NEW.build_revision_id,
        allowed_matchmaking_ticket_id
    );
    PERFORM set_config('spacey.user_id', COALESCE(previous_user_id, ''), true);
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('spacey.user_id', COALESCE(previous_user_id, ''), true);
    RAISE;
END;
$$;
REVOKE ALL ON FUNCTION "spacey_validate_mission_attempt_build"() FROM PUBLIC;

CREATE TRIGGER "mission_attempts_validate_build"
    BEFORE INSERT ON "mission_attempts"
    FOR EACH ROW EXECUTE FUNCTION "spacey_validate_mission_attempt_build"();
