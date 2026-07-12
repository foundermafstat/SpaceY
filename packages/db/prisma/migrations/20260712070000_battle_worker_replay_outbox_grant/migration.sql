-- Replay attachment is finalized by the battle worker and emits one durable
-- outbox event. Keep clean migrations aligned with roles.grants.template.sql.
GRANT INSERT ON "outbox_events" TO spacey_battle_worker;
