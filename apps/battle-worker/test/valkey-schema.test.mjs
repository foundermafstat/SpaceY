import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { battleTicketKey, parseBattleTicketClaims } from "../src/valkey-schema.ts";

test("ticket key contains only a SHA-256 digest of the opaque credential", () => {
  const rawTicket = "opaque-ticket-value-that-must-not-be-logged";
  const expected = createHash("sha256").update(rawTicket).digest("hex");
  const key = battleTicketKey(rawTicket);
  assert.equal(key, `spacey:ws-ticket:${expected}`);
  assert.equal(key.includes(rawTicket), false);
});

test("ticket claim payload is accepted only with the complete handshake identity", () => {
  assert.deepEqual(parseBattleTicketClaims(JSON.stringify({
    sessionId: "session-1",
    attemptId: "attempt-1",
    userId: "user-1",
    mode: "pve"
  })), {
    sessionId: "session-1",
    attemptId: "attempt-1",
    userId: "user-1",
    mode: "pve"
  });
  assert.equal(parseBattleTicketClaims("not-json"), null);
  assert.equal(parseBattleTicketClaims(JSON.stringify({ sessionId: "session-1", mode: "pve" })), null);
  assert.equal(parseBattleTicketClaims(JSON.stringify({
    sessionId: "session-1",
    attemptId: "attempt-1",
    userId: "user-1",
    mode: "admin"
  })), null);
});
