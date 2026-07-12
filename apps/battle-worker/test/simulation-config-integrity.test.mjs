import assert from "node:assert/strict";
import test from "node:test";

import {
  assertStoredSimulationConfig,
  hashSimulationConfig,
} from "../src/postgres-finalizer.ts";

test("stored simulation config accepts canonical key reordering", () => {
  const stored = {
    sessionId: "session-1",
    player: { hull: 100, modules: [{ id: "engine", hp: 50 }] },
  };
  const requested = {
    player: { modules: [{ hp: 50, id: "engine" }], hull: 100 },
    sessionId: "session-1",
  };

  assert.doesNotThrow(() => {
    assertStoredSimulationConfig(stored, hashSimulationConfig(stored), requested);
  });
});

test("stored simulation config rejects a changed request", () => {
  const stored = { sessionId: "session-1", player: { hull: 100 } };

  assert.throws(
    () => assertStoredSimulationConfig(
      stored,
      hashSimulationConfig(stored),
      { sessionId: "session-1", player: { hull: 99 } },
    ),
    /integrity validation/,
  );
});

test("stored simulation config rejects a forged stored hash", () => {
  const stored = { sessionId: "session-1", player: { hull: 100 } };

  assert.throws(
    () => assertStoredSimulationConfig(stored, "0".repeat(64), stored),
    /integrity validation/,
  );
});
