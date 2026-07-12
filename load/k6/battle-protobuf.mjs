// Minimal protobuf encoder/inspector for the fields used by the load harness.
// The authoritative schema remains packages/protocol/proto/spacey/battle/v1/battle.proto.

export const ServerEnvelopeField = Object.freeze({
  initial: 1,
  snapshot: 2,
  event: 3,
  ended: 4,
  error: 5,
  pong: 6,
});

export function encodeInputCommand(sequence, actionFlags = 1) {
  requireSafeInteger(sequence, "sequence", 1);
  requireSafeInteger(actionFlags, "actionFlags", 0);
  const command = [
    ...varintField(1, sequence),
    ...varintField(2, 0),
    ...signedVarintField(3, 0),
    ...signedVarintField(4, 0),
    ...signedVarintField(5, 1_000),
    ...signedVarintField(6, 0),
    ...varintField(7, actionFlags),
  ];
  return lengthDelimitedField(2, command);
}

export function encodeSessionResume(lastAcknowledgedInputSequence) {
  requireSafeInteger(lastAcknowledgedInputSequence, "lastAcknowledgedInputSequence", 0);
  return lengthDelimitedField(1, varintField(1, lastAcknowledgedInputSequence));
}

export function serverEnvelopeField(data) {
  const bytes = toBytes(data);
  if (bytes.length === 0) return 0;
  const key = readVarint(bytes, 0).value;
  return key % 8 === 2 ? Math.floor(key / 8) : 0;
}

export function exactArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function lengthDelimitedField(fieldNumber, payload) {
  return Uint8Array.from([
    ...encodeVarint(fieldNumber * 8 + 2),
    ...encodeVarint(payload.length),
    ...payload,
  ]);
}

function varintField(fieldNumber, value) {
  return [...encodeVarint(fieldNumber * 8), ...encodeVarint(value)];
}

function signedVarintField(fieldNumber, value) {
  const zigzag = value < 0 ? (-value * 2) - 1 : value * 2;
  return varintField(fieldNumber, zigzag);
}

function encodeVarint(value) {
  requireSafeInteger(value, "varint", 0);
  const output = [];
  let remaining = value;
  while (remaining >= 128) {
    output.push((remaining % 128) + 128);
    remaining = Math.floor(remaining / 128);
  }
  output.push(remaining);
  return output;
}

function readVarint(bytes, offset) {
  let result = 0;
  let multiplier = 1;
  for (let index = offset; index < bytes.length && index < offset + 8; index += 1) {
    const byte = bytes[index];
    result += (byte % 128) * multiplier;
    if (byte < 128) return { value: result, nextOffset: index + 1 };
    multiplier *= 128;
  }
  throw new Error("Malformed protobuf varint.");
}

function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new Error("Expected a binary WebSocket frame.");
}

function requireSafeInteger(value, name, minimum) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be a safe integer >= ${minimum}.`);
  }
}
