import assert from "node:assert/strict";
import test from "node:test";
import { MemoryPlatformRepository } from "./memory-platform.repository.js";

const identity = {
  telegramUserId: "123456789",
  username: "ada",
  firstName: "Ada",
  lastName: "Lovelace",
  languageCode: "en",
  isPremium: false,
  photoUrl: null
};

test("Telegram payload is single-use", async () => {
  const repository = new MemoryPlatformRepository();
  const input = {
    initDataHash: "a".repeat(64),
    authDate: new Date(),
    replayExpiresAt: new Date(Date.now() + 60_000),
    identity
  };
  await repository.authenticateTelegram(input);
  await assert.rejects(() => repository.authenticateTelegram(input), /already used/);
});

test("refresh rotation detects reuse and revokes the token family", async () => {
  const repository = new MemoryPlatformRepository();
  const profile = await repository.authenticateTelegram({
    initDataHash: "b".repeat(64),
    authDate: new Date(),
    replayExpiresAt: new Date(Date.now() + 60_000),
    identity
  });
  await repository.createRefreshSession({
    userId: profile.id,
    refreshTokenHash: "first",
    expiresAt: new Date(Date.now() + 60_000),
    ipHash: null,
    userAgentHash: null,
    maxActiveSessions: 5
  });
  const rotated = await repository.rotateRefreshSession({
    currentTokenHash: "first",
    nextTokenHash: "second",
    nextExpiresAt: new Date(Date.now() + 60_000),
    ipHash: null,
    userAgentHash: null
  });
  assert.equal(rotated.kind, "rotated");
  assert.equal((await repository.rotateRefreshSession({
    currentTokenHash: "first",
    nextTokenHash: "third",
    nextExpiresAt: new Date(Date.now() + 60_000),
    ipHash: null,
    userAgentHash: null
  })).kind, "reuse");
  assert.equal((await repository.rotateRefreshSession({
    currentTokenHash: "second",
    nextTokenHash: "fourth",
    nextExpiresAt: new Date(Date.now() + 60_000),
    ipHash: null,
    userAgentHash: null
  })).kind, "invalid");
});

test("attempt status cannot be read by another player", async () => {
  const repository = new MemoryPlatformRepository();
  const owner = await repository.authenticateTelegram({
    initDataHash: "c".repeat(64), authDate: new Date(), replayExpiresAt: new Date(Date.now() + 60_000), identity,
  });
  const stranger = await repository.authenticateTelegram({
    initDataHash: "d".repeat(64), authDate: new Date(), replayExpiresAt: new Date(Date.now() + 60_000),
    identity: { ...identity, telegramUserId: "987654321" },
  });
  const build = (await repository.getBootstrap(owner.id)).activeBuild;
  assert.ok(build);
  const attempt = await repository.createMissionAttempt({
    userId: owner.id,
    missionId: "starter-scout",
    shipBuildRevisionId: build.activeRevision.id,
    idempotencyKey: "attempt-owner-only",
    ticketHash: "ticket",
    ticketExpiresAt: new Date(Date.now() + 30_000),
  });
  assert.ok(await repository.getMissionAttemptStatus(owner.id, attempt.attemptId));
  assert.equal(await repository.getMissionAttemptStatus(stranger.id, attempt.attemptId), null);
});

test("development public profile and aggregate views contain no Telegram identity", async () => {
  const repository = new MemoryPlatformRepository();
  const player = await repository.authenticateTelegram({
    initDataHash: "e".repeat(64), authDate: new Date(), replayExpiresAt: new Date(Date.now() + 60_000), identity,
  });
  assert.equal(await repository.getPublicProfile(player.id), null);
  await repository.updatePrivacyPreferences(player.id, { profilePublic: true, analyticsConsent: true });
  const profile = await repository.getPublicProfile(player.id);
  assert.equal(profile?.displayName, "Ada Lovelace");
  assert.equal("telegramUserId" in (profile ?? {}), false);
  const stats = await repository.getPublicAggregateStats();
  assert.equal(stats.consentedPlayers, 1);
  assert.equal(stats.publishedContentVersion, "dev-1");
});

test("privacy requests are owner-scoped, idempotent and deletion immediately withdraws consent", async () => {
  const repository = new MemoryPlatformRepository();
  const owner = await repository.authenticateTelegram({
    initDataHash: "f".repeat(64), authDate: new Date(), replayExpiresAt: new Date(Date.now() + 60_000), identity,
  });
  const stranger = await repository.authenticateTelegram({
    initDataHash: "1".repeat(64), authDate: new Date(), replayExpiresAt: new Date(Date.now() + 60_000),
    identity: { ...identity, telegramUserId: "777777777" },
  });
  await repository.updatePrivacyPreferences(owner.id, { profilePublic: true, analyticsConsent: true });
  await repository.createRefreshSession({
    userId: owner.id,
    refreshTokenHash: "privacy-session",
    expiresAt: new Date(Date.now() + 60_000),
    ipHash: null,
    userAgentHash: null,
    maxActiveSessions: 5,
  });

  const input = { type: "delete" as const, idempotencyKey: "privacy-delete-0001" };
  const created = await repository.createPrivacyRequest(owner.id, input);
  assert.equal((await repository.createPrivacyRequest(owner.id, input)).id, created.id);
  assert.equal(await repository.getPrivacyRequest(stranger.id, created.id), null);
  assert.deepEqual(await repository.getPrivacyPreferences(owner.id), {
    profilePublic: false,
    analyticsConsent: false,
    analyticsConsentUpdatedAt: created.requestedAt,
    updatedAt: created.requestedAt,
  });
  assert.equal(await repository.getPublicProfile(owner.id), null);
  assert.equal((await repository.rotateRefreshSession({
    currentTokenHash: "privacy-session",
    nextTokenHash: "privacy-session-next",
    nextExpiresAt: new Date(Date.now() + 60_000),
    ipHash: null,
    userAgentHash: null,
  })).kind, "invalid");
  await assert.rejects(
    () => repository.createPrivacyRequest(owner.id, { type: "export", idempotencyKey: input.idempotencyKey }),
    /Idempotency key was reused/,
  );
});
