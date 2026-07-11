import { createHash } from "node:crypto";
import { captureException } from "@spacey/observability";
import type { DomainEventJob } from "./domain.js";
import type { DomainEventHandler, JobIdempotencyRepository } from "./ports.js";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

export function payloadHash(job: DomainEventJob): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(job))).digest("hex");
}

export class JobLeaseBusyError extends Error {}

export class IdempotentJobProcessor {
  constructor(
    private readonly repository: JobIdempotencyRepository,
    private readonly handlers: ReadonlyMap<string, DomainEventHandler>,
    private readonly queueName: string,
    private readonly leaseMs: number,
  ) {}

  async process(job: DomainEventJob): Promise<unknown> {
    const handler = this.handlers.get(job.eventType) ?? this.handlers.get("*");
    if (!handler) throw new Error(`No handler registered for ${job.eventType}`);

    const claim = await this.repository.acquire({
      key: job.idempotencyKey,
      queue: this.queueName,
      jobName: job.eventType,
      payloadHash: payloadHash(job),
      leaseUntil: new Date(Date.now() + this.leaseMs),
    });
    if (claim === "succeeded") return { duplicate: true };
    if (claim === "busy") throw new JobLeaseBusyError(`Job ${job.idempotencyKey} is already running`);

    try {
      const result = await handler.handle(job);
      await this.repository.markSucceeded(job.idempotencyKey, result);
      return result;
    } catch (error) {
      captureException(error, { service: "jobs", operation: "domain-event", eventType: job.eventType });
      await this.repository.markFailed(job.idempotencyKey, error instanceof Error ? error.message : "Unknown job error");
      throw error;
    }
  }
}
