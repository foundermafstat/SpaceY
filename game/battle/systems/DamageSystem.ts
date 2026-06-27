import { getRuntimePartDamageState, type ShipRuntime } from "@/game/ship/runtime";
import type { DamageType, RuntimePartDamageState, RuntimePartState } from "@/game/types";
import {
  applyPartDetach,
  type DetachedDebrisEntity
} from "@/game/battle/systems/PartDetachSystem";

export type RuntimeDamageInput = {
  damageType: DamageType;
  amount: number;
  hitPartId?: string | null;
};

export type RuntimeDamageResult = {
  runtime: ShipRuntime;
  partId: string | null;
  partState: RuntimePartDamageState | null;
  hullDamage: number;
  destroyedPartId: string | null;
  detachedPartIds: string[];
  debris: DetachedDebrisEntity[];
  cabinDestroyed: boolean;
};

export function applyRuntimeDamage(runtime: ShipRuntime, input: RuntimeDamageInput): RuntimeDamageResult {
  const targetPart = findDamageTarget(runtime.parts, input.hitPartId);
  if (!targetPart) {
    return {
      runtime,
      partId: null,
      partState: null,
      hullDamage: input.amount,
      destroyedPartId: null,
      detachedPartIds: [],
      debris: [],
      cabinDestroyed: false
    };
  }

  const mitigatedDamage = applyMitigation(targetPart, input.damageType, input.amount);
  let nextPartState: RuntimePartDamageState = targetPart.state;
  let destroyedPartId: string | null = null;
  let cabinDestroyed = false;

  const parts = runtime.parts.map((part) => {
    if (part.id !== targetPart.id) return part;
    const hp = Math.max(0, part.hp - mitigatedDamage);
    nextPartState = getRuntimePartDamageState(hp, part.maxHp);
    const disabled = hp <= 0 || nextPartState === "disabled";
    const detached = hp <= 0 && part.kind !== "cabin";
    if (hp <= 0) destroyedPartId = part.id;
    if (hp <= 0 && part.kind === "cabin") cabinDestroyed = true;
    return {
      ...part,
      hp,
      state: detached ? "detached" : nextPartState,
      disabled,
      detached
    };
  });

  const damagedRuntime = { ...runtime, parts };
  const detachResult = destroyedPartId
    ? applyPartDetach(damagedRuntime, destroyedPartId)
    : { runtime: damagedRuntime, detachedPartIds: [], debris: [] };
  const nextRuntime = refreshRuntimeSystems(detachResult.runtime);

  return {
    runtime: nextRuntime,
    partId: targetPart.id,
    partState: nextPartState,
    hullDamage: mitigatedDamage,
    destroyedPartId,
    detachedPartIds: detachResult.detachedPartIds,
    debris: detachResult.debris,
    cabinDestroyed
  };
}

export function refreshRuntimeSystems(runtime: ShipRuntime): ShipRuntime {
  const activePartIds = new Set(
    runtime.parts.filter((part) => !part.disabled && !part.detached).map((part) => part.id)
  );
  const disabledPowerParts = runtime.parts.some(
    (part) => part.disabled && part.kind === "element" && part.networks.includes("power")
  );
  const weapons = runtime.weapons.filter((weapon) => activePartIds.has(weapon.partId));
  const engines = runtime.engines.filter((engine) => activePartIds.has(engine.partId));
  const shields = runtime.shields.filter((shield) => activePartIds.has(shield.partId));

  return {
    ...runtime,
    weapons,
    engines,
    shields,
    shieldPool: shields.reduce((sum, shield) => sum + shield.capacity, 0),
    energy: {
      ...runtime.energy,
      output: runtime.stats.powerOutput * (disabledPowerParts ? 0.55 : 1)
    }
  };
}

function findDamageTarget(parts: RuntimePartState[], hitPartId?: string | null) {
  if (hitPartId) {
    const hitPart = parts.find((part) => part.id === hitPartId && !part.detached);
    if (hitPart) return hitPart;
  }
  return (
    parts.find((part) => part.kind === "element" && !part.detached && !part.disabled) ??
    parts.find((part) => part.kind === "panel" && !part.detached) ??
    parts.find((part) => part.kind === "cabin")
  );
}

function applyMitigation(part: RuntimePartState, damageType: DamageType, amount: number) {
  if (part.kind === "panel" && damageType === "kinetic") return amount * 0.85;
  if (part.kind === "panel" && damageType === "explosive") return amount * 0.95;
  if (part.kind === "element" && damageType === "energy") return amount * 0.8;
  if (damageType === "piercing") return amount * 1.2;
  return amount;
}
