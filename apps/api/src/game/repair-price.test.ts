import assert from "node:assert/strict";
import test from "node:test";
import { fullRepairCost } from "./repair-price.js";

test("repair price scales by missing durability and rounds against the player", () => {
  assert.equal(fullRepairCost(100, 5_000), 50);
  assert.equal(fullRepairCost(100, 9_999), 1);
  assert.equal(fullRepairCost(333, 7_500), 84);
  const exactLargeCost = Number(
    (BigInt(Number.MAX_SAFE_INTEGER) * 9_999n + 9_999n) / 10_000n,
  );
  assert.equal(fullRepairCost(Number.MAX_SAFE_INTEGER, 1), exactLargeCost);
});

test("repair price rejects non-repairable durability and invalid content", () => {
  assert.throws(() => fullRepairCost(0, 5_000));
  assert.throws(() => fullRepairCost(100, 0));
  assert.throws(() => fullRepairCost(100, 10_000));
});
