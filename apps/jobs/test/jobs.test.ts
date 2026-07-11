import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { DomainEventJob, OutboxEvent } from "../src/domain.js";
import { IdempotentJobProcessor, payloadHash } from "../src/idempotent-processor.js";
import { OutboxPump } from "../src/outbox-pump.js";
import type { JobDispatcher, JobIdempotencyRepository, OutboxRepository } from "../src/ports.js";
import {
  FetchWebhookTransport,
  WebhookFanoutHandler,
  isPublicWebhookEventType,
  signWebhook,
  type WebhookRepository,
  type WebhookTransport,
} from "../src/webhook-handler.js";

const event: OutboxEvent = {
  id: "01900000-0000-7000-8000-000000000001",
  aggregateType: "mission-attempt",
  aggregateId: "attempt-1",
  eventType: "mission.completed",
  payload: { reward: 300 },
  idempotencyKey: "mission:attempt-1:complete",
  attemptCount: 1,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

test("outbox marks an event published only after queue dispatch", async () => {
  const calls: string[] = [];
  const repository: OutboxRepository = {
    claimBatch: async () => [event],
    markPublished: async () => { calls.push("published"); },
    release: async () => { calls.push("released"); },
    ping: async () => undefined,
    close: async () => undefined,
  };
  const dispatcher: JobDispatcher = {
    dispatch: async () => { calls.push("dispatched"); },
    ready: async () => undefined,
    close: async () => undefined,
  };
  const pump = new OutboxPump(repository, dispatcher, { workerId: "worker", batchSize: 10, leaseMs: 1_000, maxAttempts: 3 });
  assert.equal(await pump.runBatch(), 1);
  assert.deepEqual(calls, ["dispatched", "published"]);
});

test("completed idempotency key skips the domain handler", async () => {
  let handled = 0;
  const repository: JobIdempotencyRepository = {
    acquire: async () => "succeeded",
    markSucceeded: async () => undefined,
    markFailed: async () => undefined,
  };
  const job: DomainEventJob = {
    outboxEventId: event.id,
    idempotencyKey: event.idempotencyKey,
    eventType: event.eventType,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    payload: event.payload,
    occurredAt: event.createdAt.toISOString(),
  };
  const processor = new IdempotentJobProcessor(repository, new Map([[event.eventType, { handle: async () => { handled += 1; } }]]), "events", 10_000);
  assert.deepEqual(await processor.process(job), { duplicate: true });
  assert.equal(handled, 0);
  assert.equal(payloadHash(job), payloadHash({ ...job, payload: { reward: 300 } }));
});

test("wildcard domain handler processes registered outbox events", async () => {
  let handled = 0;
  const repository: JobIdempotencyRepository = {
    acquire: async () => "acquired",
    markSucceeded: async () => undefined,
    markFailed: async () => undefined,
  };
  const job = asJob(event);
  const processor = new IdempotentJobProcessor(repository, new Map([["*", {
    handle: async () => { handled += 1; return { ok: true }; },
  }]]), "events", 10_000);
  assert.deepEqual(await processor.process(job), { ok: true });
  assert.equal(handled, 1);
});

test("webhook fanout signs and records successful delivery", async () => {
  const secretHash = createHash("sha256").update("subscriber-secret").digest("hex");
  const delivered: Array<[string, number]> = [];
  let sent: Parameters<WebhookTransport["send"]>[0] | undefined;
  const repository: WebhookRepository = {
    claim: async () => [{ id: "delivery-1", url: "https://example.com/events", secretHash, attemptCount: 1 }],
    markDelivered: async (id, status) => { delivered.push([id, status]); },
    markFailed: async () => assert.fail("successful delivery cannot be marked failed"),
  };
  const transport: WebhookTransport = {
    send: async (input) => { sent = input; return 204; },
  };
  const job = asJob(event);
  const handler = new WebhookFanoutHandler(repository, transport, 3);
  assert.deepEqual(await handler.handle(job), { matched: 1, delivered: 1, dead: 0 });
  assert.deepEqual(delivered, [["delivery-1", 204]]);
  assert.ok(sent);
  assert.deepEqual(JSON.parse(sent.body), {
    id: event.id,
    type: event.eventType,
    apiVersion: "1.0",
    createdAt: event.createdAt.toISOString(),
    data: {
      aggregate: { type: event.aggregateType, id: event.aggregateId },
      payload: event.payload,
    },
  });
  const timestamp = sent.headers["x-spacey-timestamp"];
  assert.ok(timestamp);
  assert.equal(
    sent.headers["x-spacey-signature"],
    `v1=${signWebhook(secretHash, timestamp, job.outboxEventId, sent.body)}`,
  );
});

test("webhook transport rejects loopback destinations before network I/O", async () => {
  const transport = new FetchWebhookTransport(500);
  await assert.rejects(() => transport.send({
    url: "https://127.0.0.1/hook",
    body: "{}",
    headers: { "content-type": "application/json" },
  }), /non-public address/);
});

test("public webhook allowlist excludes player and economy events", () => {
  assert.equal(isPublicWebhookEventType("content.release.published"), true);
  assert.equal(isPublicWebhookEventType("battle.result.finalized"), false);
  assert.equal(isPublicWebhookEventType("economy.wallet.adjusted"), false);
});

test("webhook fanout retries transient failure and dead-letters the terminal attempt", async () => {
  const secretHash = createHash("sha256").update("subscriber-secret").digest("hex");
  const failed: Array<{ dead: boolean }> = [];
  const deliveries = [
    { id: "retry", url: "https://example.com/events", secretHash, attemptCount: 1 },
    { id: "dead", url: "https://example.com/events", secretHash, attemptCount: 3 },
  ];
  const repository: WebhookRepository = {
    claim: async () => [deliveries.shift()!],
    markDelivered: async () => assert.fail("failed delivery cannot be marked delivered"),
    markFailed: async (_id, input) => { failed.push({ dead: input.dead }); },
  };
  const transport: WebhookTransport = { send: async () => 503 };
  const handler = new WebhookFanoutHandler(repository, transport, 3);
  await assert.rejects(() => handler.handle(asJob(event)), /Retryable webhook deliveries/);
  assert.deepEqual(await handler.handle(asJob(event)), { matched: 1, delivered: 0, dead: 1 });
  assert.deepEqual(failed, [{ dead: false }, { dead: true }]);
});

function asJob(source: OutboxEvent): DomainEventJob {
  return {
    outboxEventId: source.id,
    idempotencyKey: source.idempotencyKey,
    eventType: source.eventType,
    aggregateType: source.aggregateType,
    aggregateId: source.aggregateId,
    payload: source.payload,
    occurredAt: source.createdAt.toISOString(),
  };
}
