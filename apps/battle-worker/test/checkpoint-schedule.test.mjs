import assert from "node:assert/strict";
import test from "node:test";

import { checkpointOffset, isCheckpointTick } from "../src/checkpoint-schedule.ts";

test("checkpoint schedule is stable and distributes sessions across the interval", () => {
  const ids = Array.from({ length: 32 }, (_, index) => `session-${index}`);
  const offsets = ids.map((id) => checkpointOffset(id, 60));
  assert.deepEqual(offsets, ids.map((id) => checkpointOffset(id, 60)));
  assert.ok(new Set(offsets).size > 8);
  assert.equal(isCheckpointTick(ids[0], offsets[0], 60), true);
  assert.equal(isCheckpointTick(ids[0], offsets[0] + 1, 60), false);
});
