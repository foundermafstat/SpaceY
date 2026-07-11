import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.TELEGRAM_BOT_TOKEN = "test-bot-token";

const { TelegramInitDataVerifier } = await import("./telegram-init-data.verifier.js");
const { ApiError } = await import("../common/api-error.js");

function signedInitData(authDate: number, overrides: Record<string, string> = {}) {
  const values = {
    auth_date: String(authDate),
    query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
    user: JSON.stringify({ id: 123456789, first_name: "Ada", language_code: "en" }),
    ...overrides
  };
  const dataCheckString = Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(process.env.TELEGRAM_BOT_TOKEN!).digest();
  const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  return new URLSearchParams({ ...values, hash }).toString();
}

test("accepts a correctly signed, fresh Telegram payload", () => {
  const now = new Date("2026-07-11T10:00:00.000Z");
  const verifier = new TelegramInitDataVerifier();
  const result = verifier.verify(signedInitData(Math.floor(now.getTime() / 1000)), now);
  assert.equal(result.identity.telegramUserId, "123456789");
  assert.equal(result.identity.firstName, "Ada");
  assert.match(result.initDataHash, /^[a-f0-9]{64}$/);
});

test("rejects tampered Telegram user data", () => {
  const now = new Date("2026-07-11T10:00:00.000Z");
  const raw = signedInitData(Math.floor(now.getTime() / 1000)).replace("Ada", "Mallory");
  assert.throws(() => new TelegramInitDataVerifier().verify(raw, now), (error) => {
    return error instanceof ApiError && error.code === "telegram_signature_invalid";
  });
});

test("rejects expired and future Telegram payloads", () => {
  const now = new Date("2026-07-11T10:00:00.000Z");
  const nowSeconds = Math.floor(now.getTime() / 1000);
  assert.throws(
    () => new TelegramInitDataVerifier().verify(signedInitData(nowSeconds - 301), now),
    (error) => error instanceof ApiError && error.code === "telegram_auth_expired"
  );
  assert.throws(
    () => new TelegramInitDataVerifier().verify(signedInitData(nowSeconds + 31), now),
    (error) => error instanceof ApiError && error.code === "telegram_auth_date_future"
  );
});
