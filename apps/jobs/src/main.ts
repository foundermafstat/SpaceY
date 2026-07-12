import { Pool } from "pg";
import { BullMqDispatcher, createBullMqWorker, valkeyConnectionOptions } from "./bullmq-adapter.js";
import { loadJobsConfig } from "./config.js";
import { IdempotentJobProcessor } from "./idempotent-processor.js";
import { OutboxPump } from "./outbox-pump.js";
import { PostgresJobIdempotencyRepository, PostgresOutboxRepository } from "./postgres-repositories.js";
import { JobsRuntime } from "./runtime.js";
import { PostgresRetentionMaintenance, RetentionMaintenanceScheduler } from "./retention-maintenance.js";
import {
  PostgresPrivacyWorkflowRepository,
  PrivacyDeleteHandler,
  PrivacyExportHandler,
  UnconfiguredPrivacyExportObjectStore,
} from "./privacy-handler.js";
import { S3PrivacyExportObjectStore } from "./s3-privacy-export-store.js";
import type { DomainEventHandler } from "./ports.js";
import { FetchWebhookTransport, PostgresWebhookRepository, WebhookFanoutHandler } from "./webhook-handler.js";
import {
  PostgresStaleAttemptMaintenance,
  StaleAttemptCleanupHandler,
  StaleAttemptMaintenanceScheduler,
  STALE_ATTEMPT_EVENT_TYPE,
  ValkeyStaleAttemptRouteStore,
} from "./stale-attempt-maintenance.js";

async function bootstrap() {
  const config = loadJobsConfig();
  const pool = new Pool({ connectionString: config.databaseUrl, max: Math.max(4, Math.ceil(config.concurrency / 4)) });
  const outbox = new PostgresOutboxRepository(pool);
  const idempotency = new PostgresJobIdempotencyRepository(pool);
  const connection = valkeyConnectionOptions(config.valkeyUrl);
  const dispatcher = new BullMqDispatcher(config.queueName, connection);
  const webhookHandler = new WebhookFanoutHandler(
    new PostgresWebhookRepository(pool),
    new FetchWebhookTransport(config.webhookTimeoutMs),
    config.webhookMaxAttempts,
  );
  const privacyRepository = new PostgresPrivacyWorkflowRepository(pool);
  const retentionMaintenance = new PostgresRetentionMaintenance(pool, config.retentionBatchSize);
  const retentionScheduler = new RetentionMaintenanceScheduler(retentionMaintenance, config.retentionIntervalMs);
  const staleAttemptMaintenance = new PostgresStaleAttemptMaintenance(pool, config.staleAttemptSweepBatchSize);
  const staleAttemptScheduler = new StaleAttemptMaintenanceScheduler(staleAttemptMaintenance, config.staleAttemptSweepIntervalMs);
  const staleAttemptRouteStore = new ValkeyStaleAttemptRouteStore(connection);
  const privacyObjectStore = config.privacyExportStorage
    ? new S3PrivacyExportObjectStore(config.privacyExportStorage)
    : new UnconfiguredPrivacyExportObjectStore();
  const handlers = new Map<string, DomainEventHandler>([
    ["privacy.export.requested", new PrivacyExportHandler(privacyRepository, privacyObjectStore)],
    ["privacy.delete.requested", new PrivacyDeleteHandler(privacyRepository)],
    [STALE_ATTEMPT_EVENT_TYPE, new StaleAttemptCleanupHandler(staleAttemptRouteStore)],
    ["*", webhookHandler],
  ]);
  const processor = new IdempotentJobProcessor(idempotency, handlers, config.queueName, 120_000);
  const worker = createBullMqWorker({ queueName: config.queueName, connection, concurrency: config.concurrency, processor });
  const pump = new OutboxPump(outbox, dispatcher, { workerId: config.workerId, batchSize: 100, leaseMs: 30_000, maxAttempts: 12 });
  const runtime = new JobsRuntime(
    pump,
    outbox,
    dispatcher,
    worker,
    250,
    [privacyObjectStore, retentionMaintenance, staleAttemptMaintenance],
    {
      start: () => { retentionScheduler.start(); staleAttemptScheduler.start(); },
      stop: async () => { await Promise.all([retentionScheduler.stop(), staleAttemptScheduler.stop()]); },
    },
    [staleAttemptRouteStore],
  );

  await runtime.startHealthServer(config.healthPort, config.healthHost);
  startSignalHandlers(runtime);
  runtime.startPolling();
}

function startSignalHandlers(runtime: JobsRuntime): void {
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await runtime.stop();
    process.exitCode = 0;
  };
  process.once("SIGTERM", () => void stop());
  process.once("SIGINT", () => void stop());
}

void bootstrap();
