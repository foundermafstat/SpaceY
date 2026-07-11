import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

function decodeBase32(encoded: Uint8Array): Buffer {
  const normalized = Buffer.from(encoded).toString("ascii").toUpperCase().replace(/[\s=-]/g, "");
  if (!normalized || [...normalized].some((character) => !BASE32_ALPHABET.includes(character))) {
    throw new Error("Invalid base32 TOTP secret");
  }
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const character of normalized) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function generateTotpCode(secretBase32: Uint8Array, step: number): string {
  if (!Number.isSafeInteger(step) || step < 0) throw new Error("Invalid TOTP step");
  const secret = decodeBase32(secretBase32);
  try {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const digest = createHmac("sha1", secret).update(counter).digest();
    const offset = digest[digest.length - 1]! & 0x0f;
    const binary = ((digest[offset]! & 0x7f) << 24)
      | ((digest[offset + 1]! & 0xff) << 16)
      | ((digest[offset + 2]! & 0xff) << 8)
      | (digest[offset + 3]! & 0xff);
    return String(binary % 1_000_000).padStart(6, "0");
  } finally {
    secret.fill(0);
  }
}

export function verifyTotpCode(
  secretBase32: Uint8Array,
  candidate: string,
  timestampMs: number,
  window = 1,
): number | null {
  if (!/^\d{6}$/.test(candidate) || !Number.isFinite(timestampMs) || window < 0 || window > 1) return null;
  const current = Math.floor(timestampMs / 30_000);
  const offsets = window === 0 ? [0] : [0, -1, 1];
  const supplied = Buffer.from(candidate, "ascii");
  for (const offset of offsets) {
    const step = current + offset;
    if (step < 0) continue;
    const expected = Buffer.from(generateTotpCode(secretBase32, step), "ascii");
    if (timingSafeEqual(supplied, expected)) return step;
  }
  return null;
}

export function normalizeRecoveryCode(code: string): string {
  return code.trim().toUpperCase().replace(/[\s-]/g, "");
}

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashRecoveryCode(code: string): Promise<string> {
  const normalized = normalizeRecoveryCode(code);
  if (normalized.length < 10) throw new Error("Recovery code is too short");
  const salt = randomBytes(16);
  const hash = await scryptAsync(normalized, salt);
  return `scrypt$v1$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyRecoveryCode(code: string, encoded: string): Promise<boolean> {
  const [algorithm, version, n, r, p, saltValue, hashValue, extra] = encoded.split("$");
  if (
    algorithm !== "scrypt" || version !== "v1" || extra !== undefined
    || Number(n) !== SCRYPT_N || Number(r) !== SCRYPT_R || Number(p) !== SCRYPT_P
    || !saltValue || !hashValue
  ) return false;
  try {
    const expected = Buffer.from(hashValue, "base64url");
    if (expected.length !== 32) return false;
    const actual = await scryptAsync(normalizeRecoveryCode(code), Buffer.from(saltValue, "base64url"));
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
