export type ShipModuleCategory =
  | "core"
  | "reactor"
  | "engine"
  | "weapon"
  | "shield"
  | "utility";

export type WeaponSimulationStats = {
  id: string;
  moduleId?: string;
  damage: number;
  rangeUnits: number;
  cooldownTicks: number;
  projectileSpeedUnitsPerSecond: number;
  energyCost: number;
  heatPerShot: number;
  actionFlag: number;
};

export type ShipModuleSimulationConfig = {
  id: string;
  /** Production configs map this module to the installed inventory item UUID. */
  inventoryItemId?: string;
  /** Presentation-only asset key; simulation rules never branch on this value. */
  visualKey?: string;
  category: ShipModuleCategory;
  hp: number;
  gridX: number;
  gridY: number;
  parentModuleId?: string;
  collisionRadiusUnits?: number;
  powerDemandPerTick?: number;
  powerPriority?: number;
  heatGenerationPerTick?: number;
};

export type RichShipSystemsConfig = {
  energyCapacity?: number;
  energyInitial?: number;
  energyGenerationPerTick?: number;
  engineEnergyPerTick?: number;
  heatCapacity?: number;
  heatDissipationPerTick?: number;
  overheatRecoveryHeat?: number;
  shieldCapacity?: number;
  shieldInitial?: number;
  shieldRegenPerTick?: number;
  shieldRegenDelayTicks?: number;
  shieldEnergyPerTick?: number;
  weapons?: WeaponSimulationStats[];
  modules?: ShipModuleSimulationConfig[];
};

export type LegacyWeaponStats = {
  weaponDamage: number;
  weaponRangeUnits: number;
  weaponCooldownTicks: number;
  projectileSpeedUnitsPerSecond: number;
};

export type ResolvedRichShipConfig = {
  energyCapacity: number;
  energyInitial: number;
  energyGenerationPerTick: number;
  engineEnergyPerTick: number;
  heatCapacity: number;
  heatDissipationPerTick: number;
  overheatRecoveryHeat: number;
  shieldCapacity: number;
  shieldInitial: number;
  shieldRegenPerTick: number;
  shieldRegenDelayTicks: number;
  shieldEnergyPerTick: number;
  weapons: WeaponSimulationStats[];
  modules: ShipModuleSimulationConfig[];
};

export type ShipModuleRuntimeState = {
  id: string;
  visualKey: string;
  category: ShipModuleCategory;
  hp: number;
  hpMax: number;
  gridX: number;
  gridY: number;
  parentModuleId: string | null;
  powered: boolean;
  detached: boolean;
};

export type ShipWeaponRuntimeState = {
  id: string;
  moduleId: string | null;
  cooldownRemaining: number;
};

export type RichShipRuntimeState = {
  energy: number;
  energyMax: number;
  heat: number;
  heatMax: number;
  shield: number;
  shieldMax: number;
  shieldRegenDelayRemaining: number;
  overheated: boolean;
  brownout: boolean;
  modules: ShipModuleRuntimeState[];
  weapons: ShipWeaponRuntimeState[];
};

export type ShipModuleSnapshot = ShipModuleRuntimeState & {
  enabled: boolean;
};

export type ShipWeaponSnapshot = ShipWeaponRuntimeState & {
  ready: boolean;
};

export type ShipSystemsSnapshot = {
  energy: number;
  energyMax: number;
  heat: number;
  heatMax: number;
  shield: number;
  shieldMax: number;
  shieldRegenDelayRemaining: number;
  overheated: boolean;
  brownout: boolean;
  modules: ShipModuleSnapshot[];
  weapons: ShipWeaponSnapshot[];
};

export type ShipTickTransition = {
  overheatedStarted: boolean;
  brownoutChanged: boolean;
};

export type ShipDamageResult = {
  shieldDamage: number;
  hullDamage: number;
  moduleId: string | null;
  moduleDamage: number;
  detachedModuleIds: string[];
  coreDestroyed: boolean;
};

export type AuthoritativeModuleDamage = {
  moduleId: string;
  inventoryItemId: string;
  hpBefore: number;
  hpAfter: number;
  hpLoss: number;
  detached: boolean;
};

const DEFAULT_CAPACITY = 1_000_000;
const UINT32_MAX = 0xffff_ffff;

export function resolveRichShipConfig(
  stats: LegacyWeaponStats & RichShipSystemsConfig
): ResolvedRichShipConfig {
  const energyCapacity = stats.energyCapacity ?? DEFAULT_CAPACITY;
  const heatCapacity = stats.heatCapacity ?? DEFAULT_CAPACITY;
  const shieldCapacity = stats.shieldCapacity ?? 0;
  return {
    energyCapacity,
    energyInitial: Math.min(stats.energyInitial ?? energyCapacity, energyCapacity),
    energyGenerationPerTick: stats.energyGenerationPerTick ?? energyCapacity,
    engineEnergyPerTick: stats.engineEnergyPerTick ?? 0,
    heatCapacity,
    heatDissipationPerTick: stats.heatDissipationPerTick ?? heatCapacity,
    overheatRecoveryHeat: Math.min(stats.overheatRecoveryHeat ?? Math.trunc(heatCapacity / 2), heatCapacity),
    shieldCapacity,
    shieldInitial: Math.min(stats.shieldInitial ?? shieldCapacity, shieldCapacity),
    shieldRegenPerTick: stats.shieldRegenPerTick ?? 0,
    shieldRegenDelayTicks: stats.shieldRegenDelayTicks ?? 0,
    shieldEnergyPerTick: stats.shieldEnergyPerTick ?? 0,
    weapons: (stats.weapons ?? [{
      id: "primary",
      damage: stats.weaponDamage,
      rangeUnits: stats.weaponRangeUnits,
      cooldownTicks: stats.weaponCooldownTicks,
      projectileSpeedUnitsPerSecond: stats.projectileSpeedUnitsPerSecond,
      energyCost: 0,
      heatPerShot: 0,
      actionFlag: 1
    }]).map((weapon) => ({ ...weapon })),
    modules: (stats.modules ?? []).map((module) => ({ ...module }))
  };
}

export function createRichShipState(
  stats: LegacyWeaponStats & RichShipSystemsConfig
): RichShipRuntimeState {
  const config = resolveRichShipConfig(stats);
  return {
    energy: config.energyInitial,
    energyMax: config.energyCapacity,
    heat: 0,
    heatMax: config.heatCapacity,
    shield: config.shieldInitial,
    shieldMax: config.shieldCapacity,
    shieldRegenDelayRemaining: 0,
    overheated: false,
    brownout: false,
    modules: config.modules.map((module) => ({
      id: module.id,
      visualKey: module.visualKey ?? module.category,
      category: module.category,
      hp: module.hp,
      hpMax: module.hp,
      gridX: module.gridX,
      gridY: module.gridY,
      parentModuleId: module.parentModuleId ?? null,
      powered: false,
      detached: false
    })),
    weapons: config.weapons.map((weapon) => ({
      id: weapon.id,
      moduleId: weapon.moduleId ?? null,
      cooldownRemaining: 0
    }))
  };
}

export function prepareRichShipTick(
  stats: LegacyWeaponStats & RichShipSystemsConfig,
  state: RichShipRuntimeState,
  shieldRegenAllowed: boolean
): ShipTickTransition {
  const config = resolveRichShipConfig(stats);
  const previousBrownout = state.brownout;
  const wasOverheated = state.overheated;
  const reactorAvailable = categoryOperational(state, "reactor");
  if (reactorAvailable) {
    state.energy = Math.min(state.energyMax, state.energy + config.energyGenerationPerTick);
  }
  state.heat = Math.max(0, state.heat - config.heatDissipationPerTick);
  if (state.overheated && state.heat <= config.overheatRecoveryHeat) state.overheated = false;
  if (state.heat >= state.heatMax) state.overheated = true;
  state.shieldRegenDelayRemaining = Math.max(0, state.shieldRegenDelayRemaining - 1);
  for (const weapon of state.weapons) {
    weapon.cooldownRemaining = Math.max(0, weapon.cooldownRemaining - 1);
  }

  let unmetPowerDemand = false;
  const moduleConfigs = new Map(config.modules.map((module) => [module.id, module]));
  const modules = [...state.modules].sort((left, right) => {
    const leftPriority = moduleConfigs.get(left.id)?.powerPriority ?? 100;
    const rightPriority = moduleConfigs.get(right.id)?.powerPriority ?? 100;
    return leftPriority - rightPriority || compareIdentifiers(left.id, right.id);
  });
  for (const module of modules) {
    const moduleConfig = moduleConfigs.get(module.id);
    const demand = moduleConfig?.powerDemandPerTick ?? 0;
    if (!moduleEnabled(module)) {
      module.powered = false;
      continue;
    }
    if (state.energy < demand) {
      module.powered = false;
      unmetPowerDemand = true;
      continue;
    }
    module.powered = true;
    state.energy -= demand;
    state.heat = Math.min(state.heatMax, state.heat + (moduleConfig?.heatGenerationPerTick ?? 0));
  }
  if (state.heat >= state.heatMax) state.overheated = true;

  const canRegenerateShield = shieldRegenAllowed
    && !state.overheated
    && categoryAvailable(state, "shield")
    && state.shieldRegenDelayRemaining === 0
    && state.shield < state.shieldMax
    && config.shieldRegenPerTick > 0;
  if (canRegenerateShield && state.energy >= config.shieldEnergyPerTick) {
    state.energy -= config.shieldEnergyPerTick;
    state.shield = Math.min(state.shieldMax, state.shield + config.shieldRegenPerTick);
  }
  state.brownout = unmetPowerDemand;
  return {
    overheatedStarted: !wasOverheated && state.overheated,
    brownoutChanged: previousBrownout !== state.brownout
  };
}

export function consumeEnginePower(
  stats: LegacyWeaponStats & RichShipSystemsConfig,
  state: RichShipRuntimeState,
  moving: boolean
): boolean {
  if (!moving) return true;
  const config = resolveRichShipConfig(stats);
  if (!categoryAvailable(state, "engine") || state.energy < config.engineEnergyPerTick) {
    state.brownout = true;
    return false;
  }
  state.energy -= config.engineEnergyPerTick;
  return true;
}

export function tryFireRichWeapon(
  stats: LegacyWeaponStats & RichShipSystemsConfig,
  state: RichShipRuntimeState,
  weaponIndex: number,
  actionFlags: number
): WeaponSimulationStats | null {
  const config = resolveRichShipConfig(stats);
  const weaponConfig = config.weapons[weaponIndex];
  const weaponState = state.weapons[weaponIndex];
  if (!weaponConfig || !weaponState
    || (actionFlags & weaponConfig.actionFlag) === 0
    || weaponState.cooldownRemaining > 0
    || state.overheated
    || state.energy < weaponConfig.energyCost
    || !weaponModuleAvailable(state, weaponConfig.moduleId)) {
    return null;
  }
  state.energy -= weaponConfig.energyCost;
  state.heat = Math.min(state.heatMax, state.heat + weaponConfig.heatPerShot);
  if (state.heat >= state.heatMax) state.overheated = true;
  weaponState.cooldownRemaining = weaponConfig.cooldownTicks;
  return weaponConfig;
}

export function applyRichShipDamage(
  stats: LegacyWeaponStats & RichShipSystemsConfig,
  state: RichShipRuntimeState,
  damage: number,
  impactGridX: number,
  impactGridY: number
): ShipDamageResult {
  const config = resolveRichShipConfig(stats);
  const shieldDamage = categoryAvailable(state, "shield") ? Math.min(state.shield, damage) : 0;
  state.shield -= shieldDamage;
  if (shieldDamage > 0) state.shieldRegenDelayRemaining = config.shieldRegenDelayTicks;
  const hullDamage = damage - shieldDamage;
  if (hullDamage <= 0) {
    return {
      shieldDamage,
      hullDamage: 0,
      moduleId: null,
      moduleDamage: 0,
      detachedModuleIds: [],
      coreDestroyed: false
    };
  }

  const target = selectImpactModule(state.modules, impactGridX, impactGridY);
  const moduleDamage = target ? Math.min(target.hp, hullDamage) : 0;
  if (target) target.hp -= moduleDamage;
  const detachedModuleIds = recomputeTopology(state.modules);
  const coreModules = state.modules.filter((module) => module.category === "core");
  return {
    shieldDamage,
    hullDamage,
    moduleId: target?.id ?? null,
    moduleDamage,
    detachedModuleIds,
    coreDestroyed: coreModules.length > 0 && coreModules.every((module) => module.hp <= 0 || module.detached)
  };
}

export function createShipSystemsSnapshot(state: RichShipRuntimeState): ShipSystemsSnapshot {
  return {
    energy: state.energy,
    energyMax: state.energyMax,
    heat: state.heat,
    heatMax: state.heatMax,
    shield: state.shield,
    shieldMax: state.shieldMax,
    shieldRegenDelayRemaining: state.shieldRegenDelayRemaining,
    overheated: state.overheated,
    brownout: state.brownout,
    modules: state.modules.map((module) => ({ ...module, enabled: moduleEnabled(module) })),
    weapons: state.weapons.map((weapon) => ({ ...weapon, ready: weapon.cooldownRemaining === 0 }))
  };
}

/** Immutable, deterministic module state used by replay and result persistence. */
export function createAuthoritativeModuleDamage(
  stats: LegacyWeaponStats & RichShipSystemsConfig,
  state: RichShipRuntimeState
): AuthoritativeModuleDamage[] {
  const config = resolveRichShipConfig(stats);
  const runtimeById = new Map(state.modules.map((module) => [module.id, module]));
  if (runtimeById.size !== state.modules.length || state.modules.length !== config.modules.length) {
    throw new Error("Authoritative module state does not match the simulation configuration.");
  }
  return [...config.modules]
    .sort((left, right) => compareIdentifiers(left.id, right.id))
    .map((module) => {
      const runtime = runtimeById.get(module.id);
      if (!runtime || runtime.hpMax !== module.hp || runtime.hp < 0 || runtime.hp > runtime.hpMax) {
        throw new Error(`Authoritative module state is invalid for ${module.id}.`);
      }
      return {
        moduleId: module.id,
        inventoryItemId: module.inventoryItemId ?? module.id,
        hpBefore: module.hp,
        hpAfter: runtime.hp,
        hpLoss: module.hp - runtime.hp,
        detached: runtime.detached
      };
    });
}

export function cloneRichShipState(state: RichShipRuntimeState): RichShipRuntimeState {
  return {
    ...state,
    modules: state.modules.map((module) => ({ ...module })),
    weapons: state.weapons.map((weapon) => ({ ...weapon }))
  };
}

export function cloneRichShipStats<T extends LegacyWeaponStats & RichShipSystemsConfig>(stats: T): T {
  return {
    ...stats,
    weapons: stats.weapons?.map((weapon) => ({ ...weapon })),
    modules: stats.modules?.map((module) => ({ ...module }))
  };
}

export function richShipConfigTokens(
  stats: LegacyWeaponStats & RichShipSystemsConfig
): Array<string | number> {
  const config = resolveRichShipConfig(stats);
  const tokens: Array<string | number> = [
    config.energyCapacity,
    config.energyInitial,
    config.energyGenerationPerTick,
    config.engineEnergyPerTick,
    config.heatCapacity,
    config.heatDissipationPerTick,
    config.overheatRecoveryHeat,
    config.shieldCapacity,
    config.shieldInitial,
    config.shieldRegenPerTick,
    config.shieldRegenDelayTicks,
    config.shieldEnergyPerTick
  ];
  for (const weapon of config.weapons) {
    tokens.push(
      weapon.id,
      weapon.moduleId ?? "-",
      weapon.damage,
      weapon.rangeUnits,
      weapon.cooldownTicks,
      weapon.projectileSpeedUnitsPerSecond,
      weapon.energyCost,
      weapon.heatPerShot,
      weapon.actionFlag
    );
  }
  for (const module of config.modules) {
    tokens.push(
      module.id,
      module.inventoryItemId ?? module.id,
      module.category,
      module.hp,
      module.gridX,
      module.gridY,
      module.parentModuleId ?? "-",
      module.collisionRadiusUnits ?? 1,
      module.powerDemandPerTick ?? 0,
      module.powerPriority ?? 100,
      module.heatGenerationPerTick ?? 0
    );
  }
  return tokens;
}

export function richShipStateTokens(state: RichShipRuntimeState): Array<string | number> {
  const tokens: Array<string | number> = [
    state.energy,
    state.energyMax,
    state.heat,
    state.heatMax,
    state.shield,
    state.shieldMax,
    state.shieldRegenDelayRemaining,
    state.overheated ? 1 : 0,
    state.brownout ? 1 : 0
  ];
  for (const module of state.modules) {
    tokens.push(
      module.id,
      module.category,
      module.hp,
      module.hpMax,
      module.gridX,
      module.gridY,
      module.parentModuleId ?? "-",
      module.powered ? 1 : 0,
      module.detached ? 1 : 0
    );
  }
  for (const weapon of state.weapons) {
    tokens.push(weapon.id, weapon.moduleId ?? "-", weapon.cooldownRemaining);
  }
  return tokens;
}

export function validateRichShipConfig(
  stats: LegacyWeaponStats & RichShipSystemsConfig,
  label: string
): void {
  const optionalNonNegative: Array<[string, number | undefined]> = [
    ["energyCapacity", stats.energyCapacity],
    ["energyInitial", stats.energyInitial],
    ["energyGenerationPerTick", stats.energyGenerationPerTick],
    ["engineEnergyPerTick", stats.engineEnergyPerTick],
    ["heatCapacity", stats.heatCapacity],
    ["heatDissipationPerTick", stats.heatDissipationPerTick],
    ["overheatRecoveryHeat", stats.overheatRecoveryHeat],
    ["shieldCapacity", stats.shieldCapacity],
    ["shieldInitial", stats.shieldInitial],
    ["shieldRegenPerTick", stats.shieldRegenPerTick],
    ["shieldRegenDelayTicks", stats.shieldRegenDelayTicks],
    ["shieldEnergyPerTick", stats.shieldEnergyPerTick]
  ];
  for (const [key, value] of optionalNonNegative) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000)) {
      throw new Error(`${label}.${key} must be a bounded non-negative integer.`);
    }
  }
  const config = resolveRichShipConfig(stats);
  if (config.energyCapacity <= 0 || config.heatCapacity <= 0) {
    throw new Error(`${label} energy and heat capacities must be positive.`);
  }
  if ((stats.energyInitial ?? config.energyInitial) > config.energyCapacity
    || (stats.shieldInitial ?? config.shieldInitial) > config.shieldCapacity
    || (stats.overheatRecoveryHeat ?? config.overheatRecoveryHeat) > config.heatCapacity) {
    throw new Error(`${label} initial/recovery values must fit their capacities.`);
  }
  if (config.weapons.length === 0 || config.weapons.length > 31) {
    throw new Error(`${label} must define between 1 and 31 weapons.`);
  }
  const weaponIds = new Set<string>();
  const actionFlags = new Set<number>();
  for (const weapon of config.weapons) {
    validateIdentifier(weapon.id, `${label}.weapon.id`);
    if (weaponIds.has(weapon.id)) throw new Error(`${label} weapon ids must be unique.`);
    weaponIds.add(weapon.id);
    if (!Number.isSafeInteger(weapon.actionFlag)
      || weapon.actionFlag <= 0
      || weapon.actionFlag > UINT32_MAX
      || (weapon.actionFlag & (weapon.actionFlag - 1)) !== 0
      || actionFlags.has(weapon.actionFlag)) {
      throw new Error(`${label} weapon action flags must be unique powers of two.`);
    }
    actionFlags.add(weapon.actionFlag);
    for (const [key, value] of Object.entries({
      damage: weapon.damage,
      rangeUnits: weapon.rangeUnits,
      cooldownTicks: weapon.cooldownTicks,
      projectileSpeedUnitsPerSecond: weapon.projectileSpeedUnitsPerSecond
    })) {
      if (!Number.isSafeInteger(value) || value <= 0 || value > 1_000_000) {
        throw new Error(`${label}.weapon.${key} must be a bounded positive integer.`);
      }
    }
    for (const [key, value] of Object.entries({ energyCost: weapon.energyCost, heatPerShot: weapon.heatPerShot })) {
      if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) {
        throw new Error(`${label}.weapon.${key} must be a bounded non-negative integer.`);
      }
    }
  }
  if (config.modules.length > 256) throw new Error(`${label} cannot define more than 256 modules.`);
  const moduleIds = new Set<string>();
  const inventoryItemIds = new Set<string>();
  for (const module of config.modules) {
    validateIdentifier(module.id, `${label}.module.id`);
    if (moduleIds.has(module.id)) throw new Error(`${label} module ids must be unique.`);
    moduleIds.add(module.id);
    const inventoryItemId = module.inventoryItemId ?? module.id;
    validateIdentifier(inventoryItemId, `${label}.module.inventoryItemId`);
    if (inventoryItemIds.has(inventoryItemId)) {
      throw new Error(`${label} module inventory item ids must be unique.`);
    }
    inventoryItemIds.add(inventoryItemId);
    if (!Number.isSafeInteger(module.hp) || module.hp <= 0 || module.hp > 1_000_000) {
      throw new Error(`${label}.module.hp must be a bounded positive integer.`);
    }
    for (const [key, value] of Object.entries({ gridX: module.gridX, gridY: module.gridY })) {
      if (!Number.isSafeInteger(value) || Math.abs(value) > 1_000) {
        throw new Error(`${label}.module.${key} must be a bounded integer.`);
      }
    }
    for (const [key, value] of Object.entries({
      collisionRadiusUnits: module.collisionRadiusUnits ?? 1,
      powerDemandPerTick: module.powerDemandPerTick ?? 0,
      powerPriority: module.powerPriority ?? 100,
      heatGenerationPerTick: module.heatGenerationPerTick ?? 0
    })) {
      if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) {
        throw new Error(`${label}.module.${key} must be a bounded non-negative integer.`);
      }
    }
  }
  for (const module of config.modules) {
    if (module.parentModuleId !== undefined && (!moduleIds.has(module.parentModuleId) || module.parentModuleId === module.id)) {
      throw new Error(`${label} module parent must reference another module.`);
    }
  }
  for (const weapon of config.weapons) {
    if (weapon.moduleId !== undefined && !moduleIds.has(weapon.moduleId)) {
      throw new Error(`${label} weapon module must reference a configured module.`);
    }
  }
  assertAcyclicModules(config.modules, label);
}

function moduleEnabled(module: ShipModuleRuntimeState): boolean {
  return module.hp > 0 && !module.detached;
}

function categoryAvailable(state: RichShipRuntimeState, category: ShipModuleCategory): boolean {
  const modules = state.modules.filter((module) => module.category === category);
  return modules.length === 0 || modules.some((module) => moduleEnabled(module) && module.powered);
}

function categoryOperational(state: RichShipRuntimeState, category: ShipModuleCategory): boolean {
  const modules = state.modules.filter((module) => module.category === category);
  return modules.length === 0 || modules.some(moduleEnabled);
}

function weaponModuleAvailable(state: RichShipRuntimeState, moduleId: string | undefined): boolean {
  if (!moduleId) return true;
  const module = state.modules.find((candidate) => candidate.id === moduleId);
  return module !== undefined && moduleEnabled(module) && module.powered;
}

function selectImpactModule(
  modules: ShipModuleRuntimeState[],
  impactGridX: number,
  impactGridY: number
): ShipModuleRuntimeState | null {
  let selected: ShipModuleRuntimeState | null = null;
  let selectedDistance = Number.MAX_SAFE_INTEGER;
  for (const module of modules) {
    if (!moduleEnabled(module)) continue;
    const dx = module.gridX - impactGridX;
    const dy = module.gridY - impactGridY;
    const distance = dx * dx + dy * dy;
    if (distance < selectedDistance || (distance === selectedDistance && selected && module.id < selected.id)) {
      selected = module;
      selectedDistance = distance;
    }
  }
  return selected;
}

function compareIdentifiers(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function recomputeTopology(modules: ShipModuleRuntimeState[]): string[] {
  if (modules.length === 0) return [];
  const previousDetached = new Set(modules.filter((module) => module.detached).map((module) => module.id));
  const connected = new Set<string>();
  const roots = modules.filter((module) => module.parentModuleId === null && module.hp > 0);
  const queue = roots.map((module) => module.id).sort();
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || connected.has(id)) continue;
    connected.add(id);
    for (const child of modules) {
      if (child.parentModuleId === id && child.hp > 0) queue.push(child.id);
    }
    queue.sort();
  }
  const newlyDetached: string[] = [];
  for (const module of modules) {
    const detached = module.hp > 0 && !connected.has(module.id);
    module.detached = detached;
    if (detached && !previousDetached.has(module.id)) newlyDetached.push(module.id);
  }
  return newlyDetached.sort();
}

function assertAcyclicModules(modules: ShipModuleSimulationConfig[], label: string): void {
  const parents = new Map(modules.map((module) => [module.id, module.parentModuleId]));
  for (const module of modules) {
    const seen = new Set<string>();
    let current: string | undefined = module.id;
    while (current !== undefined) {
      if (seen.has(current)) throw new Error(`${label} module topology must be acyclic.`);
      seen.add(current);
      current = parents.get(current);
    }
  }
}

function validateIdentifier(value: string, label: string): void {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) {
    throw new Error(`${label} must be a non-empty bounded string.`);
  }
}
