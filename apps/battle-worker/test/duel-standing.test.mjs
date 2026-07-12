import assert from "node:assert/strict";
import test from "node:test";

import { resolveDuelStandings } from "../src/postgres-finalizer.ts";

const alpha = { userId: "alpha", currentRating: 1_000 };
const beta = { userId: "beta", currentRating: 1_000 };

function outcome(reason, winnerUserId, loserUserId, results) {
  return {
    matchId: "match-1",
    sessionId: "session-1",
    winnerUserId,
    loserUserId,
    reason,
    finalTick: reason === "no_contest" ? 0 : 100,
    finalStateHash: "state-hash",
    results,
  };
}

test("regular draw preserves MMR and increments draw counters", () => {
  const standings = resolveDuelStandings(alpha, beta, outcome("draw", null, null, [
    { userId: "alpha", outcome: "draw", reason: "draw" },
    { userId: "beta", outcome: "draw", reason: "draw" },
  ]), 32);
  assert.deepEqual(standings.get("alpha"), { rating: 1_000, wins: 0, losses: 0, draws: 1 });
  assert.deepEqual(standings.get("beta"), { rating: 1_000, wins: 0, losses: 0, draws: 1 });
});

test("no contest preserves MMR without recording standings", () => {
  const standings = resolveDuelStandings(alpha, beta, outcome("no_contest", null, null, [
    { userId: "alpha", outcome: "draw", reason: "no_contest" },
    { userId: "beta", outcome: "draw", reason: "no_contest" },
  ]), 32);
  assert.deepEqual(standings.get("alpha"), { rating: 1_000, wins: 0, losses: 0, draws: 0 });
  assert.deepEqual(standings.get("beta"), { rating: 1_000, wins: 0, losses: 0, draws: 0 });
});

test("decisive duel applies Elo and win/loss counters", () => {
  const standings = resolveDuelStandings(alpha, beta, outcome("ship_destroyed", "alpha", "beta", [
    { userId: "alpha", outcome: "victory", reason: "ship_destroyed" },
    { userId: "beta", outcome: "defeat", reason: "ship_destroyed" },
  ]), 32);
  assert.deepEqual(standings.get("alpha"), { rating: 1_016, wins: 1, losses: 0, draws: 0 });
  assert.deepEqual(standings.get("beta"), { rating: 984, wins: 0, losses: 1, draws: 0 });
});
