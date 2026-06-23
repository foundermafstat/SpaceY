import type { ModuleDef, PanelDef, PanelState } from "@/game/types";

export type ModuleSpriteKey =
  | "core"
  | "hull"
  | "armor"
  | "reactor"
  | "ionEngine"
  | "plasmaThruster"
  | "sideThruster"
  | "shield"
  | "battery"
  | "utility"
  | "missileHousing"
  | "railgunHousing";

export type WeaponSpriteKey =
  | "autocannonBase"
  | "laserBase"
  | "plasmaBase"
  | "missileBase"
  | "autocannonTurret"
  | "laserTurret"
  | "plasmaTurret"
  | "missileTurret";

export type HoverSpriteKey = "ring" | "shadow" | "jet" | "pulse";

export type BattleVfxSpriteKey =
  | "kineticProjectile"
  | "plasmaProjectile"
  | "missileProjectile"
  | "shellCasing"
  | "kineticImpact"
  | "armorImpact"
  | "shieldImpact"
  | "smokePuff"
  | "smallExplosion"
  | "mediumExplosion"
  | "largeExplosion"
  | "debrisCluster";

export const moduleAtlas = {
  src: "/assets/modules/modules-atlas-v2.png",
  columns: 4,
  rows: 3,
  frameWidth: 1254 / 4,
  frameHeight: 1254 / 3,
  cells: {
    core: { col: 0, row: 0 },
    hull: { col: 1, row: 0 },
    armor: { col: 2, row: 0 },
    reactor: { col: 3, row: 0 },
    ionEngine: { col: 0, row: 1 },
    plasmaThruster: { col: 1, row: 1 },
    sideThruster: { col: 2, row: 1 },
    shield: { col: 3, row: 1 },
    battery: { col: 0, row: 2 },
    utility: { col: 1, row: 2 },
    missileHousing: { col: 2, row: 2 },
    railgunHousing: { col: 3, row: 2 }
  } satisfies Record<ModuleSpriteKey, { col: number; row: number }>
};

export const moduleStateAtlas = {
  ...moduleAtlas,
  src: "/assets/modules/module-states-atlas.png",
  rows: moduleAtlas.rows * 4
};

export const weaponAtlas = {
  src: "/assets/weapons/weapon-parts-atlas.png",
  columns: 4,
  rows: 2,
  frameWidth: 384,
  frameHeight: 512,
  cells: {
    autocannonBase: { col: 0, row: 0 },
    laserBase: { col: 1, row: 0 },
    plasmaBase: { col: 2, row: 0 },
    missileBase: { col: 3, row: 0 },
    autocannonTurret: { col: 0, row: 1 },
    laserTurret: { col: 1, row: 1 },
    plasmaTurret: { col: 2, row: 1 },
    missileTurret: { col: 3, row: 1 }
  } satisfies Record<WeaponSpriteKey, { col: number; row: number }>
};

export const weaponStateAtlas = {
  ...weaponAtlas,
  src: "/assets/weapons/weapon-states-atlas.png",
  rows: weaponAtlas.rows * 4
};

export type AiModuleSpriteKey =
  | "core"
  | "hull"
  | "hullBridge"
  | "armor"
  | "ionEngine"
  | "plasmaThruster"
  | "sideThruster"
  | "reactor"
  | "autocannon"
  | "laser"
  | "plasma"
  | "missile"
  | "shield";

export const aiModuleAtlas = {
  src: "/assets/generated/ai/module-ai-normalized-atlas.png",
  columns: 12,
  rows: 9,
  cells: {
    core: { col: 7, row: 0 },
    hull: { col: 1, row: 0 },
    hullBridge: { col: 10, row: 1 },
    armor: { col: 4, row: 3 },
    ionEngine: { col: 9, row: 4 },
    plasmaThruster: { col: 7, row: 4 },
    sideThruster: { col: 0, row: 5 },
    reactor: { col: 7, row: 5 },
    autocannon: { col: 2, row: 7 },
    laser: { col: 8, row: 7 },
    plasma: { col: 1, row: 8 },
    missile: { col: 10, row: 6 },
    shield: { col: 2, row: 4 }
  } satisfies Record<AiModuleSpriteKey, { col: number; row: number }>
};

export const hoverAtlas = {
  src: "/assets/vfx/hover-vfx-atlas.png",
  columns: 2,
  rows: 2,
  frameWidth: 1254 / 2,
  frameHeight: 1254 / 2,
  cells: {
    ring: { col: 0, row: 0 },
    shadow: { col: 1, row: 0 },
    jet: { col: 0, row: 1 },
    pulse: { col: 1, row: 1 }
  } satisfies Record<HoverSpriteKey, { col: number; row: number }>
};

export const battleVfxAtlas = {
  src: "/assets/vfx/battle-vfx-atlas.png",
  columns: 4,
  rows: 3,
  frameWidth: 1254 / 4,
  frameHeight: 1254 / 3,
  cells: {
    kineticProjectile: { col: 0, row: 0 },
    plasmaProjectile: { col: 1, row: 0 },
    missileProjectile: { col: 2, row: 0 },
    shellCasing: { col: 3, row: 0 },
    kineticImpact: { col: 0, row: 1 },
    armorImpact: { col: 1, row: 1 },
    shieldImpact: { col: 2, row: 1 },
    smokePuff: { col: 3, row: 1 },
    smallExplosion: { col: 0, row: 2 },
    mediumExplosion: { col: 1, row: 2 },
    largeExplosion: { col: 2, row: 2 },
    debrisCluster: { col: 3, row: 2 }
  } satisfies Record<BattleVfxSpriteKey, { col: number; row: number }>
};

export const panelAtlas = {
  src: "/assets/panels/panel-states-atlas.png",
  columns: 25,
  rows: 4
};

const panelStateRows: Record<PanelState, number> = {
  ideal: 0,
  damaged: 1,
  critical: 2,
  debris: 3
};

export function getModuleSpriteKey(module: ModuleDef): ModuleSpriteKey {
  if (module.type === "core") return "core";
  if (module.type === "armor") return "armor";
  if (module.id === "plasma_thruster") return "plasmaThruster";
  if (module.id === "side_thruster") return "sideThruster";
  if (module.type === "engine") return "ionEngine";
  if (module.type === "reactor" || module.type === "battery") return "reactor";
  if (module.id === "missile_pod") return "missileHousing";
  if (module.type === "weapon") return "railgunHousing";
  if (module.type === "shield") return "shield";
  if (module.type === "utility") return "utility";
  return "hull";
}

export function getModuleSpriteStyle(module: ModuleDef) {
  const key = getModuleSpriteKey(module);
  return getAtlasStyle(moduleAtlas, key);
}

export function getAiModuleSpriteStyle(module: ModuleDef) {
  return getAtlasStyle(aiModuleAtlas, getAiModuleSpriteKey(module));
}

export function getHoverSpriteStyle(key: HoverSpriteKey = "ring") {
  return getAtlasStyle(hoverAtlas, key);
}

export function getPanelSpriteStyle(panel: PanelDef, state: PanelState = "ideal") {
  const x = panel.spriteIndex / (panelAtlas.columns - 1) * 100;
  const y = panelStateRows[state] / (panelAtlas.rows - 1) * 100;
  return {
    backgroundImage: `url(${panelAtlas.src})`,
    backgroundSize: `${panelAtlas.columns * 100}% ${panelAtlas.rows * 100}%`,
    backgroundPosition: `${x}% ${y}%`
  };
}

function getAtlasStyle<T extends string>(
  atlas: {
    src: string;
    columns: number;
    rows: number;
    cells: Record<T, { col: number; row: number }>;
  },
  key: T
) {
  const cell = atlas.cells[key];
  const x = atlas.columns === 1 ? 0 : (cell.col / (atlas.columns - 1)) * 100;
  const y = atlas.rows === 1 ? 0 : (cell.row / (atlas.rows - 1)) * 100;

  return {
    backgroundImage: `url(${atlas.src})`,
    backgroundSize: `${atlas.columns * 100}% ${atlas.rows * 100}%`,
    backgroundPosition: `${x}% ${y}%`
  };
}

function getAiModuleSpriteKey(module: ModuleDef): AiModuleSpriteKey {
  if (module.type === "core") return "core";
  if (module.id === "hull_bridge_2x1") return "hullBridge";
  if (module.type === "armor") return "armor";
  if (module.id === "plasma_thruster") return "plasmaThruster";
  if (module.id === "side_thruster") return "sideThruster";
  if (module.type === "engine") return "ionEngine";
  if (module.id === "autocannon") return "autocannon";
  if (module.id === "laser_turret") return "laser";
  if (module.id === "plasma_cannon") return "plasma";
  if (module.id === "missile_pod") return "missile";
  if (module.type === "reactor" || module.type === "battery") return "reactor";
  if (module.type === "shield") return "shield";
  return "hull";
}
