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
  src: "/assets/panels-v3/panels",
  columns: 14,
  rows: 4
};

const panelAssetStates: Record<PanelState, "ideal" | "damaged" | "heavyDamage" | "debris"> = {
  ideal: "ideal",
  damaged: "damaged",
  critical: "heavyDamage",
  debris: "debris"
};

const panelSpriteAssets: Record<string, { width: number; height: number }> = {
  single_1: { width: 1, height: 1 },
  bar_2h: { width: 2, height: 1 },
  bar_2v: { width: 1, height: 2 },
  bar_3h: { width: 3, height: 1 },
  bar_4h: { width: 4, height: 1 },
  block_2x2: { width: 2, height: 2 },
  corner_l_2x2: { width: 2, height: 2 },
  tee_3x2: { width: 3, height: 2 },
  cross_3x3: { width: 3, height: 3 },
  long_l_3x3: { width: 3, height: 3 },
  zig_3x3: { width: 3, height: 3 },
  c_2x3: { width: 2, height: 3 },
  long_corner_2x3: { width: 2, height: 3 },
  block_tail_2x3: { width: 2, height: 3 }
};

const panelAssetCellTransforms: Record<
  string,
  (
    cell: { x: number; y: number },
    source: { width: number; height: number },
    asset: { width: number; height: number }
  ) => { x: number; y: number }
> = {
  corner_l: (cell, _source, asset) => ({ x: cell.x, y: asset.height - 1 - cell.y }),
  corner_j: (cell, _source, asset) => ({
    x: asset.width - 1 - cell.x,
    y: asset.height - 1 - cell.y
  }),
  tee_tail: (cell, _source, asset) => ({ x: cell.x, y: asset.height - 1 - cell.y }),
  zig_s: (cell, source, asset) => ({
    x: asset.width - 1 - scaleIndex(cell.x, source.width, asset.width),
    y: scaleIndex(cell.y, source.height, asset.height)
  }),
  long_j: (cell, source, asset) => ({
    x: asset.width - 1 - scaleIndex(cell.x, source.width, asset.width),
    y: scaleIndex(cell.y, source.height, asset.height)
  })
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
  const src = getPanelSpriteSrc(panel, state);
  return {
    backgroundImage: `url(${src})`,
    backgroundSize: "contain",
    backgroundPosition: "center"
  };
}

export function getPanelCellSpriteStyle(
  panel: PanelDef,
  state: PanelState = "ideal",
  localCell: { x: number; y: number }
) {
  const asset = panelSpriteAssets[panel.spriteId] ?? panelSpriteAssets.single_1;
  const assetCell = getPanelAssetCell(panel, localCell, asset);
  const x = asset.width === 1 ? 0 : (assetCell.x / (asset.width - 1)) * 100;
  const y = asset.height === 1 ? 0 : (assetCell.y / (asset.height - 1)) * 100;

  return {
    backgroundImage: `url(${getPanelSpriteSrc(panel, state)})`,
    backgroundSize: `${asset.width * 100}% ${asset.height * 100}%`,
    backgroundPosition: `${x}% ${y}%`
  };
}

function getPanelSpriteSrc(panel: PanelDef, state: PanelState) {
  const assetId = panelSpriteAssets[panel.spriteId] ? panel.spriteId : "single_1";
  return `${panelAtlas.src}/${panelAssetStates[state]}/${assetId}.webp`;
}

function getPanelAssetCell(
  panel: PanelDef,
  localCell: { x: number; y: number },
  asset: { width: number; height: number }
) {
  const bounds = panel.shape.cells.reduce(
    (acc, cell) => ({
      minX: Math.min(acc.minX, cell.x),
      minY: Math.min(acc.minY, cell.y),
      maxX: Math.max(acc.maxX, cell.x),
      maxY: Math.max(acc.maxY, cell.y)
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  );
  const panelWidth = bounds.maxX - bounds.minX + 1;
  const panelHeight = bounds.maxY - bounds.minY + 1;
  const normalized = {
    x: localCell.x - bounds.minX,
    y: localCell.y - bounds.minY
  };
  const source = { width: panelWidth, height: panelHeight };
  const transform = panelAssetCellTransforms[panel.id];

  if (transform) {
    return clampAssetCell(transform(normalized, source, asset), asset);
  }

  if (asset.width === panelWidth && asset.height === panelHeight) {
    return clampAssetCell(normalized, asset);
  }
  if (asset.width === panelHeight && asset.height === panelWidth) {
    return clampAssetCell({ x: normalized.y, y: normalized.x }, asset);
  }

  return clampAssetCell(
    {
      x: scaleIndex(normalized.x, panelWidth, asset.width),
      y: scaleIndex(normalized.y, panelHeight, asset.height)
    },
    asset
  );
}

function scaleIndex(value: number, sourceSize: number, targetSize: number) {
  if (sourceSize <= 1 || targetSize <= 1) return 0;
  return Math.round((value / (sourceSize - 1)) * (targetSize - 1));
}

function clampAssetCell(cell: { x: number; y: number }, asset: { width: number; height: number }) {
  return {
    x: Math.max(0, Math.min(asset.width - 1, cell.x)),
    y: Math.max(0, Math.min(asset.height - 1, cell.y))
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
