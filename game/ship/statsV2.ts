import { getFrame, getModule, getPanel, getTransformedCells } from "@/game/ship/build";
import {
  buildShipTopology,
  getConnectedPanelsFromCabin,
  getNetworkLoad
} from "@/game/ship/topology";
import type { DamageType, EngineVector, GridCell, NetworkType, Rotation, ShipBuild, ShipStatsV2 } from "@/game/types";

const networkTypes: NetworkType[] = ["structure", "power", "heat", "control", "shield"];

export function calculateShipStatsV2(build: ShipBuild): ShipStatsV2 {
  const frame = getFrame(build.frameId);
  const panels = (build.panels ?? []).map((installed) => ({
    installed,
    def: getPanel(installed.panelId)
  }));
  const modules = build.modules.map((installed) => ({
    installed,
    def: getModule(installed.moduleId)
  }));
  const statModules = build.cabinId
    ? modules.filter((module) => module.def.type !== "core")
    : modules;

  const weighted = [{ mass: frame.baseMass, cell: frameCenter(build) }];
  panels.forEach(({ installed, def }) => {
    getTransformedCells(def, installed.position, installed.rotation).forEach((cell) => {
      weighted.push({ mass: def.mass / Math.max(1, def.shape.cells.length), cell });
    });
  });
  statModules.forEach(({ installed, def }) => {
    getTransformedCells(def, installed.position, installed.rotation).forEach((cell) => {
      weighted.push({ mass: def.mass / Math.max(1, def.shape.cells.length), cell });
    });
  });

  const mass =
    frame.baseMass +
    panels.reduce((sum, panel) => sum + panel.def.mass, 0) +
    statModules.reduce((sum, module) => sum + module.def.mass, 0);
  const hp =
    frame.baseHp +
    panels.reduce((sum, panel) => sum + panel.def.hp, 0) +
    statModules.reduce((sum, module) => sum + module.def.hp, 0);
  const centerOfMass = getCenterOfMass(weighted);
  const momentOfInertia = weighted.reduce((sum, item) => {
    const dx = item.cell.x - centerOfMass.x;
    const dy = item.cell.y - centerOfMass.y;
    return sum + item.mass * (dx * dx + dy * dy);
  }, 0);

  const engineVectors = getEngineVectors(statModules, centerOfMass);
  const mainThrust = engineVectors.reduce((sum, engine) => sum + engine.thrust, 0);
  const lateralThrust = engineVectors.reduce((sum, engine) => sum + engine.lateralThrust, 0);
  const reverseThrust = engineVectors.reduce((sum, engine) => sum + engine.reverseThrust, 0);
  const torque = engineVectors.reduce((sum, engine) => sum + Math.abs(engine.torqueArm) * engine.thrust, 0);
  const brakingPower = reverseThrust + lateralThrust * 0.25;
  const driftFactor = clamp(1 - lateralThrust / Math.max(1, mainThrust + lateralThrust), 0.05, 1);
  const stability = clamp(1 - torque / Math.max(1, mass * 120), 0, 1);
  const acceleration = mainThrust / Math.max(1, mass);
  const maxSpeed = Math.max(80, 82 + acceleration * 92 + Math.sqrt(mainThrust) * 5.5);
  const turnRate = Math.max(1.2, (lateralThrust + mainThrust * 0.18) / Math.max(40, mass));

  const powerOutput = statModules.reduce((sum, module) => sum + (module.def.energyProduction ?? 0), 0);
  const powerStorage = statModules.reduce(
    (sum, module) => sum + (module.def.type === "battery" ? module.def.hp : 0),
    0
  );
  const powerDemand = statModules.reduce((sum, module) => sum + (module.def.energyConsumption ?? 0), 0);
  const heatGeneration = statModules.reduce((sum, module) => sum + (module.def.heatGeneration ?? 0), 0);
  const heatDissipation = statModules.reduce((sum, module) => sum + (module.def.heatDissipation ?? 0), 0);
  const shieldCapacity = statModules.reduce((sum, module) => sum + (module.def.shield?.capacity ?? 0), 0);
  const shieldRegen = statModules.reduce((sum, module) => sum + (module.def.shield?.regen ?? 0), 0);
  const weaponDpsByType = getWeaponDpsByType(statModules.map((module) => module.def));
  const dps = Object.values(weaponDpsByType).reduce((sum, value) => sum + (value ?? 0), 0);
  const topology = buildShipTopology(build);
  const connectedPanels = getConnectedPanelsFromCabin(topology);
  const disconnectedParts = topology.nodes.filter(
    (node) => node.kind === "panel" && !connectedPanels.includes(node.id)
  ).length;

  const warnings: string[] = [];
  if (!build.cabinId && !modules.some((module) => module.def.type === "core")) warnings.push("Core module required");
  if (!statModules.some((module) => module.def.type === "engine")) warnings.push("At least one engine required");
  if (!statModules.some((module) => module.def.type === "reactor")) warnings.push("Power module required");
  if (powerOutput - powerDemand < 0) warnings.push("Low Power: energy usage exceeds production");
  if (mass > frame.maxMass) warnings.push("Mass exceeds frame limit");
  if (heatGeneration - heatDissipation > 40) warnings.push("High heat load");

  return {
    hp,
    shield: shieldCapacity,
    mass,
    thrust: mainThrust,
    acceleration,
    maxSpeed,
    turnRate,
    energyProduction: powerOutput,
    energyConsumption: powerDemand,
    energyBalance: powerOutput - powerDemand,
    heat: heatGeneration - heatDissipation,
    dps,
    warnings,
    structureHp: hp - statModules.reduce((sum, module) => sum + module.def.hp, 0),
    centerOfMass,
    momentOfInertia,
    mainThrust,
    reverseThrust,
    lateralThrust,
    engineVectors,
    torque,
    brakingPower,
    driftFactor,
    stability,
    powerOutput,
    powerStorage,
    powerDemand,
    heatGeneration,
    heatDissipation,
    shieldCapacity,
    shieldRegen,
    weaponDpsByType,
    disabledPartsImpact: disconnectedParts,
    networkCapacity: Object.fromEntries(
      networkTypes.map((networkType) => [networkType, getNetworkLoad(topology, networkType)])
    ) as Record<NetworkType, number>,
    disconnectedParts
  };
}

function frameCenter(build: ShipBuild): GridCell {
  const frame = getFrame(build.frameId);
  return {
    x: (frame.size.width - 1) / 2,
    y: (frame.size.height - 1) / 2
  };
}

function getCenterOfMass(items: { mass: number; cell: GridCell }[]): GridCell {
  const total = items.reduce((sum, item) => sum + item.mass, 0);
  if (total <= 0) return { x: 0, y: 0 };
  return {
    x: items.reduce((sum, item) => sum + item.cell.x * item.mass, 0) / total,
    y: items.reduce((sum, item) => sum + item.cell.y * item.mass, 0) / total
  };
}

function getWeaponDpsByType(modules: Array<{ weapon?: { damageType: DamageType; damage: number; fireRate: number } }>) {
  return modules.reduce<Partial<Record<DamageType, number>>>((result, module) => {
    if (!module.weapon) return result;
    result[module.weapon.damageType] =
      (result[module.weapon.damageType] ?? 0) + module.weapon.damage * module.weapon.fireRate;
    return result;
  }, {});
}

function getEngineVectors(
  modules: Array<{
    installed: { instanceId: string; moduleId: string; position: GridCell; rotation: Rotation };
    def: {
      thrust?: number;
      maneuverThrust?: number;
      energyConsumption?: number;
      heatGeneration?: number;
      engineProfile?: {
        thrustVector: GridCell;
        reverseThrust: number;
        lateralThrust: number;
        spoolTime: number;
        energyDrawPerSecond: number;
        heatPerSecond: number;
      };
      shape: { cells: GridCell[] };
    };
  }>,
  centerOfMass: GridCell
): EngineVector[] {
  return modules
    .filter((module) => (module.def.thrust ?? 0) > 0 || (module.def.maneuverThrust ?? 0) > 0)
    .map(({ installed, def }) => {
      const cells = getTransformedCells(def, installed.position, installed.rotation);
      const mount = averageCells(cells);
      const profile = def.engineProfile ?? {
        thrustVector: { x: 0, y: -1 },
        reverseThrust: (def.maneuverThrust ?? 0) * 0.35,
        lateralThrust: def.maneuverThrust ?? 0,
        spoolTime: 0.35,
        energyDrawPerSecond: def.energyConsumption ?? 0,
        heatPerSecond: def.heatGeneration ?? 0
      };
      const thrustVector = rotateGridVector(profile.thrustVector, installed.rotation);
      const arm = { x: mount.x - centerOfMass.x, y: mount.y - centerOfMass.y };

      return {
        partId: `element:${installed.instanceId}`,
        moduleId: installed.moduleId,
        mount,
        thrustVector,
        thrust: def.thrust ?? 0,
        reverseThrust: profile.reverseThrust,
        lateralThrust: profile.lateralThrust,
        spoolTime: profile.spoolTime,
        energyDrawPerSecond: profile.energyDrawPerSecond,
        heatPerSecond: profile.heatPerSecond,
        torqueArm: arm.x * thrustVector.y - arm.y * thrustVector.x
      };
    });
}

function averageCells(cells: GridCell[]): GridCell {
  if (cells.length === 0) return { x: 0, y: 0 };
  return {
    x: cells.reduce((sum, cell) => sum + cell.x, 0) / cells.length,
    y: cells.reduce((sum, cell) => sum + cell.y, 0) / cells.length
  };
}

function rotateGridVector(vector: GridCell, rotation: Rotation): GridCell {
  if (rotation === 90) return { x: -vector.y, y: vector.x };
  if (rotation === 180) return { x: -vector.x, y: -vector.y };
  if (rotation === 270) return { x: vector.y, y: -vector.x };
  return vector;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
