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
  });
  assert.equal(attempt.ticketVersion, 0);
  const rotated = await repository.renewMissionAttemptTicket({
    userId: owner.id,
    attemptId: attempt.attemptId,
    ticketHash: "ticket-2",
    ticketExpiresAt: new Date(Date.now() + 30_000),
  });
  assert.equal(rotated?.previousTicketHash, null);
  assert.equal(rotated?.ticketVersion, 1);
  assert.ok(await repository.getMissionAttemptStatus(owner.id, attempt.attemptId));
  assert.equal(await repository.getMissionAttemptStatus(stranger.id, attempt.attemptId), null);
  await assert.rejects(
    () => repository.createMissionAttempt({
      userId: owner.id,
      missionId: "starter-scout",
      shipBuildRevisionId: "01900000-0000-7000-8000-000000000999",
      idempotencyKey: "attempt-owner-only",
    }),
    /Idempotency key was reused/,
  );
});

test("bootstrap discriminates resumable PvE and queued or matched PvP lifecycle", async () => {
  const repository = new MemoryPlatformRepository();
  const left = await repository.authenticateTelegram({
    initDataHash: "1".repeat(64), authDate: new Date(), replayExpiresAt: new Date(Date.now() + 60_000), identity,
  });
  const right = await repository.authenticateTelegram({
    initDataHash: "2".repeat(64), authDate: new Date(), replayExpiresAt: new Date(Date.now() + 60_000),
    identity: { ...identity, telegramUserId: "222222222" },
  });
  const leftBuild = (await repository.getBootstrap(left.id)).activeBuild;
  const rightBuild = (await repository.getBootstrap(right.id)).activeBuild;
  assert.ok(leftBuild);
  assert.ok(rightBuild);

  const pve = await repository.createMissionAttempt({
    userId: left.id,
    missionId: "starter-scout",
    shipBuildRevisionId: leftBuild.activeRevision.id,
    idempotencyKey: "bootstrap-pve-attempt",
  });
  const pveGameplay = (await repository.getBootstrap(left.id)).activeGameplay[0];
  assert.equal(pveGameplay?.mode, "pve");
  assert.equal(pveGameplay?.mode === "pve" ? pveGameplay.attempt.attemptId : null, pve.attemptId);
  await repository.abandonMissionAttempt(left.id, pve.attemptId);

  const leftTicket = await repository.createMatchmakingTicket({
    userId: left.id,
    shipBuildRevisionId: leftBuild.activeRevision.id,
    queue: "ranked-eu",
    idempotencyKey: "bootstrap-pvp-left",
  });
  const queuedGameplay = (await repository.getBootstrap(left.id)).activeGameplay[0];
  assert.equal(queuedGameplay?.mode, "pvp");
  assert.equal(queuedGameplay?.mode === "pvp" ? queuedGameplay.matchmakingTicket.id : null, leftTicket.ticketId);
  assert.equal(queuedGameplay?.mode === "pvp" ? queuedGameplay.attempt : null, null);

  const rightTicket = await repository.createMatchmakingTicket({
    userId: right.id,
    shipBuildRevisionId: rightBuild.activeRevision.id,
    queue: "ranked-eu",
    idempotencyKey: "bootstrap-pvp-right",
  });
  const match = await repository.materializePvpMatch({
    callerUserId: left.id,
    leftTicketId: leftTicket.ticketId,
    rightTicketId: rightTicket.ticketId,
  });
  const matchedGameplay = (await repository.getBootstrap(left.id)).activeGameplay[0];
  assert.equal(matchedGameplay?.mode, "pvp");
  if (matchedGameplay?.mode !== "pvp") return;
  assert.equal(matchedGameplay.matchmakingTicket.match?.matchId, match.matchId);
  assert.equal(matchedGameplay.attempt?.attemptId, leftTicket.match?.attemptId ?? match.tickets[0]?.attemptId);
});

test("development content exposes three v2 PvE missions with authoritative rich configs", async () => {
  const repository = new MemoryPlatformRepository();
  const player = await repository.authenticateTelegram({
    initDataHash: "9".repeat(64), authDate: new Date(), replayExpiresAt: new Date(Date.now() + 60_000), identity,
  });
  const bootstrap = await repository.getBootstrap(player.id);
  assert.ok(bootstrap.activeBuild);
  const shipBuildRevisionId = bootstrap.activeBuild.activeRevision.id;
  assert.deepEqual(
    bootstrap.missions.map((mission) => mission.id),
    ["starter-scout", "convoy-guard", "salvage-sweep"],
  );
  const objectives = new Map();
  for (const mission of bootstrap.missions) {
    const attempt = await repository.createMissionAttempt({
      userId: player.id,
      missionId: mission.id,
      shipBuildRevisionId,
      idempotencyKey: `mission-${mission.id}`,
    });
    objectives.set(mission.id, attempt.simulationConfig.objective.type);
    assert.equal(attempt.simulationConfig.simulationVersion, "2.0.0");
    assert.ok((attempt.simulationConfig.player.modules?.length ?? 0) >= 5);
    assert.ok(attempt.simulationConfig.player.modules?.every((module) => module.inventoryItemId === module.id));
    assert.ok((attempt.simulationConfig.player.weapons?.length ?? 0) >= 1);
  }
  assert.deepEqual(Object.fromEntries(objectives), {
    "starter-scout": "destroy_all",
    "convoy-guard": "protect_target",
    "salvage-sweep": "collect_scrap",
  });
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
  assert.equal(stats.publishedContentVersion, "dev-2");
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
  const session = await repository.createRefreshSession({
    userId: owner.id,
    refreshTokenHash: "privacy-session",
    expiresAt: new Date(Date.now() + 60_000),
    ipHash: null,
    userAgentHash: null,
    maxActiveSessions: 5,
  });
  assert.equal(await repository.isAccessSessionActive(owner.id, session.id), true);

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
  assert.equal(await repository.isAccessSessionActive(owner.id, session.id), false);
  await assert.rejects(
    () => repository.createRefreshSession({
      userId: owner.id,
      refreshTokenHash: "privacy-session-after-delete",
      expiresAt: new Date(Date.now() + 60_000),
      ipHash: null,
      userAgentHash: null,
      maxActiveSessions: 5,
    }),
    /Inactive player/,
  );
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
