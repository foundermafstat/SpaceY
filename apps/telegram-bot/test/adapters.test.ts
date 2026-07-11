import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import { loadTelegramBotConfig } from "../src/config.js";
import { parseTelegramUpdate } from "../src/domain/telegram-update.js";
import { TelegramHttpTransport } from "../src/infrastructure/telegram-http-transport.js";
import { TelegramPostgresAdapter, type TelegramPgPool } from "../src/infrastructure/postgres-adapter.js";

const validEnv = {
  NODE_ENV: "production",
  TELEGRAM_WEBHOOK_SECRET: "a_secure_webhook_secret_1234567890",
  TELEGRAM_BOT_TOKEN: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijk",
  TELEGRAM_DATABASE_URL: "postgresql://bot:secret@db.example.test/spacey?sslmode=require",
  SPACEY_MINI_APP_URL: "https://game.example.test/",
} satisfies NodeJS.ProcessEnv;

function result<T extends QueryResultRow>(rows: T[]): QueryResult<T> {
  return { rows, rowCount: rows.length, command: "", oid: 0, fields: [] };
}

function claimPool(responses: QueryResult<QueryResultRow>[]): TelegramPgPool {
  return {
    query: async <T extends QueryResultRow>() => responses.shift() as QueryResult<T>,
    connect: async () => { throw new Error("not used"); },
    end: async () => undefined,
  };
}

test("production config requires the dedicated database URL and keeps Stars disabled", () => {
  const config = loadTelegramBotConfig(validEnv);
  assert.equal(config.starsEnabled, false);
  assert.equal(config.databasePoolSize, 5);

  assert.throws(() => loadTelegramBotConfig({ ...validEnv, TELEGRAM_DATABASE_URL: undefined, DATABASE_URL: validEnv.TELEGRAM_DATABASE_URL }));
  assert.throws(() => loadTelegramBotConfig({ ...validEnv, TELEGRAM_STARS_ENABLED: "true" }), /cannot be enabled/);
  assert.throws(() => loadTelegramBotConfig({ ...validEnv, TELEGRAM_API_BASE_URL: "https://attacker.example" }), /official Telegram API/);
});

test("Telegram transport sends a plain JSON launch button with bounded request settings", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const transport = new TelegramHttpTransport(loadTelegramBotConfig(validEnv), async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
  });

  await transport.sendMessage(42, "Launch", { launchMiniApp: true });
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.init?.redirect, "error");
  const payload = JSON.parse(String(requests[0]?.init?.body)) as Record<string, unknown>;
  assert.equal(payload.chat_id, 42);
  assert.deepEqual(payload.reply_markup, {
    inline_keyboard: [[{ text: "Open SpaceY", web_app: { url: "https://game.example.test/" } }]],
  });
});

test("Telegram transport sanitizes network failures and validates readiness identity", async () => {
  const token = validEnv.TELEGRAM_BOT_TOKEN;
  const failed = new TelegramHttpTransport(loadTelegramBotConfig(validEnv), async () => {
    throw new Error(`upstream ${token}`);
  });
  await assert.rejects(() => failed.check(), (error: unknown) => {
    assert.equal(String(error).includes(token), false);
    return true;
  });

  const ready = new TelegramHttpTransport(loadTelegramBotConfig(validEnv), async () => new Response(
    JSON.stringify({ ok: true, result: { id: 1, is_bot: true } }),
    { status: 200 },
  ));
  await ready.check();
});

test("PostgreSQL deduplicator distinguishes claimed, completed and in-flight updates", async () => {
  const claimed = new TelegramPostgresAdapter(claimPool([result([{ status: "PROCESSING" }])]), { processingLeaseSeconds: 120 });
  assert.equal(await claimed.claim(1), "claimed");

  const duplicate = new TelegramPostgresAdapter(claimPool([result([]), result([{ status: "COMPLETED" }])]), { processingLeaseSeconds: 120 });
  assert.equal(await duplicate.claim(2), "duplicate");

  const busy = new TelegramPostgresAdapter(claimPool([result([]), result([{ status: "PROCESSING" }])]), { processingLeaseSeconds: 120 });
  assert.equal(await busy.claim(3), "busy");
});

test("referrals are parameterized and validated before persistence", async () => {
  const captured: Array<{ sql: string; values?: unknown[] }> = [];
  const pool = {
    query: async <T extends QueryResultRow>(sql: string, values?: unknown[]) => {
      captured.push({ sql, values });
      return result([]) as QueryResult<T>;
    },
    connect: async () => { throw new Error("not used"); },
    end: async () => undefined,
  } satisfies TelegramPgPool;
  const adapter = new TelegramPostgresAdapter(pool, { processingLeaseSeconds: 120 });

  await adapter.recordReferral({ telegramUserId: 10, referralCode: "squad_7", updateId: 20 });
  assert.equal(captured[0]?.sql.includes("squad_7"), false);
  assert.equal(captured[0]?.values?.[2], "squad_7");
  await assert.rejects(() => adapter.recordReferral({ telegramUserId: 10, referralCode: "x'); DROP TABLE users;--", updateId: 21 }));
});

test("nested Telegram identifiers are validated before routing", () => {
  assert.throws(() => parseTelegramUpdate({
    update_id: 1,
    message: { message_id: 1, chat: { id: "not-a-number" }, from: { id: 2 }, text: "/start" },
  }));
});
