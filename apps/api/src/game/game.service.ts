import { randomBytes, createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { ApplyShipBuildCommandsRequestDto, BattleConnectionDto, CreateMissionAttemptRequestDto, LegacyBuildImportProposalDto } from "@spacey/contracts";
import { BATTLE_PROTOCOL_VERSION } from "@spacey/protocol";
import { env } from "../config/env.js";
import { PLATFORM_REPOSITORY, type PlatformRepository } from "../platform/platform.repository.js";
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

  async createMissionAttempt(userId: string, input: CreateMissionAttemptRequestDto): Promise<BattleConnectionDto> {
    const rawTicket = randomBytes(32).toString("base64url");
    const ticketHash = createHash("sha256").update(rawTicket).digest("hex");
    const ticketExpiresAt = new Date(Date.now() + 30_000);
    const attempt = await this.repository.createMissionAttempt({
      userId,
      missionId: input.missionId,
      shipBuildRevisionId: input.shipBuildRevisionId,
      idempotencyKey: input.idempotencyKey,
      ticketHash,
      ticketExpiresAt
    });
    return this.issueConnection(rawTicket, ticketExpiresAt, userId, attempt);
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
    attempt: { sessionId: string; attemptId: string; mode: "pve"; simulationConfig: import("@spacey/simulation").MissionSimulationConfig }
  ): Promise<BattleConnectionDto> {
    await this.tickets.issueDefinition(attempt.sessionId, { kind: "pve", userId, simulationConfig: attempt.simulationConfig });
    await this.tickets.issue(rawTicket, {
      sessionId: attempt.sessionId,
      attemptId: attempt.attemptId,
      mode: attempt.mode,
      userId
    });
    return {
      ...attempt,
      websocketUrl: routedBattleWebsocketUrl(env.BATTLE_WS_PUBLIC_URL, attempt.sessionId),
      ticket: rawTicket,
      ticketExpiresAt: ticketExpiresAt.toISOString(),
      protocolVersion: BATTLE_PROTOCOL_VERSION
    };
  }

  getAttemptStatus(userId: string, attemptId: string) {
    return this.repository.getMissionAttemptStatus(userId, attemptId);
  }
}
