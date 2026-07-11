import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { ApiError } from "../common/api-error.js";
import { MemoryPlatformRepository } from "../platform/memory-platform.repository.js";
import type { MatchmakingTicketRecord } from "../platform/platform.repository.js";
import { MatchmakingQueueStore } from "./matchmaking-queue.store.js";
import { MatchmakingService } from "./matchmaking.service.js";

class TestBattleTicketStore {
  readonly claims: Array<{ rawTicket: string; claims: unknown }> = [];
  readonly definitions: Array<{ sessionId: string; definition: unknown }> = [];
  readonly revoked: string[] = [];

  async issue(rawTicket: string, claims: unknown) { this.claims.push({ rawTicket, claims }); }
  async issueDefinition(sessionId: string, definition: unknown) { this.definitions.push({ sessionId, definition }); }
  async revokeHash(ticketHash: string) { this.revoked.push(ticketHash); }
}

function ticket(overrides: Partial<MatchmakingTicketRecord>): MatchmakingTicketRecord {
  return {
    ticketId: overrides.ticketId ?? randomUUID(),
    userId: overrides.userId ?? randomUUID(),
    buildRevisionId: overrides.buildRevisionId ?? randomUUID(),
    queue: "ranked-eu",
    region: "eu",
    mmr: 1_000,
    status: "queued",
    createdAt: new Date(0),
    expiresAt: new Date(600_000),
    policy: { baseMmrWindow: 50, expansionPerSecond: 10, maxMmrWindow: 200 },
    match: null,
    ...overrides,
  };
}

test("MMR window expands for both players and produces one atomic claim", async () => {
  const queue = new MatchmakingQueueStore({ useMemory: true, valkeyUrl: "redis://unused", claimLeaseMs: 15_000 });
  const first = ticket({ ticketId: randomUUID(), userId: randomUUID(), mmr: 1_000 });
  const second = ticket({ ticketId: randomUUID(), userId: randomUUID(), mmr: 1_120 });
  await queue.enqueue(first);
  await queue.enqueue(second);
  assert.equal(await queue.tryMatch(second, 0), null);
  const claim = await queue.tryMatch(second, 7_000);
  assert.ok(claim);
  assert.deepEqual(new Set([claim.leftTicketId, claim.rightTicketId]), new Set([first.ticketId, second.ticketId]));
  assert.equal(await queue.cancel(first), "claimed");
  await queue.release(claim);
  assert.equal(await queue.cancel(first), "cancelled");
});

test("a wide MMR window cannot force-match an opponent whose own window is narrow", async () => {
  const queue = new MatchmakingQueueStore({ useMemory: true, valkeyUrl: "redis://unused", claimLeaseMs: 15_000 });
  const wide = ticket({
    mmr: 1_000,
    policy: { baseMmrWindow: 500, expansionPerSecond: 0, maxMmrWindow: 500 },
  });
  const narrow = ticket({
    mmr: 1_300,
    policy: { baseMmrWindow: 50, expansionPerSecond: 0, maxMmrWindow: 50 },
  });
  await queue.enqueue(wide);
  await queue.enqueue(narrow);
  assert.equal(await queue.tryMatch(wide, 1_000), null);
});

test("matchmaking creates one match and issues isolated participant connections", async () => {
  const repository = new MemoryPlatformRepository();
  const first = await repository.authenticateTelegram({
    initDataHash: "1".repeat(64), authDate: new Date(), replayExpiresAt: new Date(Date.now() + 60_000),
    identity: { telegramUserId: "101", username: "one", firstName: "One", lastName: null, languageCode: "en", isPremium: false, photoUrl: null },
  });
  const second = await repository.authenticateTelegram({
    initDataHash: "2".repeat(64), authDate: new Date(), replayExpiresAt: new Date(Date.now() + 60_000),
    identity: { telegramUserId: "202", username: "two", firstName: "Two", lastName: null, languageCode: "en", isPremium: false, photoUrl: null },
  });
  const firstBuild = (await repository.getBootstrap(first.id)).activeBuild!;
  const secondBuild = (await repository.getBootstrap(second.id)).activeBuild!;
  const queue = new MatchmakingQueueStore({ useMemory: true, valkeyUrl: "redis://unused", claimLeaseMs: 15_000 });
  const tickets = new TestBattleTicketStore();
  const service = new MatchmakingService(repository, queue, { enabled: true, duelRuntimeReady: true }, tickets as never);

  const firstTicket = await service.create(first.id, {
    queue: "ranked-eu", shipBuildRevisionId: firstBuild.activeRevision.id, idempotencyKey: "first-player-key-0001",
  });
  assert.equal(firstTicket.status, "queued");
  const secondTicket = await service.create(second.id, {
    queue: "ranked-eu", shipBuildRevisionId: secondBuild.activeRevision.id, idempotencyKey: "second-player-key-001",
  });
  assert.equal(secondTicket.status, "matched");
  assert.equal(secondTicket.match?.connection, null);
  assert.equal(secondTicket.match?.runtimeState, "ready");

  const refreshedFirst = await service.get(first.id, firstTicket.id);
  assert.equal(refreshedFirst?.status, "matched");
  assert.equal(refreshedFirst?.match?.matchId, secondTicket.match?.matchId);
  assert.equal(refreshedFirst?.match?.sessionId, secondTicket.match?.sessionId);
  const firstConnection = await service.connection(first.id, firstTicket.id);
  const secondConnection = await service.connection(second.id, secondTicket.id);
  assert.ok(firstConnection);
  assert.ok(secondConnection);
  assert.equal(firstConnection.sessionId, secondConnection.sessionId);
  assert.equal(firstConnection.matchId, secondConnection.matchId);
  assert.equal(firstConnection.websocketUrl, secondConnection.websocketUrl);
  assert.equal(new URL(firstConnection.websocketUrl).searchParams.get("route"), firstConnection.sessionId);
  assert.notEqual(firstConnection.ticket, secondConnection.ticket);
  assert.deepEqual(new Set([firstConnection.side, secondConnection.side]), new Set([0, 1]));
  const resumedFirst = await service.connection(first.id, firstTicket.id);
  assert.ok(resumedFirst);
  assert.notEqual(resumedFirst.ticket, firstConnection.ticket);
  assert.equal(resumedFirst.participantId, firstConnection.participantId);
  assert.equal(tickets.revoked.length, 1);
  assert.equal(tickets.claims.length, 3);
  assert.equal(tickets.definitions.length, 3);
});

test("PvP connection issuance fails closed when runtime capability is disabled", async () => {
  const repository = new MemoryPlatformRepository();
  const queue = new MatchmakingQueueStore({ useMemory: true, valkeyUrl: "redis://unused", claimLeaseMs: 15_000 });
  const service = new MatchmakingService(repository, queue, { enabled: true, duelRuntimeReady: false }, new TestBattleTicketStore() as never);
  await assert.rejects(
    () => service.connection(randomUUID(), randomUUID()),
    (error: unknown) => error instanceof ApiError && error.code === "pvp_duel_runtime_unavailable",
  );
});

test("disabled matchmaking fails closed before creating a ticket", async () => {
  const repository = new MemoryPlatformRepository();
  const queue = new MatchmakingQueueStore({ useMemory: true, valkeyUrl: "redis://unused", claimLeaseMs: 15_000 });
  const service = new MatchmakingService(repository, queue, { enabled: false, duelRuntimeReady: false }, new TestBattleTicketStore() as never);
  await assert.rejects(
    () => service.create(randomUUID(), {
      queue: "ranked-eu", shipBuildRevisionId: randomUUID(), idempotencyKey: "disabled-player-key1",
    }),
    (error: unknown) => error instanceof ApiError && error.code === "pvp_matchmaking_disabled",
  );
});

test("ticket creation is idempotent, owner-scoped and cancellable while queued", async () => {
  const repository = new MemoryPlatformRepository();
  const owner = await repository.authenticateTelegram({
    initDataHash: "3".repeat(64), authDate: new Date(), replayExpiresAt: new Date(Date.now() + 60_000),
    identity: { telegramUserId: "303", username: null, firstName: "Owner", lastName: null, languageCode: "en", isPremium: false, photoUrl: null },
  });
  const stranger = await repository.authenticateTelegram({
    initDataHash: "4".repeat(64), authDate: new Date(), replayExpiresAt: new Date(Date.now() + 60_000),
    identity: { telegramUserId: "404", username: null, firstName: "Stranger", lastName: null, languageCode: "en", isPremium: false, photoUrl: null },
  });
  const build = (await repository.getBootstrap(owner.id)).activeBuild!;
  const queue = new MatchmakingQueueStore({ useMemory: true, valkeyUrl: "redis://unused", claimLeaseMs: 15_000 });
  const service = new MatchmakingService(repository, queue, { enabled: true, duelRuntimeReady: true }, new TestBattleTicketStore() as never);
  const request = {
    queue: "ranked-eu", shipBuildRevisionId: build.activeRevision.id, idempotencyKey: "owner-idempotency-0001",
  };
  const first = await service.create(owner.id, request);
  const replay = await service.create(owner.id, request);
  assert.equal(replay.id, first.id);
  assert.equal(await service.get(stranger.id, first.id), null);
  await assert.rejects(
    () => service.connection(owner.id, first.id),
    (error: unknown) => error instanceof ApiError && error.code === "pvp_match_not_ready",
  );
  assert.equal((await service.cancel(owner.id, first.id))?.status, "cancelled");
  assert.equal((await service.cancel(owner.id, first.id))?.status, "cancelled");
});
