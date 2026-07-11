import { Inject, Injectable } from "@nestjs/common";
import { IsIn, IsInt, IsNotEmpty, IsNotEmptyObject, IsNotIn, IsObject, IsString, IsUUID, Max, MaxLength, Min } from "class-validator";
import type { FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import {
  ADMIN_MUTATION_UNIT_OF_WORK,
  type AdminMutationUnitOfWork,
  type ContentMutationCommand,
  type EconomyAdjustmentCommand,
} from "../audit/admin-mutation.port.js";
import { getAdminPrincipal } from "../security/admin-security.js";

const CONTENT_RESOURCE_TYPES = ["mission", "module", "enemy", "drop-table"] as const;
const WALLET_CURRENCIES = ["credits", "scrap", "alloy", "dataShards"] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function correlationIdForRequest(requestId: string | undefined): string {
  return requestId && UUID_PATTERN.test(requestId) ? requestId : randomUUID();
}

export class ContentMutationDto {
  @IsIn(CONTENT_RESOURCE_TYPES)
  resourceType!: ContentMutationCommand["resourceType"];

  @IsUUID()
  resourceId!: string;

  @IsInt()
  @Min(0)
  expectedRevision!: number;

  @IsObject()
  @IsNotEmptyObject()
  payload!: Record<string, unknown>;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class EconomyAdjustmentDto {
  @IsUUID()
  playerId!: string;

  @IsIn(WALLET_CURRENCIES)
  currency!: EconomyAdjustmentCommand["currency"];

  @IsInt()
  @IsNotIn([0])
  @Min(-1_000_000_000)
  @Max(1_000_000_000)
  amount!: number;

  @IsUUID()
  idempotencyKey!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  caseId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

@Injectable()
export class AdminMutationService {
  constructor(@Inject(ADMIN_MUTATION_UNIT_OF_WORK) private readonly unitOfWork: AdminMutationUnitOfWork) {}

  async mutateContent(request: FastifyRequest, input: ContentMutationDto) {
    const actor = getAdminPrincipal(request);
    const correlationId = correlationIdForRequest(request.id);
    return this.unitOfWork.transaction(async (transaction) => {
      const record = await transaction.applyContentRevision({
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        expectedRevision: input.expectedRevision,
        payload: input.payload,
        reason: input.reason,
        actor,
      });
      await transaction.appendAudit({
        action: "content.revision.applied",
        resourceType: input.resourceType,
        resourceId: record.resourceId,
        reason: input.reason,
        correlationId,
        before: record.before,
        after: record.after,
        actor,
      });
      return { resourceId: record.resourceId, revision: record.revision, correlationId };
    });
  }

  async adjustEconomy(request: FastifyRequest, input: EconomyAdjustmentDto) {
    const actor = getAdminPrincipal(request);
    const correlationId = correlationIdForRequest(request.id);
    return this.unitOfWork.transaction(async (transaction) => {
      const record = await transaction.applyEconomyAdjustment({
        playerId: input.playerId,
        currency: input.currency,
        amount: input.amount,
        idempotencyKey: input.idempotencyKey,
        caseId: input.caseId,
        reason: input.reason,
        actor,
      });
      await transaction.appendAudit({
        action: "economy.wallet.adjusted",
        resourceType: "player-wallet",
        resourceId: record.resourceId,
        reason: input.reason,
        caseId: input.caseId,
        correlationId,
        before: record.before,
        after: record.after,
        actor,
      });
      return { playerId: record.resourceId, revision: record.revision, correlationId };
    });
  }
}
