import assert from "node:assert/strict";
import test from "node:test";

import { parseMissionRewards, resolveItemRewards } from "../src/reward-definition.ts";

test("canonical currency and experience rewards are normalized for PostgreSQL", () => {
  assert.deepEqual(
    parseMissionRewards({ currencies: { credits: 300, scrap: 12, alloy: 1 }, experience: 25 }),
    {
      currencies: [
        { currency: "CREDITS", amount: 300 },
        { currency: "SCRAP", amount: 12 },
        { currency: "ALLOY", amount: 1 }
      ],
      experience: 25,
      items: []
    }
  );
});

test("item rewards use deterministic server-side basis-point rolls", () => {
  const definition = parseMissionRewards({
    items: [
      { definitionKey: "panel.common", chanceBasisPoints: 10_000, rarity: "common" },
      { definitionKey: "connector.rare", chanceBasisPoints: 0, rarity: "rare" }
    ]
  });
  assert.deepEqual(resolveItemRewards("attempt-1", definition.items), [
    {
      definitionKey: "panel.common",
      chanceBasisPoints: 10_000,
      rarity: "common",
      rewardIndex: 0
    }
  ]);
  assert.deepEqual(
    resolveItemRewards("attempt-1", definition.items),
    resolveItemRewards("attempt-1", definition.items)
  );
});

test("negative or oversized economy grants are rejected", () => {
  assert.throws(() => parseMissionRewards({ currencies: { credits: -1 } }), /bounded/);
  assert.throws(() => parseMissionRewards({ experience: 1_000_000_001 }), /bounded/);
  assert.throws(() => parseMissionRewards({ currencies: { creditz: 10 } }), /not supported/);
});

test("drop-table currency and item entries become canonical rewards", () => {
  const rewards = parseMissionRewards(
    { dropTableKey: "starter-salvage" },
    [
      { kind: "currency", currency: "CREDITS", amount: 300, weight: 1 },
      { kind: "currency", currency: "SCRAP", amount: 12, weight: 1 },
      { kind: "experience", amount: 25, weight: 1 },
      { kind: "item", definitionKey: "starter-core", chanceBps: 3500, rarity: "common" }
    ]
  );
  assert.deepEqual(rewards, {
    currencies: [
      { currency: "CREDITS", amount: 300 },
      { currency: "SCRAP", amount: 12 }
    ],
    experience: 25,
    items: [{ definitionKey: "starter-core", chanceBasisPoints: 3500, rarity: "common" }]
  });
});
