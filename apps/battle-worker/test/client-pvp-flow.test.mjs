import assert from "node:assert/strict";
import test from "node:test";

import { resolvePvpMatchmakingAction } from "../../../game/server/pvp-matchmaking.ts";

function ticket(status, match = null) {
  return {
    id: "01900000-0000-7000-8000-000000000001",
    queue: "ranked-eu",
    region: "eu",
    mmr: 1000,
    status,
    createdAt: "2026-07-11T00:00:00.000Z",
    expiresAt: "2026-07-11T00:10:00.000Z",
    match,
  };
}

test("client polls queued PvP tickets and connects only to a ready authoritative duel", () => {
  assert.deepEqual(resolvePvpMatchmakingAction(ticket("queued")), { type: "poll" });
  assert.deepEqual(resolvePvpMatchmakingAction(ticket("matched", {
    matchId: "01900000-0000-7000-8000-000000000002",
    sessionId: "01900000-0000-7000-8000-000000000003",
    attemptId: "01900000-0000-7000-8000-000000000004",
    runtimeState: "ready",
    connection: null,
  })), { type: "connect" });
});

test("client refuses matched tickets when duel capability is unavailable", () => {
  const action = resolvePvpMatchmakingAction(ticket("matched", {
    matchId: "01900000-0000-7000-8000-000000000002",
    sessionId: "01900000-0000-7000-8000-000000000003",
    attemptId: "01900000-0000-7000-8000-000000000004",
    runtimeState: "duel_protocol_unavailable",
    connection: null,
  }));
  assert.equal(action.type, "terminal");
});
