import type { DomainEventJob, OutboxEvent } from "./domain.js";
import { captureException } from "@spacey/observability";
import type { JobDispatcher, OutboxRepository } from "./ports.js";

function asJob(event: OutboxEvent): DomainEventJob {
  return {
    outboxEventId: event.id,
    idempotencyKey: event.idempotencyKey,
    eventType: event.eventType,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    payload: event.payload,
    occurredAt: event.createdAt.toISOString(),
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : "Unknown outbox dispatch error";
}

export class OutboxPump {
  constructor(
    private readonly repository: OutboxRepository,
    private readonly dispatcher: JobDispatcher,
    private readonly options: Readonly<{ workerId: string; batchSize: number; leaseMs: number; maxAttempts: number }>,
  ) {}

  async runBatch(): Promise<number> {
    const events = await this.repository.claimBatch({
      workerId: this.options.workerId,
      limit: this.options.batchSize,
      leaseMs: this.options.leaseMs,
    });

    for (const event of events) {
      try {
        await this.dispatcher.dispatch(asJob(event));
        await this.repository.markPublished(event.id, this.options.workerId);
      } catch (error) {
        captureException(error, { service: "jobs", operation: "outbox-dispatch", eventType: event.eventType });
        const exponentialDelay = Math.min(60_000, 500 * (2 ** Math.min(event.attemptCount, 7)));
        await this.repository.release({
          eventId: event.id,
          workerId: this.options.workerId,
          retryAt: new Date(Date.now() + exponentialDelay),
          error: errorText(error),
          maxAttempts: this.options.maxAttempts,
        });
      }
    }
    return events.length;
  }
}
