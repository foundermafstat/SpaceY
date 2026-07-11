import assert from "node:assert/strict";
import test from "node:test";

import {
  createConnectionPolicy,
  disconnectedAction,
  markDisconnected,
  reconnect
} from "../src/disconnect-policy.ts";

test("PvE pauses for the grace period and then forfeits", () => {
  const disconnected = markDisconnected(createConnectionPolicy("pve"), 1_000);
  assert.equal(disconnectedAction(disconnected, 60_999).action, "pause");
  const expired = disconnectedAction(disconnected, 61_000);
  assert.equal(expired.action, "forfeit");
  assert.equal(expired.state.forfeited, true);
});

test("PvP continues with neutral input until the same forfeit deadline", () => {
  const disconnected = markDisconnected(createConnectionPolicy("pvp"), 5_000);
  assert.equal(disconnectedAction(disconnected, 64_999).action, "neutral_input");
  assert.equal(disconnectedAction(disconnected, 65_000).action, "forfeit");
});

test("reconnect before deadline restores active advancement", () => {
  const disconnected = markDisconnected(createConnectionPolicy("pve"), 100);
  const connected = reconnect(disconnected, 60_099);
  assert.equal(connected.accepted, true);
  assert.equal(disconnectedAction(connected.state, 90_000).action, "advance");
});

test("reconnect at or after deadline is rejected", () => {
  const disconnected = markDisconnected(createConnectionPolicy("pvp"), 100);
  const expired = reconnect(disconnected, 60_100);
  assert.equal(expired.accepted, false);
  assert.equal(disconnectedAction(expired.state, 60_100).action, "forfeit");
});
