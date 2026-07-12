import assert from "node:assert/strict";
import test from "node:test";

import {
  INPUT_COMMAND_BURST,
  InputRateLimiter,
} from "../src/input-rate-limiter.ts";

test("input limiter accepts burst 45 and then enforces 30 commands per second", () => {
  const limiter = new InputRateLimiter(1_000);
  for (let index = 0; index < INPUT_COMMAND_BURST; index += 1) {
    assert.equal(limiter.allow(1_000), true);
  }
  assert.equal(limiter.allow(1_000), false);
  assert.equal(limiter.allow(1_033), false);
  assert.equal(limiter.allow(1_034), true);
  assert.equal(limiter.allow(2_034), true);
});
