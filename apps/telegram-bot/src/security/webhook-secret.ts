import { timingSafeEqual } from "node:crypto";

export function verifyWebhookSecret(provided: string | undefined, expected: string): boolean {
  if (!provided || !expected) return false;
  const expectedBytes = Buffer.from(expected, "utf8");
  const providedBytes = Buffer.from(provided, "utf8");
  if (providedBytes.length !== expectedBytes.length) {
    timingSafeEqual(expectedBytes, Buffer.alloc(expectedBytes.length));
    return false;
  }
  return timingSafeEqual(providedBytes, expectedBytes);
}
