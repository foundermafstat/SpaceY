"use client";

import type {
  BattleClientMessage,
  BattleEntitySnapshot,
  BattleObjectiveSnapshot,
  BattleServerMessage,
  BattleSnapshot,
  PvpParticipantContext,
  ReconnectMetadata
} from "@spacey/protocol";

const textDecoder = new TextDecoder();

export function encodeBattleClientMessage(message: BattleClientMessage): Uint8Array {
  const envelope = new Writer();
  if (message.type === "session.resume") {
    envelope.message(1, (writer) => writer.uint(1, message.lastAcknowledgedInputSequence));
  } else if (message.type === "input.command") {
    envelope.message(2, (writer) => {
      writer.uint(1, message.command.seq);
      writer.uint(2, message.command.targetTick);
      writer.sint32(3, message.command.moveX);
      writer.sint32(4, message.command.moveY);
      writer.sint32(5, message.command.aimX);
      writer.sint32(6, message.command.aimY);
      writer.uint(7, message.command.actionFlags);
    });
  } else {
    envelope.message(3, (writer) => writer.uint(1, message.nonce));
  }
  return envelope.finish();
}

export function decodeBattleServerMessage(bytes: Uint8Array): BattleServerMessage {
  const reader = new Reader(bytes);
  let message: BattleServerMessage | null = null;
  while (!reader.done) {
    const { field, wire } = reader.tag();
    if (wire !== 2) {
      reader.skip(wire);
      continue;
    }
    const nested = reader.message();
    if (field === 1) message = decodeInitial(nested);
    else if (field === 2) message = { type: "battle.snapshot", snapshot: decodeSnapshot(nested) };
    else if (field === 3) message = decodeEvent(nested);
    else if (field === 4) message = decodeEnded(nested);
    else if (field === 5) message = decodeError(nested);
    else if (field === 6) message = decodePong(nested);
  }
  if (!message) throw new Error("Battle server envelope did not contain a supported payload.");
  return message;
}

function decodeInitial(reader: Reader): BattleServerMessage {
  let protocolVersion = "";
  let mode: "pve" | "pvp" = "pve";
  let snapshot: BattleSnapshot | null = null;
  let participant: PvpParticipantContext | null = null;
  let reconnect: ReconnectMetadata = {
    permitted: false,
    disconnectedAt: null,
    deadlineAt: null,
    lastProcessedInputSequence: 0,
    latestCheckpointTick: 0
  };
  readFields(reader, (field, wire) => {
    if (field === 1 && wire === 2) protocolVersion = reader.string();
    else if (field === 2 && wire === 0) mode = reader.uint() === 2 ? "pvp" : "pve";
    else if (field === 3 && wire === 2) snapshot = decodeSnapshot(reader.message());
    else if (field === 4 && wire === 2) reconnect = decodeReconnect(reader.message());
    else if (field === 5 && wire === 2) participant = decodeParticipant(reader.message());
    else reader.skip(wire);
  });
  if (!snapshot || !protocolVersion) throw new Error("Invalid battle.initial payload.");
  return {
    type: "battle.initial",
    protocolVersion: protocolVersion as "spacey-battle-v1",
    mode,
    participant,
    snapshot,
    reconnect
  };
}

function decodeSnapshot(reader: Reader): BattleSnapshot {
  let sessionId = "";
  let tick = 0;
  let stateHash = "";
  let lastProcessedInputSequence = 0;
  let status: BattleSnapshot["status"] = "active";
  let objective: BattleObjectiveSnapshot = { type: "destroy_all", progress: 0, target: 0 };
  const entities: BattleEntitySnapshot[] = [];
  readFields(reader, (field, wire) => {
    if (field === 1 && wire === 2) sessionId = reader.string();
    else if (field === 2 && wire === 0) tick = reader.uint();
    else if (field === 3 && wire === 2) stateHash = reader.string();
    else if (field === 4 && wire === 0) lastProcessedInputSequence = reader.uint();
    else if (field === 5 && wire === 0) {
      const value = reader.uint();
      status = value === 2 ? "victory" : value === 3 ? "defeat" : "active";
    } else if (field === 6 && wire === 2) objective = decodeObjective(reader.message());
    else if (field === 7 && wire === 2) entities.push(decodeEntity(reader.message()));
    else reader.skip(wire);
  });
  if (!sessionId) throw new Error("Battle snapshot has no session id.");
  return { sessionId, tick, stateHash, lastProcessedInputSequence, status, objective, entities };
}

function decodeObjective(reader: Reader): BattleObjectiveSnapshot {
  let type = "destroy_all";
  let progress = 0;
  let target = 0;
  readFields(reader, (field, wire) => {
    if (field === 1 && wire === 2) type = reader.string();
    else if (field === 2 && wire === 0) progress = reader.uint();
    else if (field === 3 && wire === 0) target = reader.uint();
    else reader.skip(wire);
  });
  return {
    type: type === "survive_seconds" ? "survive_seconds" : type === "destroy_opponent" ? "destroy_opponent" : "destroy_all",
    progress,
    target
  };
}

function decodeParticipant(reader: Reader): PvpParticipantContext {
  let matchId = "";
  let participantId = "";
  let side: 0 | 1 = 0;
  readFields(reader, (field, wire) => {
    if (field === 1 && wire === 2) matchId = reader.string();
    else if (field === 2 && wire === 2) participantId = reader.string();
    else if (field === 3 && wire === 0) side = reader.uint() === 1 ? 1 : 0;
    else reader.skip(wire);
  });
  if (!matchId || !participantId) throw new Error("Invalid PvP participant context.");
  return { matchId, participantId, side };
}

function decodeEntity(reader: Reader): BattleEntitySnapshot {
  let id = "";
  let kind: BattleEntitySnapshot["kind"] = "objective";
  let xMilli = 0;
  let yMilli = 0;
  let velocityXMilliPerTick = 0;
  let velocityYMilliPerTick = 0;
  let rotationMilliRadians = 0;
  let hull = 0;
  let hullMax = 0;
  let flags = 0;
  readFields(reader, (field, wire) => {
    if (field === 1 && wire === 2) id = reader.string();
    else if (field === 2 && wire === 0) {
      const value = reader.uint();
      kind = value === 1 ? "player" : value === 2 ? "enemy" : value === 3 ? "projectile" : "objective";
    } else if (field === 3 && wire === 0) xMilli = reader.sint32();
    else if (field === 4 && wire === 0) yMilli = reader.sint32();
    else if (field === 5 && wire === 0) velocityXMilliPerTick = reader.sint32();
    else if (field === 6 && wire === 0) velocityYMilliPerTick = reader.sint32();
    else if (field === 7 && wire === 0) rotationMilliRadians = reader.sint32();
    else if (field === 8 && wire === 0) hull = reader.uint();
    else if (field === 9 && wire === 0) hullMax = reader.uint();
    else if (field === 10 && wire === 0) flags = reader.uint();
    else reader.skip(wire);
  });
  return {
    id,
    kind,
    xMilli,
    yMilli,
    velocityXMilliPerTick,
    velocityYMilliPerTick,
    rotationMilliRadians,
    hull,
    hullMax,
    flags
  };
}

function decodeReconnect(reader: Reader): ReconnectMetadata {
  let permitted = false;
  let disconnectedAt: string | null = null;
  let deadlineAt: string | null = null;
  let lastProcessedInputSequence = 0;
  let latestCheckpointTick = 0;
  readFields(reader, (field, wire) => {
    if (field === 1 && wire === 0) permitted = reader.uint() !== 0;
    else if (field === 2 && wire === 2) disconnectedAt = nullableString(reader.string());
    else if (field === 3 && wire === 2) deadlineAt = nullableString(reader.string());
    else if (field === 4 && wire === 0) lastProcessedInputSequence = reader.uint();
    else if (field === 5 && wire === 0) latestCheckpointTick = reader.uint();
    else reader.skip(wire);
  });
  return { permitted, disconnectedAt, deadlineAt, lastProcessedInputSequence, latestCheckpointTick };
}

function decodeEvent(reader: Reader): BattleServerMessage {
  let eventId = 0;
  let tick = 0;
  let eventType = "";
  const entityIds: string[] = [];
  readFields(reader, (field, wire) => {
    if (field === 1 && wire === 0) eventId = reader.uint();
    else if (field === 2 && wire === 0) tick = reader.uint();
    else if (field === 3 && wire === 2) eventType = reader.string();
    else if (field === 4 && wire === 2) entityIds.push(reader.string());
    else reader.skip(wire);
  });
  return { type: "battle.event", eventId, tick, eventType, entityIds };
}

function decodeEnded(reader: Reader): BattleServerMessage {
  let resultId = "";
  let outcome: "victory" | "defeat" | "forfeit" = "defeat";
  let reason = "";
  let finalTick = 0;
  let finalStateHash = "";
  readFields(reader, (field, wire) => {
    if (field === 1 && wire === 2) resultId = reader.string();
    else if (field === 2 && wire === 2) {
      const value = reader.string();
      outcome = value === "victory" ? "victory" : value === "forfeit" ? "forfeit" : "defeat";
    } else if (field === 3 && wire === 2) reason = reader.string();
    else if (field === 4 && wire === 0) finalTick = reader.uint();
    else if (field === 5 && wire === 2) finalStateHash = reader.string();
    else reader.skip(wire);
  });
  return { type: "battle.ended", resultId, outcome, reason, finalTick, finalStateHash };
}

function decodeError(reader: Reader): BattleServerMessage {
  let code = "session_error";
  let message = "Battle session failed.";
  let retryable = false;
  readFields(reader, (field, wire) => {
    if (field === 1 && wire === 2) code = reader.string();
    else if (field === 2 && wire === 2) message = reader.string();
    else if (field === 3 && wire === 0) retryable = reader.uint() !== 0;
    else reader.skip(wire);
  });
  return { type: "session.error", code, message, retryable };
}

function decodePong(reader: Reader): BattleServerMessage {
  let nonce = 0;
  let serverTick = 0;
  readFields(reader, (field, wire) => {
    if (field === 1 && wire === 0) nonce = reader.uint();
    else if (field === 2 && wire === 0) serverTick = reader.uint();
    else reader.skip(wire);
  });
  return { type: "pong", nonce, serverTick };
}

function readFields(reader: Reader, read: (field: number, wire: number) => void) {
  while (!reader.done) {
    const { field, wire } = reader.tag();
    read(field, wire);
  }
}

function nullableString(value: string): string | null {
  return value.length > 0 ? value : null;
}

class Writer {
  private readonly bytes: number[] = [];

  uint(field: number, value: number) {
    this.tag(field, 0);
    this.varint(BigInt(Math.max(0, Math.trunc(value))));
  }

  sint32(field: number, value: number) {
    this.tag(field, 0);
    const integer = BigInt(Math.trunc(value));
    this.varint((integer << 1n) ^ (integer >> 63n));
  }

  message(field: number, build: (writer: Writer) => void) {
    const nested = new Writer();
    build(nested);
    const bytes = nested.finish();
    this.tag(field, 2);
    this.varint(BigInt(bytes.length));
    this.bytes.push(...bytes);
  }

  finish() {
    return Uint8Array.from(this.bytes);
  }

  private tag(field: number, wire: number) {
    this.varint(BigInt((field << 3) | wire));
  }

  private varint(value: bigint) {
    let current = BigInt.asUintN(64, value);
    while (current > 0x7fn) {
      this.bytes.push(Number((current & 0x7fn) | 0x80n));
      current >>= 7n;
    }
    this.bytes.push(Number(current));
  }
}

class Reader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get done() {
    return this.offset >= this.bytes.length;
  }

  tag() {
    const tag = this.varint();
    const field = Number(tag >> 3n);
    const wire = Number(tag & 0x7n);
    if (field <= 0) throw new Error("Invalid protobuf field number.");
    return { field, wire };
  }

  uint() {
    const value = this.varint();
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Protobuf integer exceeds JavaScript safe range.");
    return Number(value);
  }

  sint32() {
    const value = this.varint();
    return Number((value >> 1n) ^ -(value & 1n));
  }

  string() {
    return textDecoder.decode(this.lengthDelimited());
  }

  message() {
    return new Reader(this.lengthDelimited());
  }

  skip(wire: number) {
    if (wire === 0) {
      void this.varint();
      return;
    }
    if (wire === 1) {
      this.advance(8);
      return;
    }
    if (wire === 2) {
      void this.lengthDelimited();
      return;
    }
    if (wire === 5) {
      this.advance(4);
      return;
    }
    throw new Error(`Unsupported protobuf wire type ${wire}.`);
  }

  private lengthDelimited() {
    const length = this.uint();
    const start = this.offset;
    this.advance(length);
    return this.bytes.subarray(start, start + length);
  }

  private varint() {
    let result = 0n;
    let shift = 0n;
    for (let index = 0; index < 10; index += 1) {
      const byte = this.readByte();
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7n;
    }
    throw new Error("Invalid protobuf varint.");
  }

  private readByte() {
    if (this.done) throw new Error("Unexpected end of protobuf payload.");
    return this.bytes[this.offset++]!;
  }

  private advance(length: number) {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.bytes.length) {
      throw new Error("Invalid protobuf length.");
    }
    this.offset += length;
  }
}
