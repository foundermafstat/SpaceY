import { createHash } from "node:crypto";
import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Redis } from "ioredis";
import { ApiError } from "../common/api-error.js";
import { env } from "../config/env.js";
import type { DuelSimulationConfig, MissionSimulationConfig } from "@spacey/simulation";

const ROTATE_BATTLE_TICKET_LUA = `
local current = tonumber(redis.call('HGET', KEYS[1], 'version') or '-1')
local requested = tonumber(ARGV[1])
if requested <= current then
  return 0
end
if redis.call('EXISTS', KEYS[3]) == 1 then
  return -1
end
local currentTicketKey = redis.call('HGET', KEYS[1], 'ticketKey')
if currentTicketKey then
  redis.call('DEL', currentTicketKey)
elseif ARGV[5] == '1' then
  redis.call('DEL', KEYS[2])
end
redis.call('SET', KEYS[3], ARGV[2], 'EX', ARGV[3])
local previousUserId = redis.call('HGET', KEYS[1], 'userId')
if previousUserId and previousUserId ~= ARGV[6] then
  redis.call('SREM', ARGV[7] .. previousUserId, KEYS[1])
end
redis.call('HSET', KEYS[1], 'version', ARGV[1], 'ticketKey', KEYS[3], 'userId', ARGV[6])
redis.call('EXPIRE', KEYS[1], ARGV[4])
redis.call('SADD', KEYS[4], KEYS[1])
redis.call('EXPIRE', KEYS[4], ARGV[4])
return 1
`;

const REVOKE_BATTLE_ATTEMPT_TICKET_LUA = `
local currentTicketKey = redis.call('HGET', KEYS[1], 'ticketKey')
if currentTicketKey then redis.call('DEL', currentTicketKey) end
redis.call('HDEL', KEYS[1], 'ticketKey')
local userId = redis.call('HGET', KEYS[1], 'userId')
if userId then redis.call('SREM', ARGV[1] .. userId, KEYS[1]) end
return currentTicketKey and 1 or 0
`;

const REVOKE_BATTLE_USER_TICKETS_LUA = `
local stateKeys = redis.call('SMEMBERS', KEYS[1])
for _, stateKey in ipairs(stateKeys) do
  local currentTicketKey = redis.call('HGET', stateKey, 'ticketKey')
  if currentTicketKey then redis.call('DEL', currentTicketKey) end
  redis.call('HDEL', stateKey, 'ticketKey')
end
redis.call('DEL', KEYS[1])
return #stateKeys
`;

const PUBLISH_PENDING_PVP_SESSION_LUA = `
local current = redis.call('GET', KEYS[1])
if current and current ~= ARGV[1] then return -1 end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
redis.call('ZADD', KEYS[2], 'NX', ARGV[3], ARGV[4])
return 1
`;

const PENDING_PVP_SESSIONS_KEY = "spacey:battle:pending:pvp:sessions";
const BATTLE_TICKET_USER_KEY_PREFIX = "spacey:ws-ticket-user:";

export type PveBattleTicketClaims = {
  sessionId: string;
  attemptId: string;
  userId: string;
  mode: "pve";
};

export type PvpBattleTicketClaims = {
  sessionId: string;
  attemptId: string;
  userId: string;
  mode: "pvp";
  matchId: string;
  participantId: string;
  side: 0 | 1;
};

export type BattleTicketClaims = PveBattleTicketClaims | PvpBattleTicketClaims;

export type BattleSessionDefinition =
  | { kind: "pve"; userId: string; simulationConfig: MissionSimulationConfig }
  | {
      kind: "pvp";
      participants: Array<{ userId: string; attemptId: string; participantId: string; side: 0 | 1 }>;
      simulationConfig: DuelSimulationConfig;
      readyDeadlineAtMs?: number;
    };

@Injectable()
export class BattleTicketStore implements OnModuleDestroy {
  private readonly redis = env.USE_IN_MEMORY_REPOSITORY
    ? null
    : new Redis(env.VALKEY_URL, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
  private readonly memory = new Map<string, { value: unknown; expiresAt: number }>();
  private readonly ticketStates = new Map<string, { version: number; ticketKey: string | null; userId: string }>();
  private readonly userTicketAttempts = new Map<string, Set<string>>();

  async revokeHash(ticketHash: string) {
    const key = `spacey:ws-ticket:${ticketHash}`;
    if (this.redis) {
      try {
        if (this.redis.status === "wait") await this.redis.connect();
        await this.redis.del(key);
        return;
      } catch {
        throw new ApiError("battle_routing_unavailable", 503, "Battle routing is temporarily unavailable.");
      }
    }
    this.memory.delete(key);
  }

  async revokeAttempt(attemptId: string) {
    const stateKey = this.ticketStateKey(attemptId);
    if (this.redis) {
      try {
        if (this.redis.status === "wait") await this.redis.connect();
        await this.redis.eval(
          REVOKE_BATTLE_ATTEMPT_TICKET_LUA,
          1,
          stateKey,
          BATTLE_TICKET_USER_KEY_PREFIX,
        );
        return;
      } catch {
        throw new ApiError("battle_routing_unavailable", 503, "Battle routing is temporarily unavailable.");
      }
    }
    const state = this.ticketStates.get(attemptId);
    if (!state?.ticketKey) return;
    this.memory.delete(state.ticketKey);
    state.ticketKey = null;
    this.userTicketAttempts.get(state.userId)?.delete(attemptId);
  }

  async revokeUser(userId: string) {
    if (this.redis) {
      try {
        if (this.redis.status === "wait") await this.redis.connect();
        await this.redis.eval(
          REVOKE_BATTLE_USER_TICKETS_LUA,
          1,
          this.userTicketKey(userId),
        );
        return;
      } catch {
        throw new ApiError("battle_routing_unavailable", 503, "Battle routing is temporarily unavailable.");
      }
    }
    for (const attemptId of this.userTicketAttempts.get(userId) ?? []) {
      const state = this.ticketStates.get(attemptId);
      if (state?.ticketKey) this.memory.delete(state.ticketKey);
      if (state) state.ticketKey = null;
    }
    this.userTicketAttempts.delete(userId);
  }

  async rotatePveTicket(input: {
    rawTicket: string;
    previousTicketHash: string | null;
    claims: PveBattleTicketClaims;
    ticketVersion: number;
    ttlSeconds?: number;
  }) {
    return this.rotateTicket(input);
  }

  async rotatePvpTicket(input: {
    rawTicket: string;
    previousTicketHash: string | null;
    claims: PvpBattleTicketClaims;
    ticketVersion: number;
    ttlSeconds?: number;
  }) {
    return this.rotateTicket(input);
  }

  private async rotateTicket(input: {
    rawTicket: string;
    previousTicketHash: string | null;
    claims: BattleTicketClaims;
    ticketVersion: number;
    ttlSeconds?: number;
  }) {
    const ttlSeconds = input.ttlSeconds ?? 30;
    if (!Number.isSafeInteger(input.ticketVersion) || input.ticketVersion <= 0) {
      throw new ApiError("battle_ticket_version_invalid", 500, "Battle ticket version is invalid.");
    }
    const stateKey = this.ticketStateKey(input.claims.attemptId);
    const previousKey = input.previousTicketHash
      ? `spacey:ws-ticket:${input.previousTicketHash}`
      : stateKey;
    const nextKey = this.key(input.rawTicket);
    const storedClaims = JSON.stringify({ ...input.claims, ticketVersion: input.ticketVersion });
    if (this.redis) {
      try {
        if (this.redis.status === "wait") await this.redis.connect();
        const result = Number(await this.redis.eval(
          ROTATE_BATTLE_TICKET_LUA,
          4,
          stateKey,
          previousKey,
          nextKey,
          this.userTicketKey(input.claims.userId),
          String(input.ticketVersion),
          storedClaims,
          String(ttlSeconds),
          String(Math.max(86_400, ttlSeconds)),
          input.previousTicketHash ? "1" : "0",
          input.claims.userId,
          BATTLE_TICKET_USER_KEY_PREFIX,
        ));
        if (result === 0) {
          throw new ApiError("battle_ticket_superseded", 409, "A newer battle connection ticket was already issued.");
        }
        if (result !== 1) throw new Error("ticket collision");
        return;
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError("battle_routing_unavailable", 503, "Battle routing is temporarily unavailable.");
      }
    }

    const currentState = this.ticketStates.get(input.claims.attemptId);
    if (input.ticketVersion <= (currentState?.version ?? -1)) {
      throw new ApiError("battle_ticket_superseded", 409, "A newer battle connection ticket was already issued.");
    }
    const existing = this.memory.get(nextKey);
    if (existing && existing.expiresAt > Date.now()) {
      throw new ApiError("battle_routing_unavailable", 503, "Battle routing is temporarily unavailable.");
    }
    if (currentState?.ticketKey) this.memory.delete(currentState.ticketKey);
    else if (input.previousTicketHash) this.memory.delete(previousKey);
    if (currentState && currentState.userId !== input.claims.userId) {
      this.userTicketAttempts.get(currentState.userId)?.delete(input.claims.attemptId);
    }
    this.ticketStates.set(input.claims.attemptId, {
      version: input.ticketVersion,
      ticketKey: nextKey,
      userId: input.claims.userId,
    });
    const attempts = this.userTicketAttempts.get(input.claims.userId) ?? new Set<string>();
    attempts.add(input.claims.attemptId);
    this.userTicketAttempts.set(input.claims.userId, attempts);
    this.memory.set(nextKey, { value: JSON.parse(storedClaims), expiresAt: Date.now() + ttlSeconds * 1_000 });
  }

  async ping() {
    if (!this.redis) return;
    if (this.redis.status === "wait") await this.redis.connect();
    const response = await this.redis.ping();
    if (response !== "PONG") throw new Error("Valkey readiness check failed");
  }

  async issueDefinition(
    sessionId: string,
    definition: BattleSessionDefinition,
    ttlSeconds = 3_600
  ) {
    const key = `spacey:battle:definition:${sessionId}`;
    if (this.redis) {
      try {
        if (this.redis.status === "wait") await this.redis.connect();
        const inserted = await this.redis.set(key, JSON.stringify(definition), "EX", ttlSeconds, "NX");
        if (inserted !== "OK") await this.redis.expire(key, ttlSeconds);
        return;
      } catch {
        throw new ApiError("battle_routing_unavailable", 503, "Battle routing is temporarily unavailable.");
      }
    }
    const existing = this.memory.get(key);
    if (!existing || existing.expiresAt <= Date.now()) {
      this.memory.set(key, { value: definition, expiresAt: Date.now() + ttlSeconds * 1000 });
    } else {
      existing.expiresAt = Date.now() + ttlSeconds * 1000;
    }
  }

  async publishPendingPvpSession(
    definition: Extract<BattleSessionDefinition, { kind: "pvp" }>,
    ttlSeconds = 3_600,
  ) {
    const sessionId = definition.simulationConfig.sessionId;
    const key = `spacey:battle:definition:${sessionId}`;
    const serialized = JSON.stringify(definition);
    if (this.redis) {
      try {
        if (this.redis.status === "wait") await this.redis.connect();
        const result = Number(await this.redis.eval(
          PUBLISH_PENDING_PVP_SESSION_LUA,
          2,
          key,
          PENDING_PVP_SESSIONS_KEY,
          serialized,
          String(ttlSeconds),
          String(Date.now()),
          sessionId,
        ));
        if (result !== 1) throw new Error("pending PvP definition collision");
        return;
      } catch {
        throw new ApiError("battle_routing_unavailable", 503, "Battle routing is temporarily unavailable.");
      }
    }
    const existing = this.memory.get(key);
    if (existing && existing.expiresAt > Date.now()
      && JSON.stringify(existing.value) !== serialized) {
      throw new ApiError("battle_routing_unavailable", 503, "Battle routing is temporarily unavailable.");
    }
    this.memory.set(key, { value: definition, expiresAt: Date.now() + ttlSeconds * 1_000 });
  }

  async onModuleDestroy() {
    if (this.redis?.status === "ready") await this.redis.quit();
  }

  private key(rawTicket: string) {
    return `spacey:ws-ticket:${createHash("sha256").update(rawTicket).digest("hex")}`;
  }

  private ticketStateKey(attemptId: string) {
    return `spacey:ws-ticket-state:${attemptId}`;
  }

  private userTicketKey(userId: string) {
    return `${BATTLE_TICKET_USER_KEY_PREFIX}${userId}`;
  }
}
