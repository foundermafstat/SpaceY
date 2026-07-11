import type { PoolClient } from "pg";

import { createUuidV7 } from "@spacey/db/uuidv7";

export const PERSISTENT_DAMAGE_RULE = {
  version: "persistent-damage-v1",
  durabilityScale: 10_000,
  damagedBelow: 7_000,
  destroyedAt: 0,
  maximumLoss: {
    pve: 2_500,
    pvp: 1_000,
  },
} as const;

type PersistentDamageMode = keyof typeof PERSISTENT_DAMAGE_RULE.maximumLoss;
type PersistentItemState = "INSTALLED" | "DAMAGED" | "DESTROYED";

type InstalledItemRow = {
  id: string;
  state: string;
  durability: number;
};

export type PersistentDamageInput = {
  mode: PersistentDamageMode;
  userId: string;
  buildRevisionId: string;
  sourceType: "MISSION_RESULT" | "PVP_MATCH";
  sourceId: string;
  idempotencyPrefix: string;
  maximumHull: number;
  remainingHull: number;
};

export type PersistentDamageResult = {
  hullDamage: number;
  totalDurabilityLoss: number;
  affectedItemCount: number;
};

export function calculatePersistentDamage(input: {
  mode: PersistentDamageMode;
  currentDurability: number;
  maximumHull: number;
  remainingHull: number;
}): { durabilityLoss: number; nextDurability: number; nextState: PersistentItemState } {
  const maximumHull = boundedInteger(input.maximumHull, 1, 1_000_000, "maximum hull");
  const remainingHull = boundedInteger(input.remainingHull, 0, maximumHull, "remaining hull");
  const currentDurability = boundedInteger(
    input.currentDurability,
    PERSISTENT_DAMAGE_RULE.destroyedAt,
    PERSISTENT_DAMAGE_RULE.durabilityScale,
    "current durability",
  );
  const hullDamage = maximumHull - remainingHull;
  const maximumLoss = PERSISTENT_DAMAGE_RULE.maximumLoss[input.mode];
  const configuredLoss = hullDamage === 0
    ? 0
    : Math.max(1, Math.ceil((hullDamage * maximumLoss) / maximumHull));
  const nextDurability = Math.max(PERSISTENT_DAMAGE_RULE.destroyedAt, currentDurability - configuredLoss);
  const durabilityLoss = currentDurability - nextDurability;
  const nextState = nextDurability === PERSISTENT_DAMAGE_RULE.destroyedAt
    ? "DESTROYED"
    : nextDurability < PERSISTENT_DAMAGE_RULE.damagedBelow ? "DAMAGED" : "INSTALLED";
  return { durabilityLoss, nextDurability, nextState };
}

/**
 * Must be called inside the authoritative result transaction. Rows are locked
 * in UUID order so PvE/PvP workers share one deadlock-safe lock order.
 */
export async function applyPersistentDamage(
  client: PoolClient,
  input: PersistentDamageInput,
): Promise<PersistentDamageResult> {
  const maximumHull = boundedInteger(input.maximumHull, 1, 1_000_000, "maximum hull");
  const remainingHull = boundedInteger(input.remainingHull, 0, maximumHull, "remaining hull");
  const hullDamage = maximumHull - remainingHull;
  const installed = await client.query<InstalledItemRow>(
    `SELECT inventory.id,
            inventory.state::text,
            inventory.durability
       FROM build_revision_items installed
       JOIN inventory_items inventory ON inventory.id = installed.inventory_item_id
      WHERE installed.build_revision_id = $1
        AND inventory.user_id = $2
      ORDER BY inventory.id
      FOR UPDATE OF inventory`,
    [input.buildRevisionId, input.userId],
  );
  if (installed.rows.length === 0) {
    throw new Error("Authoritative build revision contains no installed inventory items.");
  }

  let affectedItemCount = 0;
  let totalDurabilityLoss = 0;
  for (const item of installed.rows) {
    if (item.state !== "INSTALLED" && item.state !== "DAMAGED") {
      throw new Error(`Installed inventory item ${item.id} is not launchable from state ${item.state}.`);
    }
    const damage = calculatePersistentDamage({
      mode: input.mode,
      currentDurability: item.durability,
      maximumHull,
      remainingHull,
    });
    if (damage.durabilityLoss === 0) continue;

    const idempotencyKey = `${input.idempotencyPrefix}:persistent-damage:${item.id}`;
    const transition = await client.query<{ id: string }>(
      `INSERT INTO inventory_transitions
        (id, user_id, inventory_item_id, from_state, to_state, source_type, source_id,
         idempotency_key, metadata)
       VALUES ($1, $2, $3, $4::inventory_item_state, $5::inventory_item_state,
               $6, $7, $8, $9::jsonb)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [
        createUuidV7(),
        input.userId,
        item.id,
        item.state,
        damage.nextState,
        input.sourceType,
        input.sourceId,
        idempotencyKey,
        JSON.stringify({
          ruleVersion: PERSISTENT_DAMAGE_RULE.version,
          mode: input.mode,
          buildRevisionId: input.buildRevisionId,
          authoritativeHull: {
            maximum: maximumHull,
            remaining: remainingHull,
            damage: hullDamage,
          },
          durability: {
            before: item.durability,
            loss: damage.durabilityLoss,
            after: damage.nextDurability,
            damagedBelow: PERSISTENT_DAMAGE_RULE.damagedBelow,
            destroyedAt: PERSISTENT_DAMAGE_RULE.destroyedAt,
          },
        }),
      ],
    );
    if (transition.rowCount === 0) continue;

    const update = await client.query(
      `UPDATE inventory_items
          SET durability = $2,
              state = $3::inventory_item_state,
              updated_at = now()
        WHERE id = $1
          AND durability = $4
          AND state = $5::inventory_item_state`,
      [item.id, damage.nextDurability, damage.nextState, item.durability, item.state],
    );
    if (update.rowCount !== 1) {
      throw new Error(`Persistent damage compare-and-set failed for inventory item ${item.id}.`);
    }
    affectedItemCount += 1;
    totalDurabilityLoss += damage.durabilityLoss;
  }

  return { hullDamage, totalDurabilityLoss, affectedItemCount };
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Persistent damage ${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}
