import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.USE_IN_MEMORY_REPOSITORY = "true";

test("PvE ticket rotation rejects an older request that completes after a newer version", async () => {
  const { BattleTicketStore } = await import("./battle-ticket.store.js");
  const store = new BattleTicketStore();
  const claims = {
    sessionId: "01900000-0000-7000-8000-000000000101",
    attemptId: "01900000-0000-7000-8000-000000000102",
    userId: "01900000-0000-7000-8000-000000000103",
    mode: "pve" as const,
  };
  const firstTicket = "first-ticket";
  const secondTicket = "second-ticket";
  const hash = (ticket: string) => createHash("sha256").update(ticket).digest("hex");

  await store.rotatePveTicket({ rawTicket: firstTicket, previousTicketHash: null, claims, ticketVersion: 1 });
  await store.rotatePveTicket({
    rawTicket: secondTicket,
    previousTicketHash: hash(firstTicket),
    claims,
    ticketVersion: 2,
  });
  await assert.rejects(
    () => store.rotatePveTicket({
      rawTicket: "late-first-version",
      previousTicketHash: null,
      claims,
      ticketVersion: 1,
    }),
    /newer battle connection ticket/,
  );

  const memory = (store as unknown as { memory: Map<string, unknown> }).memory;
  assert.equal(memory.has(`spacey:ws-ticket:${hash(firstTicket)}`), false);
  assert.equal(memory.has(`spacey:ws-ticket:${hash(secondTicket)}`), true);
  assert.equal(memory.has(`spacey:ws-ticket:${hash("late-first-version")}`), false);
  await store.onModuleDestroy();
});

test("pending PvP publication keeps one immutable definition before any connection", async () => {
  const { BattleTicketStore } = await import("./battle-ticket.store.js");
  const store = new BattleTicketStore();
  const definition = {
    kind: "pvp" as const,
    participants: [],
    simulationConfig: { sessionId: "session-zero-attach", matchId: "match-zero-attach" },
    readyDeadlineAtMs: 20_000,
  };

  await store.publishPendingPvpSession(definition as never);
  await store.publishPendingPvpSession(definition as never);
  await assert.rejects(
    () => store.publishPendingPvpSession({ ...definition, readyDeadlineAtMs: 30_000 } as never),
    /Battle routing is temporarily unavailable/,
  );

  const memory = (store as unknown as { memory: Map<string, { value: unknown }> }).memory;
  assert.deepEqual(memory.get("spacey:battle:definition:session-zero-attach")?.value, definition);
  await store.onModuleDestroy();
});

test("out-of-order PvP rotation deletes the actual current ticket and keeps only the newest version", async () => {
  const { BattleTicketStore } = await import("./battle-ticket.store.js");
  const store = new BattleTicketStore();
  const claims = {
    sessionId: "01900000-0000-7000-8000-000000000201",
    attemptId: "01900000-0000-7000-8000-000000000202",
    userId: "01900000-0000-7000-8000-000000000203",
    mode: "pvp" as const,
    matchId: "01900000-0000-7000-8000-000000000204",
    participantId: "01900000-0000-7000-8000-000000000205",
    side: 0 as const,
  };
  const firstTicket = "pvp-first-ticket";
  const intermediateTicket = "pvp-intermediate-ticket";
  const newestTicket = "pvp-newest-ticket";
  const hash = (ticket: string) => createHash("sha256").update(ticket).digest("hex");

  await store.rotatePvpTicket({
    rawTicket: firstTicket,
    previousTicketHash: null,
    claims,
    ticketVersion: 1,
  });
  await store.rotatePvpTicket({
    rawTicket: newestTicket,
    previousTicketHash: hash(intermediateTicket),
    claims,
    ticketVersion: 3,
  });
  await assert.rejects(
    () => store.rotatePvpTicket({
      rawTicket: intermediateTicket,
      previousTicketHash: hash(firstTicket),
      claims,
      ticketVersion: 2,
    }),
    /newer battle connection ticket/,
  );

  const memory = (store as unknown as { memory: Map<string, unknown> }).memory;
  assert.equal(memory.has(`spacey:ws-ticket:${hash(firstTicket)}`), false);
  assert.equal(memory.has(`spacey:ws-ticket:${hash(intermediateTicket)}`), false);
  assert.equal(memory.has(`spacey:ws-ticket:${hash(newestTicket)}`), true);
  await store.onModuleDestroy();
});

test("attempt revocation removes the currently issued ticket without resetting its version", async () => {
  const { BattleTicketStore } = await import("./battle-ticket.store.js");
  const store = new BattleTicketStore();
  const claims = {
    sessionId: "01900000-0000-7000-8000-000000000301",
    attemptId: "01900000-0000-7000-8000-000000000302",
    userId: "01900000-0000-7000-8000-000000000303",
    mode: "pve" as const,
  };
  const ticket = "revoked-attempt-ticket";
  const hash = createHash("sha256").update(ticket).digest("hex");

  await store.rotatePveTicket({ rawTicket: ticket, previousTicketHash: null, claims, ticketVersion: 1 });
  await store.revokeAttempt(claims.attemptId);

  const memory = (store as unknown as { memory: Map<string, unknown> }).memory;
  assert.equal(memory.has(`spacey:ws-ticket:${hash}`), false);
  await assert.rejects(
    () => store.rotatePveTicket({ rawTicket: "late-v1", previousTicketHash: null, claims, ticketVersion: 1 }),
    /newer battle connection ticket/,
  );
  await store.onModuleDestroy();
});

test("user revocation removes every unconsumed ticket owned by that user", async () => {
  const { BattleTicketStore } = await import("./battle-ticket.store.js");
  const store = new BattleTicketStore();
  const userId = "01900000-0000-7000-8000-000000000403";
  const tickets = ["user-ticket-one", "user-ticket-two"];
  const attempts = [
    "01900000-0000-7000-8000-000000000401",
    "01900000-0000-7000-8000-000000000402",
  ];

  for (const [index, attemptId] of attempts.entries()) {
    await store.rotatePveTicket({
      rawTicket: tickets[index]!,
      previousTicketHash: null,
      claims: { sessionId: `session-${index}`, attemptId, userId, mode: "pve" },
      ticketVersion: 1,
    });
  }
  await store.revokeUser(userId);

  const memory = (store as unknown as { memory: Map<string, unknown> }).memory;
  for (const ticket of tickets) {
    const hash = createHash("sha256").update(ticket).digest("hex");
    assert.equal(memory.has(`spacey:ws-ticket:${hash}`), false);
  }
  await store.onModuleDestroy();
});
