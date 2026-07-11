import type { BattleConnection, BattleSessionRuntime, BattleTicketClaims, CreateBattleSessionRequest } from "./ports.js";
import type { BattleSessionManager } from "./session-manager.js";
import type { DuelSessionManager } from "./duel-session-manager.js";

export class AuthoritativeSessionManager implements BattleSessionRuntime {
  constructor(
    private readonly pve: BattleSessionManager,
    private readonly pvp: DuelSessionManager,
  ) {}

  get activeSessionCount() {
    return this.pve.activeSessionCount + this.pvp.activeSessionCount;
  }

  createSession(request: CreateBattleSessionRequest) {
    return request.kind === "pvp" ? this.pvp.createSession(request) : this.pve.createSession(request);
  }

  attachConnection(claims: BattleTicketClaims, connection: BattleConnection) {
    return claims.mode === "pvp"
      ? this.pvp.attachConnection(claims, connection)
      : this.pve.attachConnection(claims, connection);
  }

  async advanceOneTick(nowMs?: number) {
    await Promise.all([this.pve.advanceOneTick(nowMs), this.pvp.advanceOneTick(nowMs)]);
  }

  async flushCheckpoints() {
    await Promise.all([this.pve.flushCheckpoints(), this.pvp.flushCheckpoints()]);
  }
}
