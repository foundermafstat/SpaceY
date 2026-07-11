import { Queue, Worker, type ConnectionOptions, type Job } from "bullmq";
import type { DomainEventJob } from "./domain.js";
import { IdempotentJobProcessor } from "./idempotent-processor.js";
import type { JobDispatcher } from "./ports.js";

export function valkeyConnectionOptions(connectionUrl: string): ConnectionOptions {
  const url = new URL(connectionUrl);
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") throw new Error("VALKEY_URL must use redis:// or rediss://");
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    tls: url.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

export class BullMqDispatcher implements JobDispatcher {
  private readonly queue: Queue<DomainEventJob>;

  constructor(queueName: string, connection: ConnectionOptions) {
    this.queue = new Queue<DomainEventJob>(queueName, { connection });
  }

  async dispatch(job: DomainEventJob): Promise<void> {
    await this.queue.add(job.eventType, job, {
      jobId: job.outboxEventId,
      attempts: 8,
      backoff: { type: "exponential", delay: 1_000 },
      removeOnComplete: { age: 86_400, count: 20_000 },
      removeOnFail: { age: 604_800, count: 50_000 },
    });
  }

  async ready(): Promise<void> {
    await this.queue.waitUntilReady();
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

export function createBullMqWorker(input: {
  queueName: string;
  connection: ConnectionOptions;
  concurrency: number;
  processor: IdempotentJobProcessor;
}): Worker<DomainEventJob> {
  return new Worker<DomainEventJob>(input.queueName, (job: Job<DomainEventJob>) => input.processor.process(job.data), {
    connection: input.connection,
    concurrency: input.concurrency,
  });
}
