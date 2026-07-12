import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { ApiError } from "../common/api-error.js";
import { env } from "../config/env.js";
import type { TelegramPlayerIdentity } from "../platform/platform.repository.js";

const telegramUserSchema = z.object({
  id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
  first_name: z.string().min(1).max(128),
  last_name: z.string().max(128).optional(),
  username: z.string().max(64).optional(),
  language_code: z.string().max(16).optional(),
  is_premium: z.boolean().optional(),
  photo_url: z.string().url().max(2048).optional()
});

export type VerifiedTelegramInitData = {
  initDataHash: string;
  authDate: Date;
  replayExpiresAt: Date;
  identity: TelegramPlayerIdentity;
};

@Injectable()
export class TelegramInitDataVerifier {
  verify(rawInitData: string, now = new Date()): VerifiedTelegramInitData {
    if (!env.TELEGRAM_BOT_TOKEN) {
      throw new ApiError("telegram_auth_unavailable", 503, "Telegram authorization is not configured.");
    }

    const params = new URLSearchParams(rawInitData);
    const suppliedHash = params.get("hash")?.toLowerCase();
    const authDateSeconds = Number(params.get("auth_date"));
    const rawUser = params.get("user");
    if (!suppliedHash || !/^[a-f0-9]{64}$/.test(suppliedHash) || !Number.isSafeInteger(authDateSeconds) || !rawUser) {
      throw new ApiError("telegram_init_data_invalid", 401, "Telegram authorization payload is invalid.");
    }

    const dataCheckString = [...params.entries()]
      // Telegram's bot-token HMAC covers every received field except `hash`.
      // The newer `signature` field is excluded only from third-party Ed25519
      // validation, not from this first-party HMAC data-check-string.
      .filter(([key]) => key !== "hash")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");
    const secretKey = createHmac("sha256", "WebAppData").update(env.TELEGRAM_BOT_TOKEN).digest();
    const calculatedHash = createHmac("sha256", secretKey).update(dataCheckString).digest();
    const suppliedHashBytes = Buffer.from(suppliedHash, "hex");
    if (suppliedHashBytes.length !== calculatedHash.length || !timingSafeEqual(suppliedHashBytes, calculatedHash)) {
      throw new ApiError("telegram_signature_invalid", 401, "Telegram authorization signature is invalid.");
    }

    const nowSeconds = Math.floor(now.getTime() / 1000);
    if (authDateSeconds > nowSeconds + env.TELEGRAM_AUTH_FUTURE_SKEW_SECONDS) {
      throw new ApiError("telegram_auth_date_future", 401, "Telegram authorization timestamp is in the future.");
    }
    if (nowSeconds - authDateSeconds > env.TELEGRAM_AUTH_MAX_AGE_SECONDS) {
      throw new ApiError("telegram_auth_expired", 401, "Telegram authorization payload has expired.");
    }

    let user: z.infer<typeof telegramUserSchema>;
    try {
      user = telegramUserSchema.parse(JSON.parse(rawUser));
    } catch {
      throw new ApiError("telegram_user_invalid", 401, "Telegram user payload is invalid.");
    }

    return {
      initDataHash: createHash("sha256").update(rawInitData).digest("hex"),
      authDate: new Date(authDateSeconds * 1000),
      replayExpiresAt: new Date((authDateSeconds + env.TELEGRAM_AUTH_MAX_AGE_SECONDS) * 1000),
      identity: {
        telegramUserId: String(user.id),
        username: user.username ?? null,
        firstName: user.first_name,
        lastName: user.last_name ?? null,
        languageCode: user.language_code ?? null,
        isPremium: user.is_premium ?? false,
        photoUrl: user.photo_url ?? null
      }
    };
  }
}
