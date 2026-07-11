import { ServiceUnavailableException } from "@nestjs/common";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const ADMIN_SECRET_CIPHER = Symbol("spacey.admin-secret-cipher");

export type EncryptedAdminSecret = Readonly<{ keyVersion: string; ciphertext: Buffer }>;

export interface AdminSecretCipher {
  encrypt(context: string, plaintext: Uint8Array): EncryptedAdminSecret;
  decrypt(context: string, keyVersion: string, ciphertext: Uint8Array): Buffer;
  ready(): boolean;
}

export class UnavailableAdminSecretCipher implements AdminSecretCipher {
  encrypt(): never {
    throw new ServiceUnavailableException("Admin recovery secret cipher is not configured");
  }

  decrypt(): never {
    throw new ServiceUnavailableException("Admin recovery secret cipher is not configured");
  }

  ready(): boolean {
    return false;
  }
}

export class AesGcmAdminSecretCipher implements AdminSecretCipher {
  constructor(
    private readonly activeVersion: string,
    private readonly keys: ReadonlyMap<string, Buffer>,
  ) {
    if (!keys.has(activeVersion)) throw new Error("Active admin TOTP key version is missing from the keyring");
  }

  encrypt(context: string, plaintext: Uint8Array): EncryptedAdminSecret {
    const key = this.keys.get(this.activeVersion);
    if (!key) throw new ServiceUnavailableException("Active admin TOTP key is unavailable");
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.from(`${context}:${this.activeVersion}`, "utf8"));
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return { keyVersion: this.activeVersion, ciphertext: Buffer.concat([nonce, tag, encrypted]) };
  }

  decrypt(context: string, keyVersion: string, ciphertext: Uint8Array): Buffer {
    const key = this.keys.get(keyVersion);
    if (!key) throw new ServiceUnavailableException("Admin TOTP key version is unavailable");
    const payload = Buffer.from(ciphertext);
    if (payload.length < 29) throw new ServiceUnavailableException("Encrypted admin TOTP secret is malformed");
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, payload.subarray(0, 12));
      decipher.setAAD(Buffer.from(`${context}:${keyVersion}`, "utf8"));
      decipher.setAuthTag(payload.subarray(12, 28));
      return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]);
    } catch {
      throw new ServiceUnavailableException("Encrypted admin TOTP secret failed authentication");
    }
  }

  ready(): boolean {
    return true;
  }
}

export function createAdminSecretCipher(env: NodeJS.ProcessEnv = process.env): AdminSecretCipher {
  const serialized = env.ADMIN_TOTP_KEYRING?.trim();
  const activeVersion = env.ADMIN_TOTP_ACTIVE_KEY_VERSION?.trim();
  if (!serialized || !activeVersion) {
    if (env.NODE_ENV === "production") {
      throw new Error("ADMIN_TOTP_KEYRING and ADMIN_TOTP_ACTIVE_KEY_VERSION are required in production");
    }
    return new UnavailableAdminSecretCipher();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("ADMIN_TOTP_KEYRING must be a JSON object of version to base64 key");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("ADMIN_TOTP_KEYRING must be a JSON object");
  }

  const keys = new Map<string, Buffer>();
  for (const [version, encoded] of Object.entries(parsed)) {
    if (!/^[A-Za-z0-9._-]{1,40}$/.test(version) || typeof encoded !== "string") {
      throw new Error("ADMIN_TOTP_KEYRING contains an invalid version or key");
    }
    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32 || key.toString("base64") !== encoded) {
      throw new Error(`ADMIN_TOTP_KEYRING key ${version} must be canonical base64 for 32 bytes`);
    }
    keys.set(version, key);
  }
  return new AesGcmAdminSecretCipher(activeVersion, keys);
}
