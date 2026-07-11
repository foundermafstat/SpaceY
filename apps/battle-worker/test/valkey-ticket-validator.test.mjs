import assert from "node:assert/strict";
import test from "node:test";

import { ValkeyBattleTicketValidator } from "../src/valkey.ts";
import { battleTicketKey } from "../src/valkey-schema.ts";

test("Valkey ticket validator consumes the hashed key exactly once", async () => {
  const rawTicket = "opaque-ticket-value-123456789";
  const values = new Map([[battleTicketKey(rawTicket), JSON.stringify({
    sessionId: "session-1",
    attemptId: "attempt-1",
    userId: "user-1",
    mode: "pve"
  })]]);
  const requestedKeys = [];
  const redis = {
    async getdel(key) {
      requestedKeys.push(key);
      const value = values.get(key) ?? null;
      values.delete(key);
      return value;
    }
  };
  const validator = new ValkeyBattleTicketValidator(redis);
  assert.deepEqual(await validator.validateAndConsume(rawTicket), {
    sessionId: "session-1",
    attemptId: "attempt-1",
    userId: "user-1",
    mode: "pve"
  });
  assert.equal(await validator.validateAndConsume(rawTicket), null);
  assert.deepEqual(requestedKeys, [battleTicketKey(rawTicket), battleTicketKey(rawTicket)]);
});
