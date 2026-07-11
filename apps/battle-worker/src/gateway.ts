import { BATTLE_PROTOCOL_VERSION } from "@spacey/protocol";

import type {
  BattleConnection,
  BattleSessionRuntime,
  BattleTicketClaims,
  BattleTicketValidator,
  BattleWorkerLogger
} from "./ports.js";

export class BattleGateway {
  constructor(
    private readonly ticketValidator: BattleTicketValidator,
    private readonly sessions: BattleSessionRuntime,
    private readonly logger: BattleWorkerLogger
  ) {}

  async accept(
    rawTicket: string,
    requestedProtocol: string,
    connection: BattleConnection
  ): Promise<boolean> {
    const authorization = await this.authorize(rawTicket, requestedProtocol);
    if (!authorization.authorized) {
      connection.close(authorization.closeCode, authorization.reason);
      return false;
    }
    return this.attach(authorization.claims, connection);
  }

  async authorize(
    rawTicket: string,
    requestedProtocol: string
  ): Promise<BattleGatewayAuthorization> {
    if (requestedProtocol !== BATTLE_PROTOCOL_VERSION) {
      return { authorized: false, httpStatus: 426, closeCode: 4400, reason: "unsupported battle protocol" };
    }
    if (rawTicket.length < 16 || rawTicket.length > 4096) {
      return { authorized: false, httpStatus: 401, closeCode: 4401, reason: "invalid battle ticket" };
    }

    const claims = await this.ticketValidator.validateAndConsume(rawTicket);
    if (!claims) {
      return { authorized: false, httpStatus: 401, closeCode: 4401, reason: "invalid or expired battle ticket" };
    }
    if (!claims.sessionId || !claims.attemptId || !claims.userId
      || (claims.mode === "pvp" && (!claims.matchId || !claims.participantId || (claims.side !== 0 && claims.side !== 1)))) {
      this.logger.warn("Consumed battle ticket had invalid claims");
      return { authorized: false, httpStatus: 401, closeCode: 4401, reason: "invalid battle ticket claims" };
    }
    return { authorized: true, claims };
  }

  attach(claims: BattleTicketClaims, connection: BattleConnection): Promise<boolean> {
    return this.sessions.attachConnection(claims, connection);
  }
}

export type BattleGatewayAuthorization =
  | { authorized: true; claims: BattleTicketClaims }
  | { authorized: false; httpStatus: 401 | 426; closeCode: number; reason: string };
