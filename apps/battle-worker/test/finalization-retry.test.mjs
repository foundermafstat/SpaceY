import assert from "node:assert/strict";
import test from "node:test";

import { finalizationRetryDelayMs } from "../src/finalization-retry.ts";

test("finalization retry uses bounded exponential backoff", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7, 20].map(finalizationRetryDelayMs),
    [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]
  );
});
