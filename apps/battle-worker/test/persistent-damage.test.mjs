import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPersistentDamage,
  calculatePersistentDamage,
  PERSISTENT_DAMAGE_RULE,
} from "../src/persistent-damage.ts";

test("persistent damage is deterministic and uses lower PvP exposure", () => {
  const pve = calculatePersistentDamage({
    mode: "pve",
    currentDurability: 10_000,
    moduleHpBefore: 300,
    moduleHpAfter: 180,
  });
  const pvp = calculatePersistentDamage({
    mode: "pvp",
    currentDurability: 10_000,
    moduleHpBefore: 300,
    moduleHpAfter: 180,
  });
  assert.deepEqual(pve, { durabilityLoss: 1_000, nextDurability: 9_000, nextState: "DAMAGED" });
  assert.deepEqual(pvp, { durabilityLoss: 400, nextDurability: 9_600, nextState: "DAMAGED" });
  assert.equal(PERSISTENT_DAMAGE_RULE.version, "persistent-damage-v2-module-hp");
});

test("persistent damage applies damaged and destroyed thresholds without zero-damage drift", () => {
  assert.deepEqual(calculatePersistentDamage({
    mode: "pve",
    currentDurability: 7_100,
    moduleHpBefore: 300,
    moduleHpAfter: 270,
  }), { durabilityLoss: 250, nextDurability: 6_850, nextState: "DAMAGED" });

  assert.deepEqual(calculatePersistentDamage({
    mode: "pvp",
    currentDurability: 100,
    moduleHpBefore: 300,
    moduleHpAfter: 260,
  }), { durabilityLoss: 100, nextDurability: 0, nextState: "DESTROYED" });

  assert.deepEqual(calculatePersistentDamage({
    mode: "pve",
    currentDurability: 6_850,
    moduleHpBefore: 300,
    moduleHpAfter: 300,
  }), { durabilityLoss: 0, nextDurability: 6_850, nextState: "DAMAGED" });
});

test("only a module with authoritative HP loss receives durability damage and mode caps are per item", () => {
  const hit = calculatePersistentDamage({
    mode: "pve",
    currentDurability: 10_000,
    moduleHpBefore: 80,
    moduleHpAfter: 0,
  });
  const untouchedDetached = calculatePersistentDamage({
    mode: "pve",
    currentDurability: 10_000,
    moduleHpBefore: 120,
    moduleHpAfter: 120,
  });
  const pvpHit = calculatePersistentDamage({
    mode: "pvp",
    currentDurability: 10_000,
    moduleHpBefore: 80,
    moduleHpAfter: 0,
  });

  assert.equal(hit.durabilityLoss, PERSISTENT_DAMAGE_RULE.maximumLoss.pve);
  assert.equal(pvpHit.durabilityLoss, PERSISTENT_DAMAGE_RULE.maximumLoss.pvp);
  assert.equal(untouchedDetached.durabilityLoss, 0);
});

test("any nonzero module damage makes a healthy installed item repairable", () => {
  const minorDamage = calculatePersistentDamage({
    mode: "pvp",
    currentDurability: 10_000,
    moduleHpBefore: 1_000,
    moduleHpAfter: 999,
  });

  assert.deepEqual(minorDamage, {
    durabilityLoss: 1,
    nextDurability: 9_999,
    nextState: "DAMAGED",
  });
});

test("persistence writes only the hit inventory item while validating the complete build mapping", async () => {
  const writes = [];
  const client = {
    async query(sql, params) {
      if (sql.includes("FROM build_revision_items")) {
        return {
          rows: [
            { id: "inventory-hit", state: "INSTALLED", durability: 10_000 },
            { id: "inventory-detached", state: "INSTALLED", durability: 10_000 },
          ],
        };
      }
      writes.push({ sql, params });
      return sql.includes("INSERT INTO inventory_transitions")
        ? { rowCount: 1, rows: [{ id: "transition-1" }] }
        : { rowCount: 1, rows: [] };
    },
  };

  const result = await applyPersistentDamage(client, {
    mode: "pve",
    userId: "user-1",
    buildRevisionId: "revision-1",
    sourceType: "MISSION_RESULT",
    sourceId: "result-1",
    idempotencyPrefix: "result:1",
    moduleDamage: [
      {
        moduleId: "module-hit",
        inventoryItemId: "inventory-hit",
        hpBefore: 100,
        hpAfter: 50,
        hpLoss: 50,
        detached: false,
      },
      {
        moduleId: "module-detached",
        inventoryItemId: "inventory-detached",
        hpBefore: 100,
        hpAfter: 100,
        hpLoss: 0,
        detached: true,
      },
    ],
  });

  assert.deepEqual(result, {
    totalModuleHpLoss: 50,
    totalDurabilityLoss: 1_250,
    affectedItemCount: 1,
  });
  assert.equal(writes.length, 2);
  assert.equal(writes[0].params[2], "inventory-hit");
  assert.equal(JSON.parse(writes[0].params[8]).authoritativeModule.hpLoss, 50);
  assert.equal(writes[1].params[0], "inventory-hit");
});

test("persistence rejects a module-to-inventory mapping that differs from the locked build", async () => {
  const client = {
    async query() {
      return { rows: [{ id: "inventory-real", state: "INSTALLED", durability: 10_000 }] };
    },
  };
  await assert.rejects(
    applyPersistentDamage(client, {
      mode: "pvp",
      userId: "user-1",
      buildRevisionId: "revision-1",
      sourceType: "PVP_MATCH",
      sourceId: "match-1",
      idempotencyPrefix: "match:1",
      moduleDamage: [{
        moduleId: "module-spoofed",
        inventoryItemId: "inventory-spoofed",
        hpBefore: 100,
        hpAfter: 0,
        hpLoss: 100,
        detached: false,
      }],
    }),
    /does not match the installed build revision/,
  );
});
