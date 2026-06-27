import { clamp } from "@/game/battle/math";
import type { DamageType, ShipStatsV2 } from "@/game/types";

export type ShieldSystemState = {
  capacity: number;
  current: number;
  regenPerSecond: number;
  regenDelay: number;
  regenCooldown: number;
  radius: number;
  damageMultipliers: Record<DamageType, number>;
  isOnline: boolean;
};

export type ShieldDamageResult = {
  shieldDamage: number;
  hullDamage: number;
  shieldHit: boolean;
};

const damageMultipliers: Record<DamageType, number> = {
  kinetic: 0.85,
  explosive: 0.75,
  energy: 1.18,
  plasma: 1,
  emp: 1.8,
  thermal: 0.65,
  piercing: 0.55
};

export function createShieldSystem(stats: ShipStatsV2): ShieldSystemState {
  const capacity = stats.shieldCapacity;
  return {
    capacity,
    current: capacity,
    regenPerSecond: stats.shieldRegen,
    regenDelay: 2.2,
    regenCooldown: 0,
    radius: Math.max(70, Math.sqrt(Math.max(1, stats.mass)) * 14),
    damageMultipliers,
    isOnline: capacity > 0
  };
}

export function updateShieldSystem(state: ShieldSystemState, dt: number, energyEfficiency: number) {
  if (state.capacity <= 0) return;
  state.regenCooldown = Math.max(0, state.regenCooldown - dt);
  if (state.regenCooldown > 0) return;

  const regen = state.regenPerSecond * clamp(energyEfficiency, 0, 1) * dt;
  state.current = clamp(state.current + regen, 0, state.capacity);
  state.isOnline = state.current > 0 || state.regenPerSecond > 0;
}

export function applyShieldDamage(
  state: ShieldSystemState,
  damageType: DamageType,
  damage: number
): ShieldDamageResult {
  if (state.capacity <= 0 || state.current <= 0 || !state.isOnline) {
    return { shieldDamage: 0, hullDamage: damage, shieldHit: false };
  }

  const multiplier = state.damageMultipliers[damageType] ?? 1;
  const incomingShieldDamage = damage * multiplier;
  const shieldDamage = Math.min(state.current, incomingShieldDamage);
  state.current = clamp(state.current - shieldDamage, 0, state.capacity);
  state.regenCooldown = state.regenDelay;

  if (damageType === "emp") {
    state.regenCooldown = state.regenDelay * 1.8;
  }

  const absorbedBaseDamage = shieldDamage / Math.max(0.1, multiplier);
  return {
    shieldDamage,
    hullDamage: Math.max(0, damage - absorbedBaseDamage),
    shieldHit: shieldDamage > 0
  };
}
