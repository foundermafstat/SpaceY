-- PostgreSQL requires SELECT privilege for the replay outbox idempotency
-- conflict arbiter used by INSERT ... ON CONFLICT DO NOTHING.
GRANT SELECT ON "outbox_events" TO spacey_battle_worker;
