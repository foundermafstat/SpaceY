# SpaceY Jobs

BullMQ/Valkey worker and PostgreSQL transactional-outbox pump.

- `OutboxPump` leases `outbox_events` with `FOR UPDATE SKIP LOCKED`; stale `PROCESSING` leases are recoverable.
- BullMQ uses the outbox UUID as `jobId`, so a queue retry after a publish/mark race cannot create a second job.
- `IdempotentJobProcessor` claims `job_idempotency_keys`, verifies a canonical payload hash, and never reruns a succeeded effect.
- Failures use bounded exponential retries; exhausted outbox rows move to `FAILED` for operations review.
- Public-safe events (`content.release.published`, leaderboard/season updates and aggregate stats) are fanned out to matching active Public API webhook subscriptions. Player, battle and economy events are denylisted by default. Deliveries are idempotent, HMAC-SHA256 signed, SSRF-screened, bounded by timeout, and persisted with retry/dead-letter state.
- `/health` is process liveness. `/ready` checks PostgreSQL and Valkey/BullMQ.
- EU retention maintenance runs immediately and then on a bounded interval under a transaction-scoped PostgreSQL advisory lock, so only one jobs replica executes a batch. It deletes auth sessions 30 days after expiry (self-referencing rotation links use `ON DELETE SET NULL`), scrubs IP/UA hashes on remaining sessions after 30 days, deletes Telegram auth replay hashes after 30 days, and deletes terminal privacy-request metadata only after its server-owned `retention_until`. Encrypted privacy export objects remain governed by the separate 7-day object-storage lifecycle.
- Delivered webhook records are deleted after 30 days and dead webhook records after 90 days. Only published outbox rows older than 30 days with no non-terminal webhook delivery are deleted; pending, processing and failed outbox rows are never automatically deleted.
- Admin/security audit stays append-only for one year. Older rows can be deleted only through the jobs-only `spacey_jobs_purge_admin_audit_logs(integer)` SECURITY DEFINER function; its cutoff is fixed and direct table deletion remains forbidden.
- Production defaults are 5,000 rows per category every 5 minutes (up to 1.44 million rows/day/category). `SKIP LOCKED` and the advisory lock keep each transaction bounded and prevent duplicate replica work.
- Shutdown stops polling, closes the BullMQ worker, then closes queue and PostgreSQL resources.

Required runtime values are `DATABASE_URL` and `VALKEY_URL`; they must come from the deployment secret store. Optional limits are `WEBHOOK_TIMEOUT_MS` (500–30000), `WEBHOOK_MAX_ATTEMPTS` (1–20), `RETENTION_MAINTENANCE_INTERVAL_MS` (60000–86400000) and `RETENTION_MAINTENANCE_BATCH_SIZE` (1–5000). Retention cutoffs cannot be shortened with environment variables. A subscriber verifies `X-SpaceY-Signature` over `<timestamp>.<event-id>.<body>` with HMAC-SHA256 using `SHA-256(raw webhook secret)` as the signing key. Production also requires an egress firewall because application-level DNS screening alone cannot be the only SSRF control.

Until a retention-lag metric is exported, run the following query from a dedicated DB monitoring role (never an application credential) and alert when `oldest_overdue` exceeds 30 minutes or when `rows_due >= RETENTION_MAINTENANCE_BATCH_SIZE` for three consecutive intervals:

```sql
SELECT kind, count(*) AS rows_due, NOW() - min(eligible_at) AS oldest_overdue
FROM (
  SELECT 'auth_client_hash' AS kind, created_at + INTERVAL '30 days' AS eligible_at
  FROM auth_sessions
  WHERE created_at < NOW() - INTERVAL '30 days' AND (ip_hash IS NOT NULL OR user_agent_hash IS NOT NULL)
  UNION ALL
  SELECT 'expired_auth_session', expires_at + INTERVAL '30 days'
  FROM auth_sessions WHERE expires_at < NOW() - INTERVAL '30 days'
  UNION ALL
  SELECT 'telegram_auth_replay', created_at + INTERVAL '30 days'
  FROM telegram_auth_replays WHERE created_at < NOW() - INTERVAL '30 days'
  UNION ALL
  SELECT 'terminal_privacy_request', retention_until
  FROM privacy_requests
  WHERE status IN ('COMPLETED', 'FAILED') AND retention_until < NOW()
  UNION ALL
  SELECT 'webhook_delivery', updated_at + CASE WHEN status = 'DEAD' THEN INTERVAL '90 days' ELSE INTERVAL '30 days' END
  FROM webhook_deliveries
  WHERE (status = 'DELIVERED' AND updated_at < NOW() - INTERVAL '30 days')
     OR (status = 'DEAD' AND updated_at < NOW() - INTERVAL '90 days')
  UNION ALL
  SELECT 'published_outbox', published_at + INTERVAL '30 days'
  FROM outbox_events event
  WHERE status = 'PUBLISHED' AND published_at < NOW() - INTERVAL '30 days'
    AND NOT EXISTS (
      SELECT 1 FROM webhook_deliveries delivery
      WHERE delivery.outbox_event_id = event.id AND delivery.status IN ('PENDING', 'DELIVERING', 'FAILED')
    )
  UNION ALL
  SELECT 'admin_audit', created_at + INTERVAL '1 year'
  FROM admin_audit_logs WHERE created_at < NOW() - INTERVAL '1 year'
) due
GROUP BY kind
ORDER BY kind;
```
