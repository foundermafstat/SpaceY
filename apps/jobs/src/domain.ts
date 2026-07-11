export type OutboxEvent = Readonly<{
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  idempotencyKey: string;
  attemptCount: number;
  createdAt: Date;
}>;

export type DomainEventJob = Readonly<{
  outboxEventId: string;
  idempotencyKey: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
  occurredAt: string;
}>;

export type ClaimedJob = "acquired" | "succeeded" | "busy";
