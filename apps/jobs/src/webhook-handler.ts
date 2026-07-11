import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Pool, QueryResultRow } from "pg";
import { v7 as uuidv7 } from "uuid";
import type { DomainEventJob } from "./domain.js";
import type { DomainEventHandler } from "./ports.js";

export type WebhookDelivery = Readonly<{
  id: string;
  url: string;
  secretHash: string;
  attemptCount: number;
}>;

export interface WebhookRepository {
  claim(job: DomainEventJob): Promise<readonly WebhookDelivery[]>;
  markDelivered(id: string, responseStatus: number): Promise<void>;
  markFailed(id: string, input: {
    responseStatus: number | null;
    error: string;
    dead: boolean;
    retryAt: Date;
  }): Promise<void>;
}

export interface WebhookTransport {
  send(input: {
    url: string;
    body: string;
    headers: Readonly<Record<string, string>>;
  }): Promise<number>;
}

type SubscriptionRow = QueryResultRow & {
  subscriptionId: string;
  url: string;
  secretHash: string;
};

type DeliveryRow = QueryResultRow & {
  id: string;
  url: string;
  secretHash: string;
  attemptCount: number;
};

export class PostgresWebhookRepository implements WebhookRepository {
  constructor(private readonly pool: Pool) {}

  async claim(job: DomainEventJob): Promise<readonly WebhookDelivery[]> {
    if (!isPublicWebhookEventType(job.eventType)) return [];
    const subscriptions = await this.pool.query<SubscriptionRow>(`
      SELECT id AS "subscriptionId", url, secret_hash AS "secretHash"
      FROM webhook_subscriptions
      WHERE status = 'ACTIVE'::webhook_status
        AND event_types @> ARRAY[$1]::text[]
      ORDER BY id
    `, [job.eventType]);
    const claimed: WebhookDelivery[] = [];

    for (const subscription of subscriptions.rows) {
      const result = await this.pool.query<DeliveryRow>(`
        INSERT INTO webhook_deliveries
          (id, webhook_subscription_id, outbox_event_id, event_id, status, attempt_count, updated_at)
        VALUES ($1, $2, $3, $3, 'DELIVERING'::webhook_delivery_status, 1, NOW())
        ON CONFLICT (webhook_subscription_id, event_id) DO UPDATE
          SET outbox_event_id = COALESCE(webhook_deliveries.outbox_event_id, EXCLUDED.outbox_event_id),
              status = 'DELIVERING'::webhook_delivery_status,
              attempt_count = webhook_deliveries.attempt_count + 1,
              updated_at = NOW()
        WHERE webhook_deliveries.status IN ('PENDING'::webhook_delivery_status, 'FAILED'::webhook_delivery_status)
           OR (webhook_deliveries.status = 'DELIVERING'::webhook_delivery_status
             AND webhook_deliveries.updated_at < NOW() - INTERVAL '2 minutes')
        RETURNING id, $4::text AS url, $5::text AS "secretHash", attempt_count AS "attemptCount"
      `, [uuidv7(), subscription.subscriptionId, job.outboxEventId, subscription.url, subscription.secretHash]);
      const row = result.rows[0];
      if (row) claimed.push(row);
    }
    return claimed;
  }

  async markDelivered(id: string, responseStatus: number): Promise<void> {
    await this.pool.query(`
      UPDATE webhook_deliveries
         SET status = 'DELIVERED'::webhook_delivery_status,
             response_status = $2,
             last_error = NULL,
             delivered_at = NOW(),
             next_attempt_at = NULL,
             updated_at = NOW()
       WHERE id = $1 AND status = 'DELIVERING'::webhook_delivery_status
    `, [id, responseStatus]);
  }

  async markFailed(id: string, input: {
    responseStatus: number | null;
    error: string;
    dead: boolean;
    retryAt: Date;
  }): Promise<void> {
    await this.pool.query(`
      UPDATE webhook_deliveries
         SET status = $2::webhook_delivery_status,
             response_status = $3,
             last_error = LEFT($4, 2000),
             next_attempt_at = CASE WHEN $2 = 'DEAD' THEN NULL ELSE $5 END,
             updated_at = NOW()
       WHERE id = $1 AND status = 'DELIVERING'::webhook_delivery_status
    `, [id, input.dead ? "DEAD" : "FAILED", input.responseStatus, input.error, input.retryAt]);
  }
}

const PUBLIC_WEBHOOK_EVENT_TYPES = new Set([
  "content.release.published",
  "leaderboard.updated",
  "season.started",
  "season.ended",
  "aggregate.stats.updated",
]);

export function isPublicWebhookEventType(eventType: string): boolean {
  return PUBLIC_WEBHOOK_EVENT_TYPES.has(eventType);
}

export class WebhookFanoutHandler implements DomainEventHandler {
  constructor(
    private readonly repository: WebhookRepository,
    private readonly transport: WebhookTransport,
    private readonly maxAttempts: number,
  ) {}

  async handle(job: DomainEventJob): Promise<unknown> {
    const body = canonicalJson({
      id: job.outboxEventId,
      type: job.eventType,
      apiVersion: "1.0",
      createdAt: job.occurredAt,
      data: {
        aggregate: { type: job.aggregateType, id: job.aggregateId },
        payload: job.payload,
      },
    });
    const timestamp = Math.floor(Date.now() / 1_000).toString();
    const deliveries = await this.repository.claim(job);
    const retryable: string[] = [];
    let delivered = 0;
    let dead = 0;

    for (const delivery of deliveries) {
      const signature = signWebhook(delivery.secretHash, timestamp, job.outboxEventId, body);
      let responseStatus: number | null = null;
      let error = "Webhook delivery failed";
      try {
        responseStatus = await this.transport.send({
          url: delivery.url,
          body,
          headers: {
            "content-type": "application/json",
            "user-agent": "SpaceY-Webhooks/1.0",
            "x-spacey-event-id": job.outboxEventId,
            "x-spacey-event-type": job.eventType,
            "x-spacey-timestamp": timestamp,
            "x-spacey-signature": `v1=${signature}`,
          },
        });
        if (responseStatus >= 200 && responseStatus < 300) {
          await this.repository.markDelivered(delivery.id, responseStatus);
          delivered += 1;
          continue;
        }
        error = `Webhook returned HTTP ${responseStatus}`;
      } catch (cause) {
        error = cause instanceof Error ? `${cause.name}: ${cause.message}` : error;
      }

      const isDead = delivery.attemptCount >= this.maxAttempts;
      await this.repository.markFailed(delivery.id, {
        responseStatus,
        error,
        dead: isDead,
        retryAt: new Date(Date.now() + retryDelayMs(delivery.attemptCount)),
      });
      if (isDead) dead += 1;
      else retryable.push(delivery.id);
    }

    if (retryable.length > 0) throw new Error(`Retryable webhook deliveries: ${retryable.length}`);
    return { matched: deliveries.length, delivered, dead };
  }
}

export class FetchWebhookTransport implements WebhookTransport {
  constructor(private readonly timeoutMs: number) {}

  async send(input: {
    url: string;
    body: string;
    headers: Readonly<Record<string, string>>;
  }): Promise<number> {
    await assertPublicHttpsUrl(input.url);
    const response = await fetch(input.url, {
      method: "POST",
      headers: input.headers,
      body: input.body,
      redirect: "manual",
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (response.status >= 300 && response.status < 400) throw new Error("Webhook redirects are forbidden");
    await response.body?.cancel();
    return response.status;
  }
}

export function signWebhook(secretHash: string, timestamp: string, eventId: string, body: string): string {
  if (!/^[a-f\d]{64}$/i.test(secretHash)) throw new Error("Webhook signing key hash is invalid");
  return createHmac("sha256", Buffer.from(secretHash, "hex"))
    .update(`${timestamp}.${eventId}.${body}`)
    .digest("hex");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

async function assertPublicHttpsUrl(rawUrl: string): Promise<void> {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Webhook URL must be credential-free HTTPS");
  }
  const addresses = isIP(url.hostname)
    ? [{ address: url.hostname, family: isIP(url.hostname) }]
    : await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error("Webhook URL resolves to a non-public address");
  }
}

function isPublicAddress(address: string): boolean {
  if (address.includes(":")) {
    const normalized = address.toLowerCase();
    if (normalized === "::" || normalized === "::1" || normalized.startsWith("fc")
      || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized)) return false;
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    return mapped ? isPublicAddress(mapped) : true;
  }
  const octets = address.split(".").map(Number);
  const [a, b] = octets;
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    || a === undefined || b === undefined) return false;
  return !(a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168))
    || (a === 198 && (b === 18 || b === 19)));
}

function retryDelayMs(attempt: number): number {
  return Math.min(15 * 60_000, 1_000 * (2 ** Math.min(Math.max(0, attempt - 1), 10)));
}
