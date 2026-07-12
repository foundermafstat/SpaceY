import assert from "node:assert/strict";
import test from "node:test";

import {
  BattleSnapshotBuffer,
  MAX_BUFFERED_BATTLE_SNAPSHOTS,
} from "../game/server/battle-snapshot-buffer.ts";

function snapshot(tick, xMilli, entities = null) {
  return {
    sessionId: "01900000-0000-7000-8000-000000000001",
    tick,
    stateHash: `hash-${tick}`,
    lastProcessedInputSequence: tick,
    status: "active",
    objective: { type: "destroy_all", progress: 0, target: 1 },
    arenaWidthMilli: 2_000_000,
    arenaHeightMilli: 1_200_000,
    entities: entities ?? [{
      id: "player",
      kind: "player",
      xMilli,
      yMilli: 0,
      velocityXMilliPerTick: 0,
      velocityYMilliPerTick: 0,
      rotationMilliRadians: 0,
      hull: 100,
      hullMax: 100,
      flags: 0,
    }],
  };
}

test("snapshot buffer interpolates presentation 100ms behind receive time", () => {
  const buffer = new BattleSnapshotBuffer();
  buffer.push(snapshot(1, 0), 100);
  buffer.push(snapshot(2, 1_000), 200);

  const [player] = buffer.interpolatedEntities(250);
  assert.equal(player.xMilli, 500);
  assert.equal(player.hull, 100);
});

test("snapshot buffer interpolates rotation across the shortest wrap", () => {
  const buffer = new BattleSnapshotBuffer();
  const previous = snapshot(1, 0);
  const next = snapshot(2, 0);
  previous.entities[0].rotationMilliRadians = 3_100;
  next.entities[0].rotationMilliRadians = -3_100;
  buffer.push(previous, 100);
  buffer.push(next, 200);

  const [player] = buffer.interpolatedEntities(250);
  assert.ok(Math.abs(Math.abs(player.rotationMilliRadians) - Math.PI * 1_000) < 2);
  assert.equal(buffer.latestSnapshot().tick, 2);
});

test("snapshot buffer keeps a bounded history and includes newly spawned entities", () => {
  const buffer = new BattleSnapshotBuffer();
  for (let tick = 1; tick <= MAX_BUFFERED_BATTLE_SNAPSHOTS + 3; tick += 1) {
    const entities = snapshot(tick, tick).entities;
    if (tick === MAX_BUFFERED_BATTLE_SNAPSHOTS + 3) {
      entities.push({ ...entities[0], id: "projectile-1", kind: "projectile" });
    }
    buffer.push(snapshot(tick, tick, entities), tick * 100);
  }

  assert.equal(buffer.interpolatedEntities((MAX_BUFFERED_BATTLE_SNAPSHOTS + 3) * 100 + 100)
    .some(({ id }) => id === "projectile-1"), true);
});
