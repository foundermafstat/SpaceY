import { fileURLToPath } from "node:url";
import protobuf from "protobufjs";

import {
  BATTLE_PROTOCOL_VERSION,
  isBattleClientMessage,
  type BattleClientMessage,
  type BattleEntitySnapshot,
  type BattleProtocolCodec,
  type BattleServerMessage,
  type BattleSnapshot
} from "@spacey/protocol";

export class ProtobufBattleCodec implements BattleProtocolCodec {
  readonly contentType = "application/x-protobuf" as const;

  private constructor(
    private readonly clientEnvelope: protobuf.Type,
    private readonly serverEnvelope: protobuf.Type
  ) {}

  static async create(protoPath = defaultProtoPath()): Promise<ProtobufBattleCodec> {
    const root = await protobuf.load(protoPath);
    return new ProtobufBattleCodec(
      root.lookupType("spacey.battle.v1.ClientEnvelope"),
      root.lookupType("spacey.battle.v1.ServerEnvelope")
    );
  }

  decodeClient(data: Uint8Array): BattleClientMessage {
    const decoded = this.clientEnvelope.decode(data);
    const object = this.clientEnvelope.toObject(decoded, {
      longs: String,
      enums: String,
      defaults: false,
      oneofs: true
    }) as Record<string, unknown>;
    const message = fromClientEnvelope(object);
    if (!isBattleClientMessage(message)) throw new Error("Invalid battle client envelope.");
    return message;
  }

  encodeServer(message: BattleServerMessage): Uint8Array {
    const payload = toServerEnvelope(message);
    const validationError = this.serverEnvelope.verify(payload);
    if (validationError) throw new Error(`Invalid battle server envelope: ${validationError}`);
    return this.serverEnvelope.encode(this.serverEnvelope.create(payload)).finish();
  }
}

function fromClientEnvelope(envelope: Record<string, unknown>): BattleClientMessage {
  if (isRecord(envelope.sessionResume)) {
    return {
      type: "session.resume",
      lastAcknowledgedInputSequence: parseSafeUint64(
        envelope.sessionResume.lastAcknowledgedInputSequence ?? 0
      )
    };
  }
  if (isRecord(envelope.inputCommand)) {
    return {
      type: "input.command",
      command: {
        seq: parseSafeUint64(envelope.inputCommand.sequence ?? 0),
        targetTick: parseSafeUint64(envelope.inputCommand.targetTick ?? 0),
        moveX: parseInteger(envelope.inputCommand.moveX ?? 0),
        moveY: parseInteger(envelope.inputCommand.moveY ?? 0),
        aimX: parseInteger(envelope.inputCommand.aimX ?? 0),
        aimY: parseInteger(envelope.inputCommand.aimY ?? 0),
        actionFlags: parseSafeUint64(envelope.inputCommand.actionFlags ?? 0)
      }
    };
  }
  if (isRecord(envelope.ping)) {
    return { type: "ping", nonce: parseSafeUint64(envelope.ping.nonce ?? 0) };
  }
  throw new Error("Battle client envelope has no supported payload.");
}

function toServerEnvelope(message: BattleServerMessage): Record<string, unknown> {
  switch (message.type) {
    case "battle.initial":
      return {
        battleInitial: {
          protocolVersion: BATTLE_PROTOCOL_VERSION,
          mode: message.mode === "pve" ? 1 : 2,
          snapshot: toWireSnapshot(message.snapshot),
          reconnect: {
            permitted: message.reconnect.permitted,
            disconnectedAt: message.reconnect.disconnectedAt ?? "",
            deadlineAt: message.reconnect.deadlineAt ?? "",
            lastProcessedInputSequence: message.reconnect.lastProcessedInputSequence,
            latestCheckpointTick: message.reconnect.latestCheckpointTick
          },
          ...(message.participant ? {
            participant: {
              matchId: message.participant.matchId,
              participantId: message.participant.participantId,
              side: message.participant.side
            }
          } : {})
        }
      };
    case "battle.snapshot":
      return { battleSnapshot: toWireSnapshot(message.snapshot) };
    case "battle.event":
      return {
        battleEvent: {
          eventId: message.eventId,
          tick: message.tick,
          eventType: message.eventType,
          entityIds: message.entityIds,
          ...(message.moduleIds ? { moduleIds: message.moduleIds } : {}),
          ...(message.userIds ? { userIds: message.userIds } : {}),
          ...(message.weaponId ? { weaponId: message.weaponId } : {}),
          ...(message.value !== undefined ? { value: message.value } : {})
        }
      };
    case "battle.ended":
      return {
        battleEnded: {
          resultId: message.resultId,
          outcome: message.outcome,
          reason: message.reason,
          finalTick: message.finalTick,
          finalStateHash: message.finalStateHash
        }
      };
    case "session.error":
      return {
        sessionError: {
          code: message.code,
          message: message.message,
          retryable: message.retryable
        }
      };
    case "pong":
      return { pong: { nonce: message.nonce, serverTick: message.serverTick } };
  }
}

function toWireSnapshot(snapshot: BattleSnapshot): Record<string, unknown> {
  return {
    sessionId: snapshot.sessionId,
    tick: snapshot.tick,
    stateHash: snapshot.stateHash,
    lastProcessedInputSequence: snapshot.lastProcessedInputSequence,
    status: snapshot.status === "active"
      ? 1
      : snapshot.status === "victory"
        ? 2
        : snapshot.status === "defeat"
          ? 3
          : 4,
    objective: snapshot.objective,
    entities: snapshot.entities.map(toWireEntity),
    arenaWidthMilli: snapshot.arenaWidthMilli,
    arenaHeightMilli: snapshot.arenaHeightMilli,
  };
}

function toWireEntity(entity: BattleEntitySnapshot): Record<string, unknown> {
  const kind = entity.kind === "player"
    ? 1
    : entity.kind === "enemy"
      ? 2
      : entity.kind === "projectile"
        ? 3
        : 4;
  return {
    ...entity,
    kind,
    ...(entity.shipSystems ? {
      shipSystems: {
        ...entity.shipSystems,
        modules: entity.shipSystems.modules.map((module) => ({
          ...module,
          parentModuleId: module.parentModuleId ?? ""
        })),
        weapons: entity.shipSystems.weapons.map((weapon) => ({
          ...weapon,
          moduleId: weapon.moduleId ?? ""
        }))
      }
    } : {})
  };
}

function parseSafeUint64(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || (parsed as number) < 0) {
    throw new Error("Unsigned 64-bit protocol value exceeds the JavaScript safe integer range.");
  }
  return parsed as number;
}

function parseInteger(value: unknown): number {
  if (!Number.isSafeInteger(value)) throw new Error("Protocol value must be an integer.");
  return value as number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultProtoPath(): string {
  return fileURLToPath(import.meta.resolve("@spacey/protocol/spacey/battle/v1/battle.proto"));
}
