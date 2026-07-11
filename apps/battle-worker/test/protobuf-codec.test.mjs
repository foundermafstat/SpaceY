import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import protobuf from "protobufjs";

import { ProtobufBattleCodec } from "../src/protobuf-codec.ts";

const protoPath = fileURLToPath(import.meta.resolve("@spacey/protocol/battle.proto"));

test("protobuf codec decodes client input and encodes authoritative snapshots", async () => {
  const [codec, root] = await Promise.all([
    ProtobufBattleCodec.create(protoPath),
    protobuf.load(protoPath)
  ]);
  const clientEnvelope = root.lookupType("spacey.battle.v1.ClientEnvelope");
  const clientBytes = clientEnvelope.encode(clientEnvelope.create({
    inputCommand: {
      sequence: 7,
      targetTick: 12,
      moveX: 500,
      moveY: -250,
      aimX: 1000,
      aimY: 0,
      actionFlags: 1
    }
  })).finish();
  assert.deepEqual(codec.decodeClient(clientBytes), {
    type: "input.command",
    command: {
      seq: 7,
      targetTick: 12,
      moveX: 500,
      moveY: -250,
      aimX: 1000,
      aimY: 0,
      actionFlags: 1
    }
  });

  const serverEnvelope = root.lookupType("spacey.battle.v1.ServerEnvelope");
  const encoded = codec.encodeServer({
    type: "battle.snapshot",
    snapshot: {
      sessionId: "session-1",
      tick: 12,
      stateHash: "abcdef",
      lastProcessedInputSequence: 7,
      status: "active",
      objective: { type: "destroy_all", progress: 1, target: 3 },
      entities: [{
        id: "player",
        kind: "player",
        xMilli: 100,
        yMilli: 200,
        velocityXMilliPerTick: 1,
        velocityYMilliPerTick: 2,
        rotationMilliRadians: 3,
        hull: 99,
        hullMax: 100,
        flags: 0
      }]
    }
  });
  const decoded = serverEnvelope.toObject(serverEnvelope.decode(encoded), {
    longs: Number,
    enums: String
  });
  assert.equal(decoded.battleSnapshot.sessionId, "session-1");
  assert.equal(decoded.battleSnapshot.tick, 12);
  assert.equal(decoded.battleSnapshot.entities[0].kind, "ENTITY_KIND_PLAYER");
});

test("protobuf battle.initial carries participant-aware PvP context", async () => {
  const [codec, root] = await Promise.all([
    ProtobufBattleCodec.create(protoPath),
    protobuf.load(protoPath)
  ]);
  const encoded = codec.encodeServer({
    type: "battle.initial",
    protocolVersion: "spacey-battle-v1",
    mode: "pvp",
    participant: { matchId: "match-1", participantId: "participant-1", side: 1 },
    snapshot: {
      sessionId: "session-1",
      tick: 0,
      stateHash: "state",
      lastProcessedInputSequence: 0,
      status: "active",
      objective: { type: "destroy_opponent", progress: 0, target: 1 },
      entities: [],
    },
    reconnect: {
      permitted: true,
      disconnectedAt: null,
      deadlineAt: null,
      lastProcessedInputSequence: 0,
      latestCheckpointTick: 0,
    },
  });
  const envelope = root.lookupType("spacey.battle.v1.ServerEnvelope");
  const decoded = envelope.toObject(envelope.decode(encoded), { longs: Number });
  assert.equal(decoded.battleInitial.participant.matchId, "match-1");
  assert.equal(decoded.battleInitial.participant.participantId, "participant-1");
  assert.equal(decoded.battleInitial.participant.side, 1);
});
