import type { ModuleDef } from "@/game/types";

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

export function getHoverSpriteStyle(key: HoverSpriteKey = "ring") {
  return getAtlasStyle(hoverAtlas, key);
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
