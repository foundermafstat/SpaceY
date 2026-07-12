import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeBattleServerMessage,
  encodeBattleClientMessage
} from "../../../game/server/battle-protobuf.ts";
import { ProtobufBattleCodec } from "../src/protobuf-codec.ts";

test("browser and worker protobuf codecs are wire-compatible", async () => {
  const worker = await ProtobufBattleCodec.create();
  const clientMessage = {
    type: "input.command",
    command: { seq: 7, targetTick: 12, moveX: -500, moveY: 250, aimX: 1000, aimY: 0, actionFlags: 1 }
  };
  assert.deepEqual(worker.decodeClient(encodeBattleClientMessage(clientMessage)), clientMessage);

  const serverMessage = {
    type: "battle.snapshot",
    snapshot: {
      sessionId: "01900000-0000-7000-8000-000000000099",
      tick: 12,
      stateHash: "state-12",
      lastProcessedInputSequence: 7,
      status: "active",
      objective: { type: "destroy_all", progress: 1, target: 3 },
      arenaWidthMilli: 2_000_000,
      arenaHeightMilli: 1_200_000,
      entities: [{
        id: "player",
        kind: "player",
        xMilli: -1_500,
        yMilli: 2_000,
        velocityXMilliPerTick: -15,
        velocityYMilliPerTick: 20,
        rotationMilliRadians: -100,
        hull: 90,
        hullMax: 100,
        flags: 0,
        shipSystems: {
          energy: 80,
          energyMax: 100,
          heat: 20,
          heatMax: 100,
          shield: 30,
          shieldMax: 50,
          shieldRegenDelayRemaining: 2,
          overheated: false,
          brownout: false,
          modules: [{
            id: "core-1",
            visualKey: "core",
            category: "core",
            hp: 100,
            hpMax: 100,
            gridX: 0,
            gridY: 0,
            parentModuleId: null,
            powered: true,
            detached: false,
            enabled: true
          }],
          weapons: [{ id: "primary", moduleId: null, cooldownRemaining: 0, ready: true }]
        }
      }]
    }
  };
  assert.deepEqual(decodeBattleServerMessage(worker.encodeServer(serverMessage)), serverMessage);
});

test("browser decodes v2 combat event details and draw finalization", async () => {
  const worker = await ProtobufBattleCodec.create();
  const event = {
    type: "battle.event",
    eventId: 10,
    tick: 30,
    eventType: "module_detached",
    entityIds: ["ship-1"],
    moduleIds: ["engine-1"],
    userIds: ["user-1"],
    weaponId: "primary",
    value: 12
  };
  assert.deepEqual(decodeBattleServerMessage(worker.encodeServer(event)), event);

  const ended = {
    type: "battle.ended",
    resultId: "result-draw",
    outcome: "draw",
    reason: "draw",
    finalTick: 930,
    finalStateHash: "draw-hash"
  };
  assert.deepEqual(decodeBattleServerMessage(worker.encodeServer(ended)), ended);
});

test("browser preserves v2 collection objectives and objective entities", async () => {
  const worker = await ProtobufBattleCodec.create();
  const snapshot = {
    type: "battle.snapshot",
    snapshot: {
      sessionId: "session-salvage",
      tick: 9,
      stateHash: "salvage-state-9",
      lastProcessedInputSequence: 2,
      status: "active",
      objective: { type: "collect_scrap", progress: 2, target: 5 },
      arenaWidthMilli: 2_000_000,
      arenaHeightMilli: 1_200_000,
      entities: [{
        id: "objective-scrap-3",
        kind: "objective",
        xMilli: 100,
        yMilli: 200,
        velocityXMilliPerTick: 0,
        velocityYMilliPerTick: 0,
        rotationMilliRadians: 0,
        hull: 1,
        hullMax: 1,
        flags: 2,
      }],
    },
  };
  assert.deepEqual(decodeBattleServerMessage(worker.encodeServer(snapshot)), snapshot);
});

test("browser decodes participant-aware PvP initial and duel snapshots from worker", async () => {
  const worker = await ProtobufBattleCodec.create();
  const serverMessage = {
    type: "battle.initial",
    protocolVersion: "spacey-battle-v1",
    mode: "pvp",
    participant: { matchId: "match-1", participantId: "participant-alpha", side: 0 },
    snapshot: {
      sessionId: "session-1",
      tick: 3,
      stateHash: "duel-state-3",
      lastProcessedInputSequence: 1,
      status: "active",
      objective: { type: "destroy_opponent", progress: 0, target: 1 },
      arenaWidthMilli: 2_000_000,
      arenaHeightMilli: 1_200_000,
      entities: [
        {
          id: "duel-ship-participant-alpha",
          kind: "player",
          xMilli: -100,
          yMilli: 0,
          velocityXMilliPerTick: 10,
          velocityYMilliPerTick: 0,
          rotationMilliRadians: 0,
          hull: 300,
          hullMax: 300,
          flags: 0,
        },
        {
          id: "duel-ship-participant-beta",
          kind: "enemy",
          xMilli: 100,
          yMilli: 0,
          velocityXMilliPerTick: -10,
          velocityYMilliPerTick: 0,
          rotationMilliRadians: 3142,
          hull: 250,
          hullMax: 300,
          flags: 0,
        },
      ],
    },
    reconnect: {
      permitted: true,
      disconnectedAt: null,
      deadlineAt: null,
      lastProcessedInputSequence: 1,
      latestCheckpointTick: 0,
    },
  };
  assert.deepEqual(decodeBattleServerMessage(worker.encodeServer(serverMessage)), serverMessage);
});
