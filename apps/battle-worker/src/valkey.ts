import { Redis } from "ioredis";
import type { SimulationInputCommand } from "@spacey/simulation";

import type {
  BattleCheckpointStore,
  BattleInputJournal,
  BattleRouteLease,
  BattleSessionDefinitionStore,
  BattleSessionRouter,
  BattleTicketClaims,
  BattleTicketValidator,
  CreateBattleSessionRequest,
  StoredBattleSessionCheckpoint
} from "./ports.js";
import {
  battleTicketKey,
  checkpointKey,
  definitionKey,
  inputJournalKey,
  parseBattleTicketClaims,
  routeKey
} from "./valkey-schema.js";

const ROUTE_REFRESH_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current == ARGV[1] then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
  return 1
end
return 0
`;

const ROUTE_CLAIM_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current or current == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
  return 1
end
return 0
`;

const ROUTE_RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export function createValkeyClient(url: string): Redis {
  return new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
    commandTimeout: 2_000,
    retryStrategy: (attempt: number) => Math.min(attempt * 100, 2_000)
  });
}

export class ValkeyBattleTicketValidator implements BattleTicketValidator {
  constructor(private readonly redis: Redis) {}

  async validateAndConsume(rawTicket: string): Promise<BattleTicketClaims | null> {
    const serialized = await this.redis.getdel(battleTicketKey(rawTicket));
    if (!serialized) return null;
    return parseBattleTicketClaims(serialized);
  }
}

export class ValkeyBattleCheckpointStore implements BattleCheckpointStore {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds: number
  ) {}

  async load(sessionId: string): Promise<StoredBattleSessionCheckpoint | null> {
    const serialized = await this.redis.get(checkpointKey(sessionId));
    if (!serialized) return null;
    const value: unknown = JSON.parse(serialized);
    return isStoredCheckpoint(value) ? value : null;
  }

  async save(checkpoint: StoredBattleSessionCheckpoint): Promise<void> {
    await this.redis.set(
      checkpointKey(checkpoint.sessionId),
      JSON.stringify(checkpoint),
      "EX",
      this.ttlSeconds
    );
  }

  async delete(sessionId: string): Promise<void> {
    await this.redis.del(checkpointKey(sessionId));
  }
}

export class ValkeyBattleSessionDefinitionStore implements BattleSessionDefinitionStore {
  constructor(private readonly redis: Redis) {}

  async load(sessionId: string): Promise<CreateBattleSessionRequest | null> {
    const serialized = await this.redis.get(definitionKey(sessionId));
    if (!serialized) return null;
    const value: unknown = JSON.parse(serialized);
    return isSessionDefinition(value) ? value : null;
  }

  async save(request: CreateBattleSessionRequest, ttlSeconds: number): Promise<void> {
    const key = definitionKey(request.simulationConfig.sessionId);
    const serialized = JSON.stringify(request);
    const inserted = await this.redis.set(key, serialized, "EX", ttlSeconds, "NX");
    if (inserted === "OK") return;
    const existing = await this.redis.get(key);
    if (existing !== serialized) throw new Error("Battle session definition collision.");
  }

  async delete(sessionId: string): Promise<void> {
    await this.redis.del(definitionKey(sessionId));
  }
}

export class ValkeyBattleInputJournal implements BattleInputJournal {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds: number
  ) {}

  async append(sessionId: string, userId: string, input: SimulationInputCommand): Promise<void> {
    const key = inputJournalKey(sessionId);
    const transaction = this.redis.multi();
    transaction.hsetnx(key, `${userId}:${input.seq}`, JSON.stringify({ userId, input }));
    transaction.expire(key, this.ttlSeconds);
    const result = await transaction.exec();
    if (!result) throw new Error("Valkey input journal transaction was aborted.");
    const commandError = result.find(([error]: [Error | null, unknown]) => error !== null)?.[0];
    if (commandError) throw commandError;
  }

  async readAfter(sessionId: string, userId: string, sequence: number): Promise<SimulationInputCommand[]> {
    const values: Record<string, string> = await this.redis.hgetall(inputJournalKey(sessionId));
    return Object.entries(values)
      .map(([, serialized]) => parseJournaledInput(serialized))
      .filter((entry): entry is { userId: string; input: SimulationInputCommand } => entry !== null)
      .filter((entry) => entry.userId === userId && entry.input.seq > sequence)
      .map(({ input }) => input)
      .sort((left, right) => left.seq - right.seq);
  }

  async readAll(sessionId: string): Promise<Array<{ userId: string; input: SimulationInputCommand }>> {
    const values: Record<string, string> = await this.redis.hgetall(inputJournalKey(sessionId));
    return Object.values(values)
      .map(parseJournaledInput)
      .filter((entry): entry is { userId: string; input: SimulationInputCommand } => entry !== null)
      .sort((left, right) => left.input.targetTick - right.input.targetTick
        || left.userId.localeCompare(right.userId)
        || left.input.seq - right.input.seq);
  }

  async delete(sessionId: string): Promise<void> {
    await this.redis.del(inputJournalKey(sessionId));
  }
}

export class ValkeyBattleSessionRouter implements BattleSessionRouter {
  constructor(private readonly redis: Redis) {}

  async claim(sessionId: string, lease: BattleRouteLease, ttlSeconds: number): Promise<boolean> {
    const result = await this.redis.eval(
      ROUTE_CLAIM_SCRIPT,
      1,
      routeKey(sessionId),
      serializeLease(lease),
      String(ttlSeconds)
    );
    return result === 1;
  }

  async refresh(sessionId: string, lease: BattleRouteLease, ttlSeconds: number): Promise<boolean> {
    const result = await this.redis.eval(
      ROUTE_REFRESH_SCRIPT,
      1,
      routeKey(sessionId),
      serializeLease(lease),
      String(ttlSeconds)
    );
    return result === 1;
  }

  async release(sessionId: string, lease: BattleRouteLease): Promise<void> {
    await this.redis.eval(ROUTE_RELEASE_SCRIPT, 1, routeKey(sessionId), serializeLease(lease));
  }
}

export async function pingValkey(redis: Redis): Promise<void> {
  const result = await redis.ping();
  if (result !== "PONG") throw new Error("Valkey ping failed.");
}

function parseJournaledInput(serialized: string): { userId: string; input: SimulationInputCommand } | null {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return null;
  }
  if (!isRecord(value) || !isNonEmptyString(value.userId) || !isRecord(value.input)) return null;
  const input = value.input;
  for (const field of ["seq", "targetTick", "moveX", "moveY", "aimX", "aimY", "actionFlags"] as const) {
    if (!Number.isSafeInteger(input[field])) return null;
  }
  return { userId: value.userId, input: input as SimulationInputCommand };
}

function isStoredCheckpoint(value: unknown): value is StoredBattleSessionCheckpoint {
  if (!isRecord(value)
    || !isNonEmptyString(value.sessionId)
    || !isRecord(value.simulation)
    || !Number.isSafeInteger(value.savedAtMs)) return false;
  if (value.kind === "pve") {
    return isNonEmptyString(value.attemptId)
      && isNonEmptyString(value.userId)
      && value.mode === "pve"
      && (value.disconnectedAtMs === null || Number.isSafeInteger(value.disconnectedAtMs))
      && (value.disconnectDeadlineAtMs === null || Number.isSafeInteger(value.disconnectDeadlineAtMs));
  }
  return value.kind === "pvp"
    && isNonEmptyString(value.matchId)
    && typeof value.started === "boolean"
    && Array.isArray(value.participants)
    && value.participants.length === 2
    && value.participants.every((participant) => isRecord(participant)
      && isNonEmptyString(participant.userId)
      && isNonEmptyString(participant.attemptId)
      && isNonEmptyString(participant.participantId)
      && (participant.side === 0 || participant.side === 1)
      && (participant.disconnectedAtMs === null || Number.isSafeInteger(participant.disconnectedAtMs))
      && (participant.disconnectDeadlineAtMs === null || Number.isSafeInteger(participant.disconnectDeadlineAtMs)));
}

function isSessionDefinition(value: unknown): value is CreateBattleSessionRequest {
  if (!isRecord(value) || !isRecord(value.simulationConfig) || !isNonEmptyString(value.simulationConfig.sessionId)) return false;
  if (value.kind === "pve") {
    return isNonEmptyString(value.userId) && isNonEmptyString(value.simulationConfig.attemptId);
  }
  return value.kind === "pvp"
    && isNonEmptyString(value.simulationConfig.matchId)
    && Array.isArray(value.participants)
    && value.participants.length === 2
    && value.participants.every((participant) => isRecord(participant)
      && isNonEmptyString(participant.userId)
      && isNonEmptyString(participant.attemptId)
      && isNonEmptyString(participant.participantId)
      && (participant.side === 0 || participant.side === 1));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function serializeLease(lease: BattleRouteLease): string {
  return JSON.stringify({ workerId: lease.workerId, endpoint: lease.endpoint });
}
