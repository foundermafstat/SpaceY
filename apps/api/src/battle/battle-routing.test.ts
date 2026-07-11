import assert from "node:assert/strict";
import test from "node:test";
import { routedBattleWebsocketUrl } from "./battle-routing.js";

test("battle websocket routing is stable per authoritative session", () => {
  const base = "wss://api.spacey.example/realtime/v1/battle";
  const session = "01900000-0000-7000-8000-000000000001";
  const first = routedBattleWebsocketUrl(base, session);
  const second = routedBattleWebsocketUrl(base, session);
  assert.equal(first, second);
  assert.equal(new URL(first).searchParams.get("route"), session);
  assert.notEqual(
    first,
    routedBattleWebsocketUrl(base, "01900000-0000-7000-8000-000000000002"),
  );
});
