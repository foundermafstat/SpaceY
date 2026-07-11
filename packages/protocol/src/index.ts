import type { EntityId, IsoTimestamp } from "@spacey/contracts";

export const BATTLE_PROTOCOL_VERSION = "spacey-battle-v1" as const;
// The worker supports both one-player PvE sessions and two-participant PvP duels.
export const PVP_DUEL_PROTOCOL_READY = true as const;
export const INPUT_AXIS_SCALE = 1_000 as const;

export const BattleActionFlag = {
  FirePrimary: 1 << 0,
  FireSecondary: 1 << 1,
  AbilityOne: 1 << 2,
  AbilityTwo: 1 << 3
} as const;

export type BattleMode = "pve" | "pvp";

export type BattleInputCommand = {
  seq: number;
  targetTick: number;
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  actionFlags: number;
};

export type BattleClientMessage =
  | { type: "session.resume"; lastAcknowledgedInputSequence: number }
  | { type: "input.command"; command: BattleInputCommand }
  | { type: "ping"; nonce: number };

export type BattleEntitySnapshot = {
  id: string;
  kind: "player" | "enemy" | "projectile" | "objective";
  xMilli: number;
  yMilli: number;
  velocityXMilliPerTick: number;
  velocityYMilliPerTick: number;
  rotationMilliRadians: number;
  hull: number;
  hullMax: number;
  flags: number;
};

export type BattleObjectiveSnapshot = {
  type: "destroy_all" | "survive_seconds" | "destroy_opponent";
  progress: number;
  target: number;
};

export type BattleSnapshot = {
  sessionId: EntityId;
  tick: number;
  stateHash: string;
  lastProcessedInputSequence: number;
  status: "active" | "victory" | "defeat";
  objective: BattleObjectiveSnapshot;
  entities: BattleEntitySnapshot[];
};

export type ReconnectMetadata = {
  permitted: boolean;
  disconnectedAt: IsoTimestamp | null;
  deadlineAt: IsoTimestamp | null;
  lastProcessedInputSequence: number;
  latestCheckpointTick: number;
};

export type PvpParticipantContext = {
  matchId: EntityId;
  participantId: EntityId;
  side: 0 | 1;
};

export type BattleServerMessage =
  | {
      type: "battle.initial";
      protocolVersion: typeof BATTLE_PROTOCOL_VERSION;
      mode: BattleMode;
      participant: PvpParticipantContext | null;
      snapshot: BattleSnapshot;
      reconnect: ReconnectMetadata;
    }
  | { type: "battle.snapshot"; snapshot: BattleSnapshot }
  | { type: "battle.event"; eventId: number; tick: number; eventType: string; entityIds: string[] }
  | {
      type: "battle.ended";
      resultId: EntityId;
      outcome: "victory" | "defeat" | "forfeit";
      reason: string;
      finalTick: number;
      finalStateHash: string;
    }
  | { type: "session.error"; code: string; message: string; retryable: boolean }
  | { type: "pong"; nonce: number; serverTick: number };

export interface BattleProtocolCodec {
  readonly contentType: "application/x-protobuf";
  decodeClient(data: Uint8Array): BattleClientMessage;
  encodeServer(message: BattleServerMessage): Uint8Array;
}

export function isBattleClientMessage(value: unknown): value is BattleClientMessage {
  if (!isRecord(value) || typeof value.type !== "string") return false;

  if (value.type === "ping") {
    return isSafeNonNegativeInteger(value.nonce);
  }

  if (value.type === "session.resume") {
    return isSafeNonNegativeInteger(value.lastAcknowledgedInputSequence);
  }

  if (value.type !== "input.command" || !isRecord(value.command)) return false;
  const command = value.command;
  return isSafePositiveInteger(command.seq)
    && isSafeNonNegativeInteger(command.targetTick)
    && isAxis(command.moveX)
    && isAxis(command.moveY)
    && isAxis(command.aimX)
    && isAxis(command.aimY)
    && isSafeNonNegativeInteger(command.actionFlags);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafePositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isAxis(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= -INPUT_AXIS_SCALE && (value as number) <= INPUT_AXIS_SCALE;
}
