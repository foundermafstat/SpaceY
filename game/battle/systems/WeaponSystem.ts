import { angleDelta, clamp, type Vec } from "@/game/battle/math";
import type { EnergyPriority } from "@/game/battle/systems/EnergySystem";
import type { WeaponDef } from "@/game/types";

export type RuntimeWeaponState = {
  partId: string;
  weapon: WeaponDef;
  cooldown: number;
  reload: number;
  heat: number;
  disabled: boolean;
  targetLock: string | null;
};

export type WeaponFireCheck = {
  ownerPos: Vec;
  ownerRotation: number;
  targetPos: Vec;
  targetDistance: number;
  energyEfficiency: number;
  overheated: boolean;
};

export function createRuntimeWeaponState(partId: string, weapon: WeaponDef): RuntimeWeaponState {
  return {
    partId,
    weapon,
    cooldown: Math.random() * 0.8,
    reload: 0,
    heat: 0,
    disabled: false,
    targetLock: null
  };
}

export function updateWeaponRuntime(state: RuntimeWeaponState, dt: number) {
  state.cooldown = Math.max(0, state.cooldown - dt);
  state.reload = Math.max(0, state.reload - dt);
  const cooldown = state.weapon.heatProfile?.cooldownPerSecond ?? Math.max(0.4, state.weapon.heatPerShot * 0.4);
  state.heat = Math.max(0, state.heat - cooldown * dt);
  if (state.heat <= (state.weapon.heatProfile?.maxHeat ?? 12) * 0.45) {
    state.disabled = false;
  }
}

export function canFireWeapon(state: RuntimeWeaponState, check: WeaponFireCheck) {
  if (state.disabled || check.overheated) return false;
  if (state.cooldown > 0 || state.reload > 0) return false;
  if (check.targetDistance > state.weapon.range) return false;
  if (check.targetDistance < (state.weapon.minRange ?? 0)) return false;
  if (check.energyEfficiency < 0.12) return false;

  const arc = state.weapon.arc;
  if (arc !== undefined) {
    const targetAngle = Math.atan2(check.targetPos.y - check.ownerPos.y, check.targetPos.x - check.ownerPos.x);
    if (Math.abs(angleDelta(check.ownerRotation, targetAngle)) > arc / 2) return false;
  }

  return true;
}

export function beginWeaponFire(state: RuntimeWeaponState, energyEfficiency: number) {
  const fireRate = Math.max(0.1, state.weapon.fireRate * clamp(energyEfficiency, 0.2, 1));
  state.cooldown = Math.max(0.12, 1 / fireRate);
  state.heat += state.weapon.heatPerShot;

  const maxHeat = state.weapon.heatProfile?.maxHeat ?? 12;
  if (state.heat >= maxHeat) {
    state.disabled = true;
    state.reload = state.weapon.reload ?? 0.7;
  }
}

export function getWeaponPowerPriority(weapon: WeaponDef): EnergyPriority {
  return weapon.powerPriority ?? "weapons";
}

export function getDamageWithFalloff(weapon: WeaponDef, distance: number) {
  const falloff = weapon.damageFalloff;
  if (!falloff || distance <= falloff.start) return weapon.damage;
  if (distance >= falloff.end) return weapon.damage * falloff.minMultiplier;
  const t = (distance - falloff.start) / Math.max(1, falloff.end - falloff.start);
  return weapon.damage * (1 - t * (1 - falloff.minMultiplier));
}
