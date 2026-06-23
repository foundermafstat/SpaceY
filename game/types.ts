export type ModuleType =
  | "core"
  | "hull"
  | "armor"
  | "engine"
  | "weapon"
  | "reactor"
  | "battery"
  | "shield"
  | "utility";

export type DamageType =
  | "kinetic"
  | "explosive"
  | "energy"
  | "plasma"
  | "emp"
  | "thermal"
  | "piercing";

export type SocketType = "none" | "hard" | "power" | "weapon" | "engine" | "utility";
export type Rotation = 0 | 90 | 180 | 270;
export type BuildMode = "panels" | "modules";
export type PanelState = "ideal" | "damaged" | "critical" | "debris";
export type PanelConnectorSide = "top" | "right" | "bottom" | "left";

export interface GridCell {
  x: number;
  y: number;
}

export interface ModuleShape {
  cells: GridCell[];
}

export interface PanelConnector {
  cell: GridCell;
  side: PanelConnectorSide;
  id: string;
}

export interface PanelDef {
  id: string;
  name: string;
  shape: ModuleShape;
  connectors: PanelConnector[];
  mass: number;
  hp: number;
  spriteId: string;
  spriteIndex: number;
  tags: string[];
}

export interface ModuleSockets {
  top: SocketType;
  right: SocketType;
  bottom: SocketType;
  left: SocketType;
}

export interface WeaponDef {
  damageType: DamageType;
  damage: number;
  fireRate: number;
  cooldown: number;
  range: number;
  projectileSpeed?: number;
  turnSpeed: number;
  targetingMode: "nearest" | "lowest_hp" | "highest_threat" | "missiles" | "boss_weakpoint";
  energyPerShot: number;
  heatPerShot: number;
  aoeRadius?: number;
  piercing?: number;
  knockback?: number;
  projectileSpriteId?: string;
  muzzleVfxId?: string;
  impactVfxId?: string;
}

export interface ShieldDef {
  capacity: number;
  regen: number;
  radius: number;
}

export interface ModuleDef {
  id: string;
  name: string;
  type: ModuleType;
  rarity: "common" | "rare" | "epic" | "legendary" | "prototype";
  shape: ModuleShape;
  sockets: ModuleSockets;
  mass: number;
  hp: number;
  energyProduction?: number;
  energyConsumption?: number;
  heatGeneration?: number;
  heatDissipation?: number;
  thrust?: number;
  maneuverThrust?: number;
  weapon?: WeaponDef;
  shield?: ShieldDef;
  spriteId: string;
  emissionSpriteId?: string;
  damagedSpriteId?: string;
  tags: string[];
}

export interface FrameDef {
  id: string;
  name: string;
  size: {
    width: number;
    height: number;
  };
  activeCells: GridCell[];
  baseMass: number;
  baseHp: number;
  maxModules: number;
  maxWeapons: number;
  maxReactors: number;
  maxMass: number;
  spriteId?: string;
}

export interface InstalledModule {
  instanceId: string;
  moduleId: string;
  position: GridCell;
  rotation: Rotation;
}

export interface InstalledPanel {
  instanceId: string;
  panelId: string;
  position: GridCell;
  rotation: Rotation;
  state: PanelState;
}

export interface ShipBuild {
  id: string;
  name: string;
  frameId: string;
  panels: InstalledPanel[];
  modules: InstalledModule[];
}

export interface ShipStats {
  hp: number;
  shield: number;
  mass: number;
  thrust: number;
  acceleration: number;
  maxSpeed: number;
  turnRate: number;
  energyProduction: number;
  energyConsumption: number;
  energyBalance: number;
  heat: number;
  dps: number;
  warnings: string[];
}
