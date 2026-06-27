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
export type ShipBuildSchemaVersion = 2 | 3 | 4;
export type PanelRole =
  | "hull"
  | "armor"
  | "weapon_mount"
  | "engine_mount"
  | "utility_mount"
  | "cargo_floor"
  | "heat_sink"
  | "power_bus"
  | "adapter"
  | "spine";
export type ElementRole =
  | "cabin"
  | "structure"
  | "armor"
  | "engine"
  | "weapon"
  | "reactor"
  | "battery"
  | "shield"
  | "utility";
export type NetworkType = "structure" | "power" | "heat" | "control" | "shield";
export type ConnectorFamily = "structural" | "power" | "thermal" | "weapon" | "engine" | "utility";

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
  role: PanelRole;
  mountSlots: MountSlot[];
  networks: NetworkType[];
  external: boolean;
  armorClass: number;
  detachResistance: number;
  allowedElementRoles: ElementRole[];
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

export interface CabinDef {
  id: string;
  name: string;
  gridSize: FrameDef["size"];
  activeCells: GridCell[];
  baseMass: number;
  baseHp: number;
  baseEnergy: number;
  crew: number;
  panelLimit: number;
  maxMass: number;
  role: "scout" | "fighter" | "industrial" | "capital";
  spriteId?: string;
  legacyFrameId?: string;
}

export interface MountSlot {
  id: string;
  cell: GridCell;
  socket: SocketType;
  side?: PanelConnectorSide;
  networkTypes: NetworkType[];
}

export interface ElementDef {
  id: string;
  name: string;
  role: ElementRole;
  rarity: ModuleDef["rarity"];
  shape: ModuleShape;
  sockets: ModuleSockets;
  mountSlots: MountSlot[];
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
  legacyModuleId?: string;
}

export interface InstalledModule {
  instanceId: string;
  moduleId: string;
  position: GridCell;
  rotation: Rotation;
}

export interface InstalledElement {
  instanceId: string;
  elementId: string;
  position: GridCell;
  rotation: Rotation;
  legacyModuleId?: string;
}

export interface InstalledPanel {
  instanceId: string;
  panelId: string;
  position: GridCell;
  rotation: Rotation;
  state: PanelState;
}

export interface ShipBuild {
  schemaVersion: ShipBuildSchemaVersion;
  id: string;
  name: string;
  frameId: string;
  cabinId?: string;
  panels: InstalledPanel[];
  modules: InstalledModule[];
  elements?: InstalledModule[];
}

export interface ShipBuildV2 {
  schemaVersion: 3 | 4;
  id: string;
  name: string;
  cabinId: string;
  frameId?: string;
  panels: InstalledPanel[];
  elements: InstalledElement[];
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

export interface ShipStatsV2 extends ShipStats {
  structureHp: number;
  centerOfMass: GridCell;
  networkCapacity: Record<NetworkType, number>;
  disconnectedParts: number;
}

export interface ShipTopologyNode {
  id: string;
  kind: "cabin" | "panel" | "element";
  cells: GridCell[];
  networkTypes: NetworkType[];
}

export interface ShipTopologyEdge {
  from: string;
  to: string;
  family: ConnectorFamily;
  networkTypes: NetworkType[];
}

export interface ShipTopologyGraph {
  nodes: ShipTopologyNode[];
  edges: ShipTopologyEdge[];
}

export interface RuntimePartState {
  id: string;
  kind: "cabin" | "panel" | "element";
  hp: number;
  maxHp: number;
  gridCells: GridCell[];
  disabled: boolean;
  detached: boolean;
  networks: NetworkType[];
}
