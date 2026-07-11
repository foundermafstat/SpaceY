import assert from "node:assert/strict";
import test from "node:test";
import { ServiceUnavailableException } from "@nestjs/common";
import { UpdateRouter } from "../src/application/update-router.js";
import { BotController } from "../src/bot.controller.js";
import type { TelegramBotConfig } from "../src/config.js";
import { verifyWebhookSecret } from "../src/security/webhook-secret.js";

const controllerConfig: TelegramBotConfig = {
  host: "127.0.0.1",
  port: 3103,
  webhookSecret: "a_secure_webhook_secret_1234567890",
  botToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijk",
  databaseUrl: "postgresql://unused:unused@localhost/unused",
  databasePoolSize: 1,
  apiBaseUrl: "http://localhost",
  miniAppUrl: "http://localhost/game",
  requestTimeoutMs: 500,
  processingLeaseSeconds: 120,
  starsEnabled: false,
};

test("webhook secret comparison rejects absent and mismatched values", () => {
  assert.equal(verifyWebhookSecret(undefined, "expected-secret"), false);
  assert.equal(verifyWebhookSecret("wrong", "expected-secret"), false);
  assert.equal(verifyWebhookSecret("expected-secret", "expected-secret"), true);
});

test("start command records a valid referral", async () => {
  const recorded: string[] = [];
  const launchOptions: unknown[] = [];
  const router = new UpdateRouter({
    starsEnabled: false,
    referrals: { recordReferral: async ({ referralCode }) => { recorded.push(referralCode); } },
    support: { openRequest: async () => undefined, routeMessage: async () => false },
    notifications: { setPreference: async () => undefined },
    responder: { sendMessage: async (_chatId, _text, options) => { launchOptions.push(options); }, answerPreCheckout: async () => undefined },
  });

  const route = await router.route({
    update_id: 10,
    message: { message_id: 1, chat: { id: 20 }, from: { id: 30 }, text: "/start squad_7" },
  });
  assert.equal(route, "referral");
  assert.deepEqual(recorded, ["squad_7"]);
  assert.deepEqual(launchOptions, [{ launchMiniApp: true }]);
});

test("support command opens a durable request and acknowledges it", async () => {
  const opened: number[] = [];
  const replies: string[] = [];
  const router = new UpdateRouter({
    starsEnabled: false,
    referrals: { recordReferral: async () => undefined },
    support: {
      openRequest: async ({ updateId }) => { opened.push(updateId); },
      routeMessage: async () => false,
    },
    notifications: { setPreference: async () => undefined },
    responder: { sendMessage: async (_chatId, text) => { replies.push(text); }, answerPreCheckout: async () => undefined },
  });
  const route = await router.route({
    update_id: 12,
    message: { message_id: 1, chat: { id: 20 }, from: { id: 30 }, text: "/support" },
  });
  assert.equal(route, "support");
  assert.deepEqual(opened, [12]);
  assert.equal(replies.length, 1);
});

test("Stars pre-checkout is explicitly rejected while disabled", async () => {
  const decisions: boolean[] = [];
  const router = new UpdateRouter({
    starsEnabled: false,
    referrals: { recordReferral: async () => undefined },
    support: { openRequest: async () => undefined, routeMessage: async () => false },
    notifications: { setPreference: async () => undefined },
    responder: { sendMessage: async () => undefined, answerPreCheckout: async (_id, ok) => { decisions.push(ok); } },
  });
  const route = await router.route({ update_id: 11, pre_checkout_query: { id: "q", from: { id: 1 }, currency: "XTR", total_amount: 1, invoice_payload: "disabled" } });
  assert.equal(route, "stars-disabled");
  assert.deepEqual(decisions, [false]);
});

test("an in-flight duplicate returns retryable service unavailable instead of being acknowledged", async () => {
  const router = new UpdateRouter({
    starsEnabled: false,
    referrals: { recordReferral: async () => undefined },
    support: { openRequest: async () => undefined, routeMessage: async () => false },
    notifications: { setPreference: async () => undefined },
    responder: { sendMessage: async () => undefined, answerPreCheckout: async () => undefined },
  });
  const controller = new BotController(
    controllerConfig,
    { claim: async () => "busy", complete: async () => undefined, release: async () => undefined },
    { check: async () => undefined },
    { check: async () => undefined },
    router,
  );

  await assert.rejects(
    () => controller.webhook(controllerConfig.webhookSecret, { update_id: 20 }),
    ServiceUnavailableException,
  );
});

test("readiness requires both PostgreSQL and Telegram API checks", async () => {
  let checks = 0;
  const router = new UpdateRouter({
    starsEnabled: false,
    referrals: { recordReferral: async () => undefined },
    support: { openRequest: async () => undefined, routeMessage: async () => false },
    notifications: { setPreference: async () => undefined },
    responder: { sendMessage: async () => undefined, answerPreCheckout: async () => undefined },
  });
  const controller = new BotController(
    controllerConfig,
    { claim: async () => "claimed", complete: async () => undefined, release: async () => undefined },
    { check: async () => { checks += 1; } },
    { check: async () => { checks += 1; } },
    router,
  );
  assert.deepEqual(await controller.ready(), { status: "ready", service: "telegram-bot" });
  assert.equal(checks, 2);

  const unavailable = new BotController(
    controllerConfig,
    { claim: async () => "claimed", complete: async () => undefined, release: async () => undefined },
    { check: async () => { throw new Error("database unavailable"); } },
    { check: async () => undefined },
    router,
  );
  await assert.rejects(() => unavailable.ready(), ServiceUnavailableException);
});
