import type { OnApplicationShutdown } from "@nestjs/common";
import { createUuidV7 } from "@spacey/db/uuidv7";
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import type {
  DependencyReadiness,
  NotificationPort,
  ReferralPort,
  SupportPort,
  UpdateDeduplicator,
} from "../application/ports.js";
import type { TelegramBotConfig } from "../config.js";

export interface TelegramPgPool {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
}

type UpdateStatusRow = Readonly<{ status: "PROCESSING" | "COMPLETED" }>;
type IdRow = Readonly<{ id: string }>;

const REFERRAL_CODE = /^[A-Za-z0-9_-]{1,64}$/;

export class TelegramPostgresAdapter implements
  UpdateDeduplicator,
  ReferralPort,
  SupportPort,
  NotificationPort,
  DependencyReadiness,
  OnApplicationShutdown {
  private readonly leaseSeconds: number;

  constructor(
    private readonly pool: TelegramPgPool,
    config: Pick<TelegramBotConfig, "processingLeaseSeconds">,
  ) {
    this.leaseSeconds = config.processingLeaseSeconds;
  }

  static create(config: TelegramBotConfig): TelegramPostgresAdapter {
    return new TelegramPostgresAdapter(new Pool({
      connectionString: config.databaseUrl,
      application_name: "spacey-telegram-bot",
      max: config.databasePoolSize,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    }), config);
  }

  async claim(updateId: number): Promise<"claimed" | "duplicate" | "busy"> {
    const claimed = await this.pool.query<UpdateStatusRow>(`
      INSERT INTO telegram_bot_updates (
        update_id, status, claimed_at, completed_at, attempt_count, created_at, updated_at
      ) VALUES ($1, 'PROCESSING', NOW(), NULL, 1, NOW(), NOW())
      ON CONFLICT (update_id) DO UPDATE SET
        claimed_at = NOW(),
        completed_at = NULL,
        attempt_count = telegram_bot_updates.attempt_count + 1,
        updated_at = NOW()
      WHERE telegram_bot_updates.status = 'PROCESSING'
        AND telegram_bot_updates.claimed_at <= NOW() - ($2::integer * INTERVAL '1 second')
      RETURNING status
    `, [BigInt(updateId), this.leaseSeconds]);

    if (claimed.rowCount === 1) return "claimed";

    const existing = await this.pool.query<UpdateStatusRow>(`
      SELECT status
      FROM telegram_bot_updates
      WHERE update_id = $1
    `, [BigInt(updateId)]);
    return existing.rows[0]?.status === "COMPLETED" ? "duplicate" : "busy";
  }

  async complete(updateId: number): Promise<void> {
    const completed = await this.pool.query(`
      UPDATE telegram_bot_updates
      SET status = 'COMPLETED', completed_at = NOW(), updated_at = NOW()
      WHERE update_id = $1 AND status = 'PROCESSING'
    `, [BigInt(updateId)]);
    if (completed.rowCount !== 1) throw new Error("Telegram update claim was lost before completion");
  }

  async release(updateId: number): Promise<void> {
    await this.pool.query(`
      UPDATE telegram_bot_updates
      SET claimed_at = NOW() - (($2::integer + 1) * INTERVAL '1 second'), updated_at = NOW()
      WHERE update_id = $1 AND status = 'PROCESSING'
    `, [BigInt(updateId), this.leaseSeconds]);
  }

  async recordReferral(input: { telegramUserId: number; referralCode: string; updateId: number }): Promise<void> {
    if (!REFERRAL_CODE.test(input.referralCode)) throw new TypeError("Invalid referral code");
    await this.pool.query(`
      INSERT INTO telegram_referrals (
        id, telegram_user_id, referral_code, telegram_update_id, created_at
      ) VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (telegram_update_id) DO NOTHING
    `, [createUuidV7(), BigInt(input.telegramUserId), input.referralCode, BigInt(input.updateId)]);
  }

  async openRequest(input: { telegramUserId: number; chatId: number; updateId: number }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const ticket = await client.query<IdRow>(`
        INSERT INTO telegram_support_tickets (
          id, telegram_user_id, chat_id, status, opened_at, created_at, updated_at
        ) VALUES ($1, $2, $3, 'OPEN', NOW(), NOW(), NOW())
        ON CONFLICT (telegram_user_id) WHERE status = 'OPEN' DO UPDATE SET
          chat_id = EXCLUDED.chat_id,
          updated_at = NOW()
        RETURNING id
      `, [createUuidV7(), BigInt(input.telegramUserId), BigInt(input.chatId)]);
      const ticketId = ticket.rows[0]?.id;
      if (!ticketId) throw new Error("Support ticket was not created");

      await client.query(`
        INSERT INTO telegram_support_messages (
          id, ticket_id, telegram_update_id, telegram_user_id, chat_id, kind, text, created_at
        ) VALUES ($1, $2, $3, $4, $5, 'REQUEST', '/support', NOW())
        ON CONFLICT (telegram_update_id) DO NOTHING
      `, [createUuidV7(), ticketId, BigInt(input.updateId), BigInt(input.telegramUserId), BigInt(input.chatId)]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async routeMessage(input: { telegramUserId: number; chatId: number; text: string; updateId: number }): Promise<boolean> {
    if (input.text.length < 1 || input.text.length > 4_096) throw new TypeError("Support message length is invalid");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const ticket = await client.query<IdRow>(`
        SELECT id
        FROM telegram_support_tickets
        WHERE telegram_user_id = $1 AND status = 'OPEN'
        ORDER BY opened_at DESC
        LIMIT 1
        FOR UPDATE
      `, [BigInt(input.telegramUserId)]);
      const ticketId = ticket.rows[0]?.id;
      if (!ticketId) {
        await client.query("COMMIT");
        return false;
      }

      await client.query(`
        INSERT INTO telegram_support_messages (
          id, ticket_id, telegram_update_id, telegram_user_id, chat_id, kind, text, created_at
        ) VALUES ($1, $2, $3, $4, $5, 'MESSAGE', $6, NOW())
        ON CONFLICT (telegram_update_id) DO NOTHING
      `, [createUuidV7(), ticketId, BigInt(input.updateId), BigInt(input.telegramUserId), BigInt(input.chatId), input.text]);
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async setPreference(input: { telegramUserId: number; enabled: boolean; updateId: number }): Promise<void> {
    await this.pool.query(`
      INSERT INTO telegram_notification_preferences (
        telegram_user_id, enabled, source_update_id, created_at, updated_at
      ) VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT (telegram_user_id) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        source_update_id = EXCLUDED.source_update_id,
        updated_at = NOW()
      WHERE telegram_notification_preferences.source_update_id <= EXCLUDED.source_update_id
    `, [BigInt(input.telegramUserId), input.enabled, BigInt(input.updateId)]);
  }

  async check(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
