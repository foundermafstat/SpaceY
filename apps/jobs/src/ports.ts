import type { ClaimedJob, DomainEventJob, OutboxEvent } from "./domain.js";

export interface OutboxRepository {
  claimBatch(input: { workerId: string; limit: number; leaseMs: number }): Promise<readonly OutboxEvent[]>;
  markPublished(eventId: string, workerId: string): Promise<void>;
  release(input: { eventId: string; workerId: string; retryAt: Date; error: string; maxAttempts: number }): Promise<void>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

export interface JobIdempotencyRepository {
  acquire(input: { key: string; queue: string; jobName: string; payloadHash: string; leaseUntil: Date }): Promise<ClaimedJob>;
  markSucceeded(key: string, result: unknown): Promise<void>;
  markFailed(key: string, error: string): Promise<void>;
}

export interface JobDispatcher {
  dispatch(job: DomainEventJob): Promise<void>;
  ready(): Promise<void>;
  close(): Promise<void>;
}

export interface DomainEventHandler {
  handle(job: DomainEventJob): Promise<unknown>;
}
