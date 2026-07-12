import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";

import { WsBattleConnection } from "../src/websocket-server.ts";

class FakeSocket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 600 * 1_024;
  sent = [];
  closeCalls = [];

  send(payload, _options, callback) {
    this.sent.push(JSON.parse(Buffer.from(payload).toString("utf8")));
    queueMicrotask(() => callback?.());
  }

  close(code, reason) {
    this.closeCalls.push({ code, reason });
    this.readyState = 2;
  }

  ping() {}
  terminate() { this.readyState = 3; }
}

const codec = {
  encodeServer(message) {
    return Buffer.from(JSON.stringify({
      type: message.type,
      tick: message.type === "battle.snapshot" ? message.snapshot.tick : message.tick,
      eventId: message.type === "battle.event" ? message.eventId : undefined,
      code: message.type === "session.error" ? message.code : undefined,
      resultId: message.type === "battle.ended" ? message.resultId : undefined,
    }));
  },
};

const logger = { info() {}, warn() {}, error() {} };

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail("Timed out waiting for outbound WebSocket drain.");
}

test("backpressure replaces only stale snapshots and preserves reliable message order", async () => {
  const socket = new FakeSocket();
  const connection = new WsBattleConnection(socket, codec, logger);
  connection.send({ type: "battle.snapshot", snapshot: { tick: 1 } });
  connection.send({ type: "battle.event", eventId: "event-1", tick: 1 });
  connection.send({ type: "battle.snapshot", snapshot: { tick: 2 } });
  connection.send({ type: "session.error", code: "RETRY", message: "retry", retryable: true });

  assert.deepEqual(socket.sent, []);
  socket.bufferedAmount = 0;
  await waitFor(() => socket.sent.length === 3);
  assert.deepEqual(socket.sent, [
    { type: "battle.event", tick: 1, eventId: "event-1" },
    { type: "session.error", code: "RETRY" },
    { type: "battle.snapshot", tick: 2 },
  ]);
});

test("terminal message drains after events before deferred close while stale snapshot is discarded", async () => {
  const socket = new FakeSocket();
  const connection = new WsBattleConnection(socket, codec, logger);
  connection.send({ type: "battle.snapshot", snapshot: { tick: 10 } });
  connection.send({ type: "battle.event", eventId: "event-terminal", tick: 10 });
  connection.send({ type: "battle.ended", resultId: "result-1" });
  connection.close(1000, "complete");

  assert.deepEqual(socket.closeCalls, []);
  socket.bufferedAmount = 0;
  await waitFor(() => socket.closeCalls.length === 1);
  assert.deepEqual(socket.sent, [
    { type: "battle.event", tick: 10, eventId: "event-terminal" },
    { type: "battle.ended", resultId: "result-1" },
  ]);
  assert.deepEqual(socket.closeCalls, [{ code: 1000, reason: "complete" }]);
});
