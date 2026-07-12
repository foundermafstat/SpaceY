import assert from "node:assert/strict";
import test from "node:test";

import { resolvePvpMatchmakingAction } from "../game/server/pvp-matchmaking.ts";

function ticket(status, match = null) {
  return {
    id: "01900000-0000-7000-8000-000000000001",
    queue: "ranked-eu",
    region: "eu",
    mmr: 1_000,
    status,
    createdAt: "2026-07-11T00:00:00.000Z",
    expiresAt: "2026-07-11T00:05:00.000Z",
    match,
  };
}

const match = {
  matchId: "01900000-0000-7000-8000-000000000002",
  sessionId: "01900000-0000-7000-8000-000000000003",
  attemptId: "01900000-0000-7000-8000-000000000004",
  runtimeState: "ready",
  connection: null,
};

test("completed PvP ticket resolves through its persisted attempt result", () => {
  assert.deepEqual(resolvePvpMatchmakingAction(ticket("completed", match)), {
    type: "result",
    attemptId: match.attemptId,
  });
});

test("queued and matched PvP tickets keep their expected actions", () => {
  assert.deepEqual(resolvePvpMatchmakingAction(ticket("queued")), { type: "poll" });
  assert.deepEqual(resolvePvpMatchmakingAction(ticket("matched", match)), { type: "connect" });
});
