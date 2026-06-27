import type {
  CabinDef,
  ElementDef,
  ElementRole,
  FrameDef,
  InstalledElement,
  InstalledModule,
  ModuleDef,
  NetworkType,
  ShipBuild,
  ShipBuildV2,
  SocketType
} from "@/game/types";

const socketNetworks: Record<SocketType, NetworkType[]> = {
  none: [],
  hard: ["structure"],
  power: ["power"],
  weapon: ["power", "control"],
  engine: ["power", "heat", "control"],
  utility: ["power", "control"]
};

const moduleElementRoles: Record<ModuleDef["type"], Exclude<ElementRole, "maneuver_thruster" | "radiator" | "cargo" | "scanner" | "drill">> = {
  core: "cabin",
  hull: "structure",
  armor: "armor",
  engine: "engine",
  weapon: "weapon",
  reactor: "reactor",
  battery: "battery",
  shield: "shield",
  utility: "utility"
};

export function moduleToElementRole(module: ModuleDef): ElementRole {
  if (module.id === "side_thruster") return "maneuver_thruster";
  return moduleElementRoles[module.type];
}

export function frameToCabinDef(frame: FrameDef): CabinDef {
  return {
    id: frame.id.replace("_frame", "_cabin"),
    name: frame.name.replace("Frame", "Cabin"),
    gridSize: frame.size,
    activeCells: frame.activeCells,
    baseMass: frame.baseMass,
    baseHp: frame.baseHp,
    baseEnergy: 0,
    crew: 1,
    panelLimit: frame.maxModules,
    maxMass: frame.maxMass,
    role: frame.id.includes("enemy") ? "fighter" : "scout",
    spriteId: frame.spriteId,
    legacyFrameId: frame.id
  };
}

export function moduleToElementDef(module: ModuleDef): ElementDef {
  return {
    id: module.id,
    name: module.name,
    role: moduleToElementRole(module),
    rarity: module.rarity,
    shape: module.shape,
    sockets: module.sockets,
    mountSlots: (Object.entries(module.sockets) as [keyof ModuleDef["sockets"], SocketType][]).map(([side, socket]) => ({
      id: `${module.id}-${side}`,
      cell: { x: 0, y: 0 },
      socket,
      side: side as keyof ModuleDef["sockets"],
      networkTypes: socketNetworks[socket]
    })),
    mass: module.mass,
    hp: module.hp,
    energyProduction: module.energyProduction,
    energyConsumption: module.energyConsumption,
    heatGeneration: module.heatGeneration,
    heatDissipation: module.heatDissipation,
    thrust: module.thrust,
    maneuverThrust: module.maneuverThrust,
    engineProfile: module.engineProfile,
    weapon: module.weapon,
    shield: module.shield,
    spriteId: module.spriteId,
    emissionSpriteId: module.emissionSpriteId,
    damagedSpriteId: module.damagedSpriteId,
    tags: module.tags,
    legacyModuleId: module.id
  };
}

export function installedModuleToElement(module: InstalledModule): InstalledElement {
  return {
    instanceId: module.instanceId,
    elementId: module.moduleId,
    legacyModuleId: module.moduleId,
    position: module.position,
    rotation: module.rotation
  };
}

export function shipBuildToV2(build: ShipBuild): ShipBuildV2 {
  return {
    schemaVersion: build.schemaVersion >= 4 ? 4 : 3,
    id: build.id,
    name: build.name,
    cabinId: build.cabinId ?? build.frameId,
    frameId: build.frameId,
    panels: build.panels,
    elements: build.elements ?? build.modules.map(installedModuleToElement)
  };
}
