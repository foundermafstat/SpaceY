import assert from "node:assert/strict";
import test from "node:test";

import { calculatePersistentDamage, PERSISTENT_DAMAGE_RULE } from "../src/persistent-damage.ts";

test("persistent damage is deterministic and uses lower PvP exposure", () => {
  const pve = calculatePersistentDamage({
    mode: "pve",
    currentDurability: 10_000,
    maximumHull: 300,
    remainingHull: 180,
  });
  const pvp = calculatePersistentDamage({
    mode: "pvp",
    currentDurability: 10_000,
    maximumHull: 300,
    remainingHull: 180,
  });
  assert.deepEqual(pve, { durabilityLoss: 1_000, nextDurability: 9_000, nextState: "INSTALLED" });
  assert.deepEqual(pvp, { durabilityLoss: 400, nextDurability: 9_600, nextState: "INSTALLED" });
  assert.equal(PERSISTENT_DAMAGE_RULE.version, "persistent-damage-v1");
});

test("persistent damage applies damaged and destroyed thresholds without zero-damage drift", () => {
  assert.deepEqual(calculatePersistentDamage({
    mode: "pve",
    currentDurability: 7_100,
    maximumHull: 300,
    remainingHull: 270,
  }), { durabilityLoss: 250, nextDurability: 6_850, nextState: "DAMAGED" });

  assert.deepEqual(calculatePersistentDamage({
    mode: "pvp",
    currentDurability: 100,
    maximumHull: 300,
    remainingHull: 260,
  }), { durabilityLoss: 100, nextDurability: 0, nextState: "DESTROYED" });

  assert.deepEqual(calculatePersistentDamage({
    mode: "pve",
    currentDurability: 6_850,
    maximumHull: 300,
    remainingHull: 300,
  }), { durabilityLoss: 0, nextDurability: 6_850, nextState: "DAMAGED" });
});
