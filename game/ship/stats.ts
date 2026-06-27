import { getFrame, getModule, getPanel } from "@/game/ship/build";
import type { ShipBuild, ShipStats } from "@/game/types";

export function calculateShipStats(build: ShipBuild): ShipStats {
  const frame = getFrame(build.frameId);
  const panels = (build.panels ?? []).map((installed) => getPanel(installed.panelId));
  const modules = build.modules.map((installed) => getModule(installed.moduleId));
  const statModules = build.cabinId
    ? modules.filter((module) => module.type !== "core")
    : modules;
  const mass =
    frame.baseMass +
    panels.reduce((sum, panel) => sum + panel.mass, 0) +
    statModules.reduce((sum, module) => sum + module.mass, 0);
  const hp =
    frame.baseHp +
    panels.reduce((sum, panel) => sum + panel.hp, 0) +
    statModules.reduce((sum, module) => sum + module.hp, 0);
  const thrust = statModules.reduce((sum, module) => sum + (module.thrust ?? 0), 0);
  const maneuverThrust = statModules.reduce((sum, module) => sum + (module.maneuverThrust ?? 0), 0);
  const energyProduction = statModules.reduce(
    (sum, module) => sum + (module.energyProduction ?? 0),
    0
  );
  const energyConsumption = statModules.reduce(
    (sum, module) => sum + (module.energyConsumption ?? 0),
    0
  );
  const heat = statModules.reduce(
    (sum, module) => sum + (module.heatGeneration ?? 0) - (module.heatDissipation ?? 0),
    0
  );
  const dps = statModules.reduce((sum, module) => {
    if (!module.weapon) return sum;
    return sum + module.weapon.damage * module.weapon.fireRate;
  }, 0);
  const shield = statModules.reduce((sum, module) => sum + (module.shield?.capacity ?? 0), 0);
  const acceleration = thrust / Math.max(1, mass);
  const energyBalance = energyProduction - energyConsumption;
  const maxSpeed = Math.max(80, 82 + acceleration * 92 + Math.sqrt(thrust) * 5.5);
  const turnRate = Math.max(1.2, (maneuverThrust + thrust * 0.18) / Math.max(40, mass));

  const warnings: string[] = [];
  if (!build.cabinId && !modules.some((module) => module.type === "core")) warnings.push("Core module required");
  if (!statModules.some((module) => module.type === "engine")) warnings.push("At least one engine required");
  if (!statModules.some((module) => module.type === "reactor")) warnings.push("Power module required");
  if (energyBalance < 0) warnings.push("Low Power: energy usage exceeds production");
  if (mass > frame.maxMass) warnings.push("Mass exceeds frame limit");
  if (heat > 40) warnings.push("High heat load");

  return {
    hp,
    shield,
    mass,
    thrust,
    acceleration,
    maxSpeed,
    turnRate,
    energyProduction,
    energyConsumption,
    energyBalance,
    heat,
    dps,
    warnings
  };
}
