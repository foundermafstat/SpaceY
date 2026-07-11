import { createHash } from "node:crypto";
import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Redis } from "ioredis";
import { ApiError } from "../common/api-error.js";
import { env } from "../config/env.js";
import type { DuelSimulationConfig, MissionSimulationConfig } from "@spacey/simulation";

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
    };

@Injectable()
export class BattleTicketStore implements OnModuleDestroy {
  private readonly redis = env.USE_IN_MEMORY_REPOSITORY
    ? null
    : new Redis(env.VALKEY_URL, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
  private readonly memory = new Map<string, { value: unknown; expiresAt: number }>();

  async issue(rawTicket: string, claims: BattleTicketClaims, ttlSeconds = 30) {
    const key = this.key(rawTicket);
    if (this.redis) {
      try {
        if (this.redis.status === "wait") await this.redis.connect();
        const result = await this.redis.set(key, JSON.stringify(claims), "EX", ttlSeconds, "NX");
        if (result !== "OK") throw new Error("ticket collision");
        return;
      } catch {
        throw new ApiError("battle_routing_unavailable", 503, "Battle routing is temporarily unavailable.");
      }
    }
    this.memory.set(key, { value: claims, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

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
        await this.redis.set(key, JSON.stringify(definition), "EX", ttlSeconds);
        return;
      } catch {
        throw new ApiError("battle_routing_unavailable", 503, "Battle routing is temporarily unavailable.");
      }
    }
    this.memory.set(key, { value: definition, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async onModuleDestroy() {
    if (this.redis?.status === "ready") await this.redis.quit();
  }

  private key(rawTicket: string) {
    return `spacey:ws-ticket:${createHash("sha256").update(rawTicket).digest("hex")}`;
  }
}
