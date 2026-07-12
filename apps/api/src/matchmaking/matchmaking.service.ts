import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { CreateMatchmakingTicketRequestDto, MatchmakingTicketDto, PvpBattleParticipantConnectionDto } from "@spacey/contracts";
import { BATTLE_PROTOCOL_VERSION, PVP_DUEL_PROTOCOL_READY } from "@spacey/protocol";
import { ApiError } from "../common/api-error.js";
import { BattleTicketStore } from "../battle/battle-ticket.store.js";
import { routedBattleWebsocketUrl } from "../battle/battle-routing.js";
import { env } from "../config/env.js";
import {
  PLATFORM_REPOSITORY,
  type MatchmakingTicketRecord,
  type MaterializedPvpMatch,
  type PlatformRepository,
} from "../platform/platform.repository.js";
import { MatchmakingQueueStore } from "./matchmaking-queue.store.js";

export const MATCHMAKING_RUNTIME_CONFIG = Symbol("MATCHMAKING_RUNTIME_CONFIG");

export type MatchmakingRuntimeConfig = Readonly<{
  enabled: boolean;
  duelRuntimeReady: boolean;
}>;

@Injectable()
export class MatchmakingService {
  constructor(
    @Inject(PLATFORM_REPOSITORY) private readonly repository: PlatformRepository,
    private readonly queue: MatchmakingQueueStore,
    @Inject(MATCHMAKING_RUNTIME_CONFIG) private readonly runtime: MatchmakingRuntimeConfig,
    private readonly battleTickets: BattleTicketStore,
  ) {}

  async create(
    userId: string,
    input: CreateMatchmakingTicketRequestDto,
  ): Promise<MatchmakingTicketDto> {
    this.requireFoundationEnabled();
    let ticket = await this.repository.createMatchmakingTicket({
      userId,
      shipBuildRevisionId: input.shipBuildRevisionId,
      queue: input.queue,
      idempotencyKey: input.idempotencyKey,
    });
    if (ticket.status !== "queued") return this.dto(ticket);

    await this.queue.enqueue(ticket);
    const claim = await this.queue.tryMatch(ticket);
    if (claim) {
      let match: MaterializedPvpMatch;
      try {
        match = await this.repository.materializePvpMatch({
          callerUserId: userId,
          leftTicketId: claim.leftTicketId,
          rightTicketId: claim.rightTicketId,
        });
      } catch (error) {
        await this.queue.release(claim);
        throw error;
      }
      await this.publishPendingSession(match);
      // PostgreSQL is authoritative after materialization. A failed cache cleanup
      // must not roll back or requeue an already committed match.
      try {
        await this.queue.complete(claim);
      } catch {
        // The worker reconciles committed battle_sessions directly from PostgreSQL.
      }
      ticket = await this.repository.getMatchmakingTicket(userId, ticket.ticketId) ?? ticket;
    }
    return this.dto(ticket);
  }

  async get(userId: string, ticketId: string): Promise<MatchmakingTicketDto | null> {
    const ticket = await this.repository.getMatchmakingTicket(userId, ticketId);
    if (!ticket) return null;
    if (this.runtime.enabled && ticket.status === "queued") {
      await this.queue.enqueue(ticket);
      const claim = await this.queue.tryMatch(ticket);
      if (claim) {
        let match: MaterializedPvpMatch;
        try {
          match = await this.repository.materializePvpMatch({
            callerUserId: userId,
            leftTicketId: claim.leftTicketId,
            rightTicketId: claim.rightTicketId,
          });
        } catch (error) {
          await this.queue.release(claim);
          throw error;
        }
        await this.publishPendingSession(match);
        try { await this.queue.complete(claim); } catch { /* PostgreSQL reconciliation remains authoritative. */ }
        return this.dto(await this.repository.getMatchmakingTicket(userId, ticketId) ?? ticket);
      }
    }
    return this.dto(ticket);
  }

  async cancel(userId: string, ticketId: string): Promise<MatchmakingTicketDto | null> {
    const ticket = await this.repository.getMatchmakingTicket(userId, ticketId);
    if (!ticket) return null;
    if (ticket.status === "cancelled" || ticket.status === "expired" || ticket.status === "failed") return this.dto(ticket);
    if (ticket.status !== "queued") {
      throw new ApiError("matchmaking_ticket_not_cancellable", 409, "Matched ticket cannot be cancelled.");
    }
    const queueResult = await this.queue.cancel(ticket);
    if (queueResult === "claimed") {
      throw new ApiError("matchmaking_ticket_locked", 409, "Ticket is currently being matched. Retry status shortly.");
    }
    const cancelled = await this.repository.cancelMatchmakingTicket(userId, ticketId);
    return cancelled ? this.dto(cancelled) : null;
  }

  async connection(userId: string, ticketId: string): Promise<PvpBattleParticipantConnectionDto | null> {
    if (!this.runtime.duelRuntimeReady || !PVP_DUEL_PROTOCOL_READY) {
      throw new ApiError("pvp_duel_runtime_unavailable", 503, "Realtime PvP duel runtime is not ready.", {
        requiredCapability: "multi_connection_authoritative_session",
      });
    }
    const ticket = await this.repository.getMatchmakingTicket(userId, ticketId);
    if (!ticket) return null;
    if (ticket.status !== "matched" || !ticket.match) {
      throw new ApiError("pvp_match_not_ready", 409, "Matchmaking ticket does not have an active matched duel.");
    }
    const rawTicket = randomBytes(32).toString("base64url");
    const ticketHash = createHash("sha256").update(rawTicket).digest("hex");
    const ticketExpiresAt = new Date(Date.now() + 30_000);
    const connection = await this.repository.renewPvpConnectionTicket({
      userId,
      ticketId,
      ticketHash,
      ticketExpiresAt,
    });
    if (!connection) {
      throw new ApiError("pvp_match_not_resumable", 409, "PvP duel can no longer issue a participant ticket.");
    }
    await this.battleTickets.issueDefinition(connection.sessionId, {
      kind: "pvp",
      participants: connection.participants,
      simulationConfig: connection.simulationConfig,
    });
    await this.battleTickets.rotatePvpTicket({
      rawTicket,
      previousTicketHash: connection.previousTicketHash,
      ticketVersion: connection.ticketVersion,
      claims: {
        mode: "pvp",
        sessionId: connection.sessionId,
        attemptId: connection.attemptId,
        userId,
        matchId: connection.matchId,
        participantId: connection.participantId,
        side: connection.side,
      },
    });
    return {
      sessionId: connection.sessionId,
      attemptId: connection.attemptId,
      mode: "pvp",
      websocketUrl: routedBattleWebsocketUrl(env.BATTLE_WS_PUBLIC_URL, connection.sessionId),
      ticket: rawTicket,
      ticketExpiresAt: ticketExpiresAt.toISOString(),
      protocolVersion: BATTLE_PROTOCOL_VERSION,
      matchId: connection.matchId,
      participantId: connection.participantId,
      side: connection.side,
    };
  }

  capability() {
    const connectionReady = this.runtime.duelRuntimeReady && PVP_DUEL_PROTOCOL_READY;
    return {
      matchmakingEnabled: this.runtime.enabled,
      duelRuntimeReady: this.runtime.duelRuntimeReady,
      connectionIssuance: connectionReady ? "ready" as const : "blocked" as const,
    };
  }

  private requireFoundationEnabled() {
    if (!this.runtime.enabled) {
      throw new ApiError("pvp_matchmaking_disabled", 503, "PvP matchmaking is not enabled.");
    }
  }

  private publishPendingSession(match: MaterializedPvpMatch) {
    return this.battleTickets.publishPendingPvpSession({
      kind: "pvp",
      participants: match.participants,
      simulationConfig: match.simulationConfig,
      readyDeadlineAtMs: match.readyDeadlineAtMs,
    });
  }

  private dto(ticket: MatchmakingTicketRecord): MatchmakingTicketDto {
    return {
      id: ticket.ticketId,
      queue: ticket.queue,
      region: ticket.region,
      mmr: ticket.mmr,
      status: ticket.status,
      createdAt: ticket.createdAt.toISOString(),
      expiresAt: ticket.expiresAt.toISOString(),
      match: ticket.match ? {
        matchId: ticket.match.matchId,
        sessionId: ticket.match.sessionId,
        attemptId: ticket.match.attemptId,
        runtimeState: this.runtime.duelRuntimeReady && PVP_DUEL_PROTOCOL_READY ? "ready" : "duel_protocol_unavailable",
        connection: null,
      } : null,
    };
  }
}
