import assert from "node:assert/strict";
import test from "node:test";

import { ValkeyBattleTicketValidator } from "../src/valkey.ts";
import { battleTicketKey, battleTicketStateKeyPrefix } from "../src/valkey-schema.ts";

function createRedisDouble(values, states) {
  const requestedKeys = [];
  return {
    requestedKeys,
    async eval(_script, keyCount, ticketKey, statePrefix) {
      assert.equal(keyCount, 1);
      assert.equal(statePrefix, battleTicketStateKeyPrefix);
      requestedKeys.push(ticketKey);
      const serialized = values.get(ticketKey) ?? null;
      if (!serialized) return null;
      const payload = JSON.parse(serialized);
      const state = states.get(`${statePrefix}${payload.attemptId}`);
      if (!state
        || state.version !== payload.ticketVersion
        || state.ticketKey !== ticketKey
        || state.userId !== payload.userId) {
        values.delete(ticketKey);
        return null;
      }
      values.delete(ticketKey);
      state.ticketKey = null;
      return serialized;
    },
  };
}

test("Valkey ticket validator consumes the current version exactly once", async () => {
  const rawTicket = "opaque-ticket-value-123456789";
  const key = battleTicketKey(rawTicket);
  const values = new Map([[key, JSON.stringify({
    sessionId: "session-1",
    attemptId: "attempt-1",
    userId: "user-1",
    mode: "pve",
    ticketVersion: 2,
  })]]);
  const states = new Map([[`${battleTicketStateKeyPrefix}attempt-1`, { version: 2, ticketKey: key, userId: "user-1" }]]);
  const redis = createRedisDouble(values, states);
  const validator = new ValkeyBattleTicketValidator(redis);

  assert.deepEqual(await validator.validateAndConsume(rawTicket), {
    sessionId: "session-1",
    attemptId: "attempt-1",
    userId: "user-1",
    mode: "pve",
  });
  assert.equal(await validator.validateAndConsume(rawTicket), null);
  assert.deepEqual(redis.requestedKeys, [key, key]);
});

test("Valkey ticket validator rejects a stale ticket even when its key survived rotation", async () => {
  const staleTicket = "stale-ticket";
  const currentTicket = "current-ticket";
  const staleKey = battleTicketKey(staleTicket);
  const currentKey = battleTicketKey(currentTicket);
  const values = new Map([
    [staleKey, JSON.stringify({
      sessionId: "session-1",
      attemptId: "attempt-1",
      userId: "user-1",
      mode: "pve",
      ticketVersion: 1,
    })],
    [currentKey, JSON.stringify({
      sessionId: "session-1",
      attemptId: "attempt-1",
      userId: "user-1",
      mode: "pve",
      ticketVersion: 2,
    })],
  ]);
  const states = new Map([[`${battleTicketStateKeyPrefix}attempt-1`, { version: 2, ticketKey: currentKey, userId: "user-1" }]]);
  const validator = new ValkeyBattleTicketValidator(createRedisDouble(values, states));

  assert.equal(await validator.validateAndConsume(staleTicket), null);
  assert.equal(values.has(staleKey), false);
  assert.deepEqual(await validator.validateAndConsume(currentTicket), {
    sessionId: "session-1",
    attemptId: "attempt-1",
    userId: "user-1",
    mode: "pve",
  });
});
