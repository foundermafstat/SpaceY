import assert from "node:assert/strict";
import test from "node:test";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { MemoryPlatformRepository } from "../platform/memory-platform.repository.js";
import { PublicApiGuard } from "./public-api.guard.js";
import type { PublicQuotaService } from "./public-quota.service.js";
import { DeveloperApiService } from "./developer-api.service.js";
import { PublicTokenService } from "./public-token.service.js";

async function fixture() {
  const repository = new MemoryPlatformRepository();
  const tokens = new PublicTokenService();
  const profile = await repository.authenticateTelegram({
    initDataHash: "developer-onboarding-fixture",
    authDate: new Date(),
    replayExpiresAt: new Date(Date.now() + 60_000),
    identity: {
      telegramUserId: "70001",
      username: null,
      firstName: "Developer",
      lastName: null,
      languageCode: "en",
      isPremium: false,
      photoUrl: null,
    },
  });
  return { repository, tokens, service: new DeveloperApiService(repository, tokens), userId: profile.id };
}

test("developer credentials are revealed once and support bounded overlap rotation", async () => {
  const { repository, tokens, service, userId } = await fixture();
  const created = await service.createClient(userId, { name: "Partner", scopes: ["catalog:read", "stats:read"] });
  assert.match(created.oauthClientSecret, /^spsec_/);
  assert.equal(JSON.stringify(created.client).includes("secretHash"), false);

  const oldOAuthHash = tokens.hashCredential(created.oauthClientSecret);
  assert.ok(await repository.authenticatePublicClient(created.client.clientId, oldOAuthHash));
  const rotated = await service.rotateOAuthSecret(userId, created.client.id, 60);
  assert.ok(await repository.authenticatePublicClient(created.client.clientId, oldOAuthHash));
  assert.ok(await repository.authenticatePublicClient(created.client.clientId, tokens.hashCredential(rotated.oauthClientSecret)));

  const key = await service.createApiKey(userId, created.client.id, {
    name: "Server key",
    scopes: ["catalog:read"],
    expiresInDays: 90,
  });
  assert.match(key.apiKey, /^spk_/);
  assert.ok(await repository.authenticatePublicApiKey(tokens.hashCredential(key.apiKey)));
  const rotatedKey = await service.rotateApiKey(userId, created.client.id, key.client.apiKeys[0]!.id, 60);
  assert.ok(await repository.authenticatePublicApiKey(tokens.hashCredential(key.apiKey)));
  assert.ok(await repository.authenticatePublicApiKey(tokens.hashCredential(rotatedKey.apiKey)));
});

test("client revocation invalidates OAuth, API keys and webhooks", async () => {
  const { repository, tokens, service, userId } = await fixture();
  const created = await service.createClient(userId, { name: "Partner", scopes: ["catalog:read"] });
  const key = await service.createApiKey(userId, created.client.id, {
    name: "Key",
    scopes: ["catalog:read"],
    expiresInDays: null,
  });
  const webhook = await service.createWebhook(userId, created.client.id, {
    url: "https://partner.example.com/spacey",
    eventTypes: ["content.release.published"],
  });
  assert.match(webhook.webhookSecret, /^spwh_/);
  await service.revokeClient(userId, created.client.id);
  assert.equal(await repository.authenticatePublicClient(created.client.clientId, tokens.hashCredential(created.oauthClientSecret)), null);
  assert.equal(await repository.authenticatePublicApiKey(tokens.hashCredential(key.apiKey)), null);
  const listed = await service.list(userId);
  assert.equal(listed[0]?.status, "revoked");
  assert.equal(listed[0]?.webhooks[0]?.status, "revoked");
});

test("revoking a client invalidates already-issued OAuth bearer tokens", async () => {
  const { repository, tokens, service, userId } = await fixture();
  const created = await service.createClient(userId, { name: "Partner", scopes: ["catalog:read"] });
  const principal = await repository.authenticatePublicClient(
    created.client.clientId,
    tokens.hashCredential(created.oauthClientSecret),
  );
  assert.ok(principal);
  const bearer = await tokens.sign(principal, principal.scopes);
  const request = { headers: { authorization: `Bearer ${bearer}` } };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
  const guard = new PublicApiGuard(
    new Reflector(),
    repository,
    tokens,
    { consume: async () => undefined } as unknown as PublicQuotaService,
  );
  assert.equal(await guard.canActivate(context), true);
  await service.revokeClient(userId, created.client.id);
  await assert.rejects(() => guard.canActivate(context), /API key is invalid/);
});
