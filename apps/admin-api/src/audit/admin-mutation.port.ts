import type { AdminPrincipal } from "../security/admin-security.js";

export type AuditActor = Pick<AdminPrincipal, "adminId" | "sessionId" | "role" | "authenticationMethod">;

export type AdminAuditEntry = Readonly<{
  action: string;
  resourceType: string;
  resourceId: string;
  reason: string;
  caseId?: string;
  correlationId: string;
  before: unknown;
  after: unknown;
  actor: AuditActor;
}>;

export type ContentMutationCommand = Readonly<{
  resourceType: "mission" | "module" | "enemy" | "drop-table";
  resourceId: string;
  expectedRevision: number;
  payload: Record<string, unknown>;
  reason: string;
  actor: AuditActor;
}>;

export type EconomyAdjustmentCommand = Readonly<{
  playerId: string;
  currency: "credits" | "scrap" | "alloy" | "dataShards";
  amount: number;
  idempotencyKey: string;
  caseId: string;
  reason: string;
  actor: AuditActor;
}>;

export type MutationRecord = Readonly<{
  resourceId: string;
  revision: number;
  before: unknown;
  after: unknown;
}>;

export interface AdminMutationTransaction {
  applyContentRevision(command: ContentMutationCommand): Promise<MutationRecord>;
  applyEconomyAdjustment(command: EconomyAdjustmentCommand): Promise<MutationRecord>;
  appendAudit(entry: AdminAuditEntry): Promise<void>;
}

/** Mutation and immutable audit must commit or roll back in the same DB transaction. */
export interface AdminMutationUnitOfWork {
  transaction<T>(operation: (transaction: AdminMutationTransaction) => Promise<T>): Promise<T>;
}

export const ADMIN_MUTATION_UNIT_OF_WORK = Symbol("spacey.admin-mutation-unit-of-work");
