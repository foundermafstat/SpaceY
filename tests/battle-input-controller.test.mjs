import assert from "node:assert/strict";
import test from "node:test";

import { BattleActionFlag } from "../packages/protocol/src/index.ts";
import { BattleInputController } from "../game/server/battle-input-controller.ts";

function snapshot(tick, acknowledged) {
  return {
    sessionId: "01900000-0000-7000-8000-000000000001",
    tick,
    stateHash: `hash-${tick}`,
    lastProcessedInputSequence: acknowledged,
    status: "active",
    objective: { type: "destroy_all", progress: 0, target: 1 },
    arenaWidthMilli: 2_000_000,
    arenaHeightMilli: 1_200_000,
    entities: [],
  };
}

test("controller sends state changes, heartbeats and resumes unacknowledged inputs", () => {
  const controller = new BattleInputController();
  controller.acceptSnapshot(snapshot(10, 0));
  assert.equal(controller.setKey("w", true), true);

  const first = controller.sample(1_000);
  assert.notEqual(first, null);
  assert.notEqual(first, "buffer_full");
  assert.equal(first.seq, 1);
  assert.equal(first.targetTick, 11);
  assert.equal(first.moveY, -1_000);
  assert.equal(controller.sample(1_100), null);

  const heartbeat = controller.sample(1_501);
  assert.notEqual(heartbeat, null);
  assert.notEqual(heartbeat, "buffer_full");
  assert.equal(heartbeat.seq, 2);
  assert.deepEqual(controller.pending().map(({ seq }) => seq), [1, 2]);

  controller.acceptSnapshot(snapshot(12, 1));
  assert.equal(controller.resumeSequence(), 1);
  assert.deepEqual(controller.pending().map(({ seq }) => seq), [2]);
});

test("right stick independently aims and fires while left stick moves", () => {
  const controller = new BattleInputController();
  controller.acceptSnapshot(snapshot(3, 0));
  controller.setMove(-1, 0, true);
  controller.setAim(0, 1, true);

  const command = controller.sample(100);
  assert.notEqual(command, null);
  assert.notEqual(command, "buffer_full");
  assert.equal(command.moveX, -1_000);
  assert.equal(command.aimY, 1_000);
  assert.equal(command.actionFlags, 1);

  controller.resetTransient();
  const neutral = controller.sample(101);
  assert.notEqual(neutral, null);
  assert.notEqual(neutral, "buffer_full");
  assert.equal(neutral.actionFlags, 0);
  assert.equal(neutral.moveX, 0);
});

test("controller exposes all server weapon action bits", () => {
  const controller = new BattleInputController();
  controller.acceptSnapshot(snapshot(5, 0));
  assert.equal(controller.setKey("Shift", true), true);
  assert.equal(controller.setKey("q", true), true);
  assert.equal(controller.setKey("e", true), true);

  const command = controller.sample(100);
  assert.notEqual(command, null);
  assert.notEqual(command, "buffer_full");
  assert.equal(
    command.actionFlags,
    BattleActionFlag.FireSecondary | BattleActionFlag.AbilityOne | BattleActionFlag.AbilityTwo,
  );

  controller.setAction(BattleActionFlag.FirePrimary, true);
  const allWeapons = controller.sample(101);
  assert.notEqual(allWeapons, null);
  assert.notEqual(allWeapons, "buffer_full");
  assert.equal(
    allWeapons.actionFlags,
    BattleActionFlag.FirePrimary
      | BattleActionFlag.FireSecondary
      | BattleActionFlag.AbilityOne
      | BattleActionFlag.AbilityTwo,
  );
});
