import { randomBytes, createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type {
  ApplyShipBuildCommandsRequestDto,
  BattleConnectionDto,
  CreateMissionAttemptRequestDto,
  LegacyBuildImportProposalDto,
  MissionAttemptStatusDto,
} from "@spacey/contracts";
import { BATTLE_PROTOCOL_VERSION } from "@spacey/protocol";
import { env } from "../config/env.js";
import { ApiError } from "../common/api-error.js";
import { PLATFORM_REPOSITORY, type MissionAttemptRecord, type PlatformRepository } from "../platform/platform.repository.js";
import { BattleTicketStore } from "../battle/battle-ticket.store.js";
import { routedBattleWebsocketUrl } from "../battle/battle-routing.js";

@Injectable()
export class GameService {
  constructor(
    @Inject(PLATFORM_REPOSITORY) private readonly repository: PlatformRepository,
    private readonly tickets: BattleTicketStore
  ) {}

  bootstrap(userId: string) {
    return this.repository.getBootstrap(userId);
  }

  applyBuildCommands(userId: string, buildId: string, input: ApplyShipBuildCommandsRequestDto) {
    return this.repository.applyBuildCommands(userId, buildId, input);
  }

  importLegacyBuild(userId: string, proposal: LegacyBuildImportProposalDto) {
    return this.repository.importLegacyBuild(userId, proposal);
  }

  async createMissionAttempt(userId: string, input: CreateMissionAttemptRequestDto): Promise<MissionAttemptStatusDto> {
    const attempt = await this.repository.createMissionAttempt({
      userId,
      missionId: input.missionId,
      shipBuildRevisionId: input.shipBuildRevisionId,
      idempotencyKey: input.idempotencyKey,
    });
    const status = await this.repository.getMissionAttemptStatus(userId, attempt.attemptId);
    if (!status) throw new ApiError("mission_attempt_missing", 500, "Created mission attempt could not be loaded.");
    return status;
  }

  async reconnectMissionAttempt(userId: string, attemptId: string): Promise<BattleConnectionDto | null> {
    const rawTicket = randomBytes(32).toString("base64url");
    const ticketExpiresAt = new Date(Date.now() + 30_000);
    const attempt = await this.repository.renewMissionAttemptTicket({
      userId,
      attemptId,
      ticketHash: createHash("sha256").update(rawTicket).digest("hex"),
      ticketExpiresAt
    });
    return attempt ? this.issueConnection(rawTicket, ticketExpiresAt, userId, attempt) : null;
  }

  private async issueConnection(
    rawTicket: string,
    ticketExpiresAt: Date,
    userId: string,
    attempt: MissionAttemptRecord,
  ): Promise<BattleConnectionDto> {
    await this.tickets.issueDefinition(attempt.sessionId, { kind: "pve", userId, simulationConfig: attempt.simulationConfig });
    await this.tickets.rotatePveTicket({
      rawTicket,
      previousTicketHash: attempt.previousTicketHash,
      ticketVersion: attempt.ticketVersion,
      claims: {
        sessionId: attempt.sessionId,
        attemptId: attempt.attemptId,
        mode: attempt.mode,
        userId,
      },
    });
    return {
      sessionId: attempt.sessionId,
      attemptId: attempt.attemptId,
      mode: attempt.mode,
      websocketUrl: routedBattleWebsocketUrl(env.BATTLE_WS_PUBLIC_URL, attempt.sessionId),
      ticket: rawTicket,
      ticketExpiresAt: ticketExpiresAt.toISOString(),
      protocolVersion: BATTLE_PROTOCOL_VERSION
    };
  }

  getAttemptStatus(userId: string, attemptId: string) {
    return this.repository.getMissionAttemptStatus(userId, attemptId);
  }

  async abandonMissionAttempt(userId: string, attemptId: string) {
    const status = await this.repository.abandonMissionAttempt(userId, attemptId);
    if (status) await this.tickets.revokeAttempt(attemptId);
    return status;
  }
}
