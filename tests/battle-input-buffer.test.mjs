import assert from "node:assert/strict";
import test from "node:test";

import {
  BattleInputBuffer,
  MAX_UNACKNOWLEDGED_INPUTS,
} from "../game/server/battle-input-buffer.ts";

function command(seq) {
  return { seq, targetTick: seq, moveX: 0, moveY: 0, aimX: 0, aimY: 0, actionFlags: 0 };
}

test("input buffer prunes acknowledged commands and preserves resend order", () => {
  const buffer = new BattleInputBuffer();
  assert.equal(buffer.push(command(1)), true);
  assert.equal(buffer.push(command(2)), true);
  assert.equal(buffer.push(command(3)), true);

  buffer.acknowledge(2);

  assert.deepEqual(buffer.pending().map(({ seq }) => seq), [3]);
  assert.equal(buffer.push(command(4)), true);
  assert.deepEqual(buffer.pending().map(({ seq }) => seq), [3, 4]);
});

test("input buffer never evicts an unacknowledged sequence when full", () => {
  const buffer = new BattleInputBuffer();
  for (let seq = 1; seq <= MAX_UNACKNOWLEDGED_INPUTS; seq += 1) {
    assert.equal(buffer.push(command(seq)), true);
  }
  assert.equal(buffer.push(command(MAX_UNACKNOWLEDGED_INPUTS + 1)), false);
  assert.deepEqual(buffer.pending().map(({ seq }) => seq),
    Array.from({ length: MAX_UNACKNOWLEDGED_INPUTS }, (_, index) => index + 1));
});
