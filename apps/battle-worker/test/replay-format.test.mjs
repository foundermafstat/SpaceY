import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync } from "node:zlib";

import { encodeReplay } from "../src/replay-format.ts";

const request = {
  kind: "pve",
  simulationConfig: {
    sessionId: "session-1",
    attemptId: "attempt-1",
    missionId: "mission-1",
    mode: "pve",
    seed: 42,
    contentVersion: "content-1",
    simulationVersion: "1.0.0",
    shipBuildRevisionId: "build-1",
    durationSeconds: 60,
    objective: { type: "survive_seconds", targetSeconds: 30 },
    arenaWidthUnits: 1000,
    arenaHeightUnits: 1000,
    enemyCount: 1,
    player: {
      hull: 100,
      speedUnitsPerSecond: 100,
      weaponDamage: 10,
      weaponRangeUnits: 100,
      weaponCooldownTicks: 10,
      projectileSpeedUnitsPerSecond: 200
    },
    enemy: {
      hull: 10,
      speedUnitsPerSecond: 10,
      collisionRadiusUnits: 10,
      attackDamage: 1,
      attackRangeUnits: 20,
      attackCooldownTicks: 30
    }
  },
  finalCheckpoint: {
    formatVersion: 1,
    config: {},
    state: { tick: 30 },
    activeInput: {},
    pendingInputs: [],
    stateHash: "state-hash",
    checkpointHash: "checkpoint-hash"
  },
  inputs: [
    { seq: 2, targetTick: 2, moveX: 0, moveY: 1, aimX: 0, aimY: 1, actionFlags: 0 },
    { seq: 1, targetTick: 1, moveX: 1, moveY: 0, aimX: 1, aimY: 0, actionFlags: 1 }
  ],
  outcome: {
    outcome: "victory",
    reason: "objective_complete",
    finalTick: 30,
    finalStateHash: "state-hash"
  },
  completedAtMs: 1234
};

test("replay encoding is deterministic and orders input sequence", () => {
  const first = encodeReplay(request);
  const second = encodeReplay(request);
  assert.equal(first.checksumSha256, second.checksumSha256);
  assert.deepEqual(first.body, second.body);
  const records = gunzipSync(first.body).toString("utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(records.map((record) => record.record), ["header", "input", "input", "checkpoint", "outcome"]);
  assert.deepEqual(records.filter((record) => record.record === "input").map((record) => record.input.seq), [1, 2]);
});
