import assert from "node:assert/strict";
import test from "node:test";

import {
  fingerprintTelegramInitData,
  readTelegramLaunchClaim,
  telegramUserIdFromInitData,
  writeTelegramLaunchClaim,
} from "../game/server/telegram-launch-claim.ts";

function storage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  };
}

test("launch claim recognizes the same verified Telegram launch after reload", async () => {
  const initData = new URLSearchParams({
    auth_date: "1783760400",
    hash: "fixture",
    user: JSON.stringify({ id: 9000000001, first_name: "SpaceY" }),
  }).toString();
  const fingerprint = await fingerprintTelegramInitData(initData);
  const sessionStorage = storage();

  assert.equal(telegramUserIdFromInitData(initData), "9000000001");
  assert.equal(readTelegramLaunchClaim(sessionStorage, fingerprint), null);
  writeTelegramLaunchClaim(sessionStorage, { fingerprint, telegramUserId: "9000000001" });
  assert.deepEqual(readTelegramLaunchClaim(sessionStorage, fingerprint), {
    fingerprint,
    telegramUserId: "9000000001",
  });
});

test("a different launch fingerprint cannot reuse the previous claim", async () => {
  const sessionStorage = storage();
  const first = await fingerprintTelegramInitData("user=first&hash=one");
  const second = await fingerprintTelegramInitData("user=second&hash=two");
  writeTelegramLaunchClaim(sessionStorage, { fingerprint: first, telegramUserId: "1" });

  assert.equal(readTelegramLaunchClaim(sessionStorage, second), null);
  assert.equal(telegramUserIdFromInitData("user=not-json"), null);
});
