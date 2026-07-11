import { randomUUID } from "node:crypto";
import type { OnModuleDestroy } from "@nestjs/common";
import { Redis } from "ioredis";
import { ApiError } from "../common/api-error.js";
import type { MatchmakingTicketRecord } from "../platform/platform.repository.js";

type QueueTicket = {
  id: string;
  userId: string;
  queue: string;
  region: string;
  mmr: number;
  createdAtMs: number;
  expiresAtMs: number;
  baseMmrWindow: number;
  expansionPerSecond: number;
  maxMmrWindow: number;
  state: "queued" | "matching";
  claimId?: string;
};

export type MatchmakingPairClaim = {
  claimId: string;
  leftTicketId: string;
  rightTicketId: string;
  queue: string;
  region: string;
};

export type MatchmakingCancelResult = "cancelled" | "missing" | "claimed";

type StoreOptions = {
  useMemory: boolean;
  valkeyUrl: string;
  claimLeaseMs: number;
};

const ENQUEUE_SCRIPT = `
local current = redis.call('HGET', KEYS[1], ARGV[1])
if current then
  local decoded = cjson.decode(current)
  if decoded.userId ~= ARGV[2] then return redis.error_reply('ticket owner mismatch') end
  return decoded.state
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[3])
redis.call('ZADD', KEYS[2], ARGV[4], ARGV[1])
return 'queued'
`;

const TRY_MATCH_SCRIPT = `
local now = tonumber(ARGV[2])
local claimLease = tonumber(ARGV[4])
local expiredClaims = redis.call('ZRANGEBYSCORE', KEYS[3], '-inf', now, 'LIMIT', 0, 32)
for _, expiredClaimId in ipairs(expiredClaims) do
  local claimRaw = redis.call('HGET', KEYS[1], 'claim:' .. expiredClaimId)
  if claimRaw then
    local claim = cjson.decode(claimRaw)
    for _, ticketId in ipairs({claim.leftTicketId, claim.rightTicketId}) do
      local ticketRaw = redis.call('HGET', KEYS[1], ticketId)
      if ticketRaw then
        local ticket = cjson.decode(ticketRaw)
        if ticket.state == 'matching' and ticket.claimId == expiredClaimId then
          ticket.claimId = nil
          if tonumber(ticket.expiresAtMs) > now then
            ticket.state = 'queued'
            redis.call('HSET', KEYS[1], ticketId, cjson.encode(ticket))
            redis.call('ZADD', KEYS[2], tonumber(ticket.mmr), ticketId)
          else
            redis.call('HDEL', KEYS[1], ticketId)
          end
        end
      end
    end
    redis.call('HDEL', KEYS[1], 'claim:' .. expiredClaimId)
  end
  redis.call('ZREM', KEYS[3], expiredClaimId)
end

local currentRaw = redis.call('HGET', KEYS[1], ARGV[1])
if not currentRaw then return nil end
local current = cjson.decode(currentRaw)
if current.state ~= 'queued' then return nil end
if tonumber(current.expiresAtMs) <= now then
  redis.call('ZREM', KEYS[2], current.id)
  redis.call('HDEL', KEYS[1], current.id)
  return nil
end

local function window(ticket)
  local waitedSeconds = math.floor(math.max(0, now - tonumber(ticket.createdAtMs)) / 1000)
  return math.min(tonumber(ticket.maxMmrWindow), tonumber(ticket.baseMmrWindow) + waitedSeconds * tonumber(ticket.expansionPerSecond))
end

local currentWindow = window(current)
local candidates = redis.call(
  'ZREVRANGEBYSCORE', KEYS[2], tonumber(current.mmr),
  tonumber(current.mmr) - currentWindow, 'LIMIT', 0, 64
)
local upperCandidates = redis.call(
  'ZRANGEBYSCORE', KEYS[2], tonumber(current.mmr),
  tonumber(current.mmr) + currentWindow, 'LIMIT', 0, 64
)
for _, candidateId in ipairs(upperCandidates) do table.insert(candidates, candidateId) end
local best = nil
local bestDelta = nil
for _, candidateId in ipairs(candidates) do
  if candidateId ~= current.id then
    local candidateRaw = redis.call('HGET', KEYS[1], candidateId)
    if candidateRaw then
      local candidate = cjson.decode(candidateRaw)
      local delta = math.abs(tonumber(current.mmr) - tonumber(candidate.mmr))
      if tonumber(candidate.expiresAtMs) <= now then
        redis.call('ZREM', KEYS[2], candidateId)
        redis.call('HDEL', KEYS[1], candidateId)
      elseif candidate.state == 'queued' and candidate.userId ~= current.userId and delta <= window(candidate) then
        if not best or delta < bestDelta
          or (delta == bestDelta and tonumber(candidate.createdAtMs) < tonumber(best.createdAtMs))
          or (delta == bestDelta and tonumber(candidate.createdAtMs) == tonumber(best.createdAtMs) and candidate.id < best.id) then
          best = candidate
          bestDelta = delta
        end
      end
    end
  end
end
if not best then return nil end

local claimId = ARGV[3]
current.state = 'matching'
current.claimId = claimId
best.state = 'matching'
best.claimId = claimId
local claim = {
  claimId = claimId,
  leftTicketId = current.id,
  rightTicketId = best.id,
  queue = current.queue,
  region = current.region
}
redis.call('ZREM', KEYS[2], current.id, best.id)
redis.call('HSET', KEYS[1], current.id, cjson.encode(current), best.id, cjson.encode(best), 'claim:' .. claimId, cjson.encode(claim))
redis.call('ZADD', KEYS[3], now + claimLease, claimId)
return cjson.encode(claim)
`;

const CANCEL_SCRIPT = `
local raw = redis.call('HGET', KEYS[1], ARGV[1])
if not raw then return 'missing' end
local ticket = cjson.decode(raw)
if ticket.userId ~= ARGV[2] then return redis.error_reply('ticket owner mismatch') end
if ticket.state == 'matching' then return 'claimed' end
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('HDEL', KEYS[1], ARGV[1])
return 'cancelled'
`;

const COMPLETE_SCRIPT = `
local claimRaw = redis.call('HGET', KEYS[1], 'claim:' .. ARGV[1])
if not claimRaw then return 0 end
local claim = cjson.decode(claimRaw)
redis.call('HDEL', KEYS[1], claim.leftTicketId, claim.rightTicketId, 'claim:' .. ARGV[1])
redis.call('ZREM', KEYS[2], ARGV[1])
return 1
`;

const RELEASE_SCRIPT = `
local claimRaw = redis.call('HGET', KEYS[1], 'claim:' .. ARGV[1])
if not claimRaw then return 0 end
local claim = cjson.decode(claimRaw)
for _, ticketId in ipairs({claim.leftTicketId, claim.rightTicketId}) do
  local raw = redis.call('HGET', KEYS[1], ticketId)
  if raw then
    local ticket = cjson.decode(raw)
    if ticket.state == 'matching' and ticket.claimId == ARGV[1] then
      ticket.state = 'queued'
      ticket.claimId = nil
      redis.call('HSET', KEYS[1], ticketId, cjson.encode(ticket))
      redis.call('ZADD', KEYS[2], tonumber(ticket.mmr), ticketId)
    end
  end
end
redis.call('HDEL', KEYS[1], 'claim:' .. ARGV[1])
redis.call('ZREM', KEYS[3], ARGV[1])
return 1
`;

export class MatchmakingQueueStore implements OnModuleDestroy {
  private readonly redis: Redis | null;
  private readonly claimLeaseMs: number;
  private readonly memoryTickets = new Map<string, QueueTicket>();
  private readonly memoryClaims = new Map<string, MatchmakingPairClaim & { expiresAtMs: number }>();

  constructor(options: StoreOptions) {
    this.claimLeaseMs = options.claimLeaseMs;
    this.redis = options.useMemory
      ? null
      : new Redis(options.valkeyUrl, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
  }

  async enqueue(record: MatchmakingTicketRecord): Promise<void> {
    const ticket = this.queueTicket(record);
    if (!this.redis) {
      const existing = this.memoryTickets.get(ticket.id);
      if (existing && existing.userId !== ticket.userId) throw new Error("Matchmaking ticket owner mismatch");
      if (!existing) this.memoryTickets.set(ticket.id, ticket);
      return;
    }
    const keys = this.keys(ticket.queue, ticket.region);
    await this.redisCall(() => this.redis!.eval(
      ENQUEUE_SCRIPT, 2, keys.tickets, keys.queued,
      ticket.id, ticket.userId, JSON.stringify(ticket), String(ticket.mmr),
    ));
  }

  async tryMatch(record: MatchmakingTicketRecord, nowMs = Date.now()): Promise<MatchmakingPairClaim | null> {
    if (!this.redis) return this.tryMatchMemory(record, nowMs);
    const keys = this.keys(record.queue, record.region);
    const value = await this.redisCall(() => this.redis!.eval(
      TRY_MATCH_SCRIPT, 3, keys.tickets, keys.queued, keys.inflight,
      record.ticketId, String(nowMs), randomUUID(), String(this.claimLeaseMs),
    ));
    if (typeof value !== "string") return null;
    return JSON.parse(value) as MatchmakingPairClaim;
  }

  async cancel(record: MatchmakingTicketRecord): Promise<MatchmakingCancelResult> {
    if (!this.redis) {
      const ticket = this.memoryTickets.get(record.ticketId);
      if (!ticket) return "missing";
      if (ticket.userId !== record.userId) throw new Error("Matchmaking ticket owner mismatch");
      if (ticket.state === "matching") return "claimed";
      this.memoryTickets.delete(ticket.id);
      return "cancelled";
    }
    const keys = this.keys(record.queue, record.region);
    const value = await this.redisCall(() => this.redis!.eval(
      CANCEL_SCRIPT, 2, keys.tickets, keys.queued, record.ticketId, record.userId,
    ));
    return value as MatchmakingCancelResult;
  }

  async complete(claim: MatchmakingPairClaim): Promise<void> {
    if (!this.redis) {
      if (!this.memoryClaims.delete(claim.claimId)) return;
      this.memoryTickets.delete(claim.leftTicketId);
      this.memoryTickets.delete(claim.rightTicketId);
      return;
    }
    const keys = this.keys(claim.queue, claim.region);
    await this.redisCall(() => this.redis!.eval(
      COMPLETE_SCRIPT, 2, keys.tickets, keys.inflight, claim.claimId,
    ));
  }

  async release(claim: MatchmakingPairClaim): Promise<void> {
    if (!this.redis) {
      const stored = this.memoryClaims.get(claim.claimId);
      if (!stored) return;
      this.memoryClaims.delete(claim.claimId);
      for (const id of [claim.leftTicketId, claim.rightTicketId]) {
        const ticket = this.memoryTickets.get(id);
        if (ticket?.claimId === claim.claimId) {
          ticket.state = "queued";
          delete ticket.claimId;
        }
      }
      return;
    }
    const keys = this.keys(claim.queue, claim.region);
    await this.redisCall(() => this.redis!.eval(
      RELEASE_SCRIPT, 3, keys.tickets, keys.queued, keys.inflight, claim.claimId,
    ));
  }

  async ping(): Promise<void> {
    if (!this.redis) return;
    await this.connect();
    if (await this.redis.ping() !== "PONG") throw new Error("Valkey readiness check failed");
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis?.status === "ready") await this.redis.quit();
  }

  private tryMatchMemory(record: MatchmakingTicketRecord, nowMs: number): MatchmakingPairClaim | null {
    this.recoverMemoryClaims(nowMs);
    const current = this.memoryTickets.get(record.ticketId);
    if (!current || current.state !== "queued" || current.expiresAtMs <= nowMs) {
      if (current?.expiresAtMs && current.expiresAtMs <= nowMs) this.memoryTickets.delete(current.id);
      return null;
    }
    const candidates = [...this.memoryTickets.values()]
      .filter((candidate) => candidate.id !== current.id
        && candidate.userId !== current.userId
        && candidate.queue === current.queue
        && candidate.region === current.region
        && candidate.state === "queued"
        && candidate.expiresAtMs > nowMs
        && this.compatible(current, candidate, nowMs))
      .sort((left, right) => Math.abs(current.mmr - left.mmr) - Math.abs(current.mmr - right.mmr)
        || left.createdAtMs - right.createdAtMs
        || left.id.localeCompare(right.id));
    const opponent = candidates[0];
    if (!opponent) return null;
    const claim: MatchmakingPairClaim & { expiresAtMs: number } = {
      claimId: randomUUID(),
      leftTicketId: current.id,
      rightTicketId: opponent.id,
      queue: current.queue,
      region: current.region,
      expiresAtMs: nowMs + this.claimLeaseMs,
    };
    current.state = "matching";
    current.claimId = claim.claimId;
    opponent.state = "matching";
    opponent.claimId = claim.claimId;
    this.memoryClaims.set(claim.claimId, claim);
    return claim;
  }

  private recoverMemoryClaims(nowMs: number) {
    for (const claim of this.memoryClaims.values()) {
      if (claim.expiresAtMs > nowMs) continue;
      this.memoryClaims.delete(claim.claimId);
      for (const id of [claim.leftTicketId, claim.rightTicketId]) {
        const ticket = this.memoryTickets.get(id);
        if (!ticket || ticket.claimId !== claim.claimId) continue;
        if (ticket.expiresAtMs <= nowMs) this.memoryTickets.delete(id);
        else {
          ticket.state = "queued";
          delete ticket.claimId;
        }
      }
    }
  }

  private compatible(left: QueueTicket, right: QueueTicket, nowMs: number) {
    const window = (ticket: QueueTicket) => Math.min(
      ticket.maxMmrWindow,
      ticket.baseMmrWindow + Math.floor(Math.max(0, nowMs - ticket.createdAtMs) / 1_000) * ticket.expansionPerSecond,
    );
    return Math.abs(left.mmr - right.mmr) <= Math.min(window(left), window(right));
  }

  private queueTicket(record: MatchmakingTicketRecord): QueueTicket {
    return {
      id: record.ticketId,
      userId: record.userId,
      queue: record.queue,
      region: record.region,
      mmr: record.mmr,
      createdAtMs: record.createdAt.getTime(),
      expiresAtMs: record.expiresAt.getTime(),
      baseMmrWindow: record.policy.baseMmrWindow,
      expansionPerSecond: record.policy.expansionPerSecond,
      maxMmrWindow: record.policy.maxMmrWindow,
      state: "queued",
    };
  }

  private keys(queue: string, region: string) {
    const tag = `{spacey-mm:${queue}:${region}}`;
    return {
      tickets: `spacey:mm:${tag}:tickets`,
      queued: `spacey:mm:${tag}:queued`,
      inflight: `spacey:mm:${tag}:inflight`,
    };
  }

  private async redisCall<T>(operation: () => Promise<T>): Promise<T> {
    try {
      await this.connect();
      return await operation();
    } catch {
      throw new ApiError("matchmaking_queue_unavailable", 503, "Matchmaking queue is temporarily unavailable.");
    }
  }

  private async connect() {
    if (this.redis?.status === "wait") await this.redis.connect();
  }
}
