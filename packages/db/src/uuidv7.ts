import { randomBytes } from "node:crypto";

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_UUID_V7_TIMESTAMP = 0xffffffffffffn;

/** Creates an RFC 9562 UUIDv7 using a 48-bit Unix millisecond timestamp. */
export function createUuidV7(timestampMs = Date.now()): string {
  if (!Number.isSafeInteger(timestampMs) || timestampMs < 0) {
    throw new RangeError("UUIDv7 timestamp must be a non-negative safe integer");
  }

  const timestamp = BigInt(timestampMs);
  if (timestamp > MAX_UUID_V7_TIMESTAMP) {
    throw new RangeError("UUIDv7 timestamp exceeds 48 bits");
  }

  const bytes = randomBytes(16);
  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isUuidV7(value: string): boolean {
  return UUID_V7_PATTERN.test(value);
}
