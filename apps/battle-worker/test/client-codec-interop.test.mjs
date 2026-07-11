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
        flags: 0
      }]
    }
  };
  assert.deepEqual(decodeBattleServerMessage(worker.encodeServer(serverMessage)), serverMessage);
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
