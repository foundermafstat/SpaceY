import { captureException } from "@spacey/observability";
import type { Pool, QueryResultRow } from "pg";

export const RETENTION_POLICY = Object.freeze({
  expiredAuthSessionGraceDays: 30,
  authClientHashesDays: 30,
  telegramAuthReplayDays: 30,
  terminalPrivacyRequestsUseRetentionUntil: true,
  deliveredWebhookDays: 30,
  deadWebhookDays: 90,
  publishedOutboxDays: 30,
  adminAuditYears: 1,
});

export type RetentionMaintenanceResult = Readonly<{
  skippedLock: boolean;
  authSessionsDeleted: number;
  authSessionsScrubbed: number;
  telegramAuthReplaysDeleted: number;
  privacyRequestsDeleted: number;
  webhookDeliveriesDeleted: number;
  outboxEventsDeleted: number;
  adminAuditLogsDeleted: number;
}>;

type RetentionRow = QueryResultRow & {
  skippedLock: boolean;
  authSessionsDeleted: string;
  authSessionsScrubbed: string;
  telegramAuthReplaysDeleted: string;
  privacyRequestsDeleted: string;
  webhookDeliveriesDeleted: string;
  outboxEventsDeleted: string;
  adminAuditLogsDeleted: string;
};

export class PostgresRetentionMaintenance {
  constructor(
    private readonly pool: Pick<Pool, "connect" | "query">,
    private readonly batchSize: number,
  ) {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 5_000) {
      throw new Error("Retention batch size must be between 1 and 5000");
    }
  }

  async runOnce(): Promise<RetentionMaintenanceResult> {
    const client = await this.pool.connect();
    let inTransaction = false;
    try {
      await client.query("BEGIN");
      inTransaction = true;
      const result = await client.query<RetentionRow>(`
        SELECT
          skipped_lock AS "skippedLock",
          auth_sessions_deleted::text AS "authSessionsDeleted",
          auth_sessions_scrubbed::text AS "authSessionsScrubbed",
          telegram_auth_replays_deleted::text AS "telegramAuthReplaysDeleted",
          privacy_requests_deleted::text AS "privacyRequestsDeleted",
          webhook_deliveries_deleted::text AS "webhookDeliveriesDeleted",
          outbox_events_deleted::text AS "outboxEventsDeleted",
          admin_audit_logs_deleted::text AS "adminAuditLogsDeleted"
        FROM spacey_jobs_apply_eu_retention($1::int)
      `,
        [this.batchSize],
      );
      const row = result.rows[0];
      if (!row) throw new Error("EU retention function returned no result");

      await client.query("COMMIT");
      inTransaction = false;
      return {
        skippedLock: row.skippedLock,
        authSessionsDeleted: Number(row.authSessionsDeleted),
        authSessionsScrubbed: Number(row.authSessionsScrubbed),
        telegramAuthReplaysDeleted: Number(row.telegramAuthReplaysDeleted),
        privacyRequestsDeleted: Number(row.privacyRequestsDeleted),
        webhookDeliveriesDeleted: Number(row.webhookDeliveriesDeleted),
        outboxEventsDeleted: Number(row.outboxEventsDeleted),
        adminAuditLogsDeleted: Number(row.adminAuditLogsDeleted),
      };
    } catch (error) {
      if (inTransaction) await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<void> {
    const result = await this.pool.query<{ ready: boolean }>(`
      WITH retention_functions AS (
        SELECT
          to_regprocedure('public.spacey_jobs_apply_eu_retention(integer)') AS apply_oid,
          to_regprocedure('public.spacey_jobs_purge_admin_audit_logs(integer)') AS audit_oid
      )
      SELECT apply_oid IS NOT NULL
         AND audit_oid IS NOT NULL
         AND has_function_privilege(current_user, apply_oid, 'EXECUTE')
         AND has_function_privilege(current_user, audit_oid, 'EXECUTE') AS ready
        FROM retention_functions
    `);
    if (!result.rows[0]?.ready) throw new Error("EU retention migration or jobs grant is missing");
  }
}

export class RetentionMaintenanceScheduler {
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;
  private stopping = true;

  constructor(
    private readonly maintenance: PostgresRetentionMaintenance,
    private readonly intervalMs: number,
  ) {}

  start(): void {
    if (!this.stopping) return;
    this.stopping = false;
    this.timer = setTimeout(() => this.run(), 0);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    await this.active;
  }

  private run(): void {
    if (this.stopping) return;
    this.active = this.maintenance.runOnce()
      .then(() => undefined)
      .catch((error) => captureException(error, { service: "jobs", operation: "retention-maintenance" }))
      .finally(() => {
        this.active = undefined;
        if (!this.stopping) this.timer = setTimeout(() => this.run(), this.intervalMs);
      });
  }
}
