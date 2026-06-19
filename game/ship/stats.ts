import { getFrame, getModule } from "@/game/ship/build";
import type { ShipBuild, ShipStats } from "@/game/types";

export function calculateShipStats(build: ShipBuild): ShipStats {
  const frame = getFrame(build.frameId);
  const modules = build.modules.map((installed) => getModule(installed.moduleId));
  const mass = frame.baseMass + modules.reduce((sum, module) => sum + module.mass, 0);
  const hp = frame.baseHp + modules.reduce((sum, module) => sum + module.hp, 0);
  const thrust = modules.reduce((sum, module) => sum + (module.thrust ?? 0), 0);
  const maneuverThrust = modules.reduce((sum, module) => sum + (module.maneuverThrust ?? 0), 0);
  const energyProduction = modules.reduce(
    (sum, module) => sum + (module.energyProduction ?? 0),
    0
  );
  const energyConsumption = modules.reduce(
    (sum, module) => sum + (module.energyConsumption ?? 0),
    0
  );
  const heat = modules.reduce(
    (sum, module) => sum + (module.heatGeneration ?? 0) - (module.heatDissipation ?? 0),
    0
  );
  const dps = modules.reduce((sum, module) => {
    if (!module.weapon) return sum;
    return sum + module.weapon.damage * module.weapon.fireRate;
  }, 0);
  const shield = modules.reduce((sum, module) => sum + (module.shield?.capacity ?? 0), 0);
  const acceleration = thrust / Math.max(1, mass);
  const energyBalance = energyProduction - energyConsumption;
  const maxSpeed = Math.max(80, 82 + acceleration * 92 + Math.sqrt(thrust) * 5.5);
  const turnRate = Math.max(1.2, (maneuverThrust + thrust * 0.18) / Math.max(40, mass));

  const warnings: string[] = [];
  if (!modules.some((module) => module.type === "core")) warnings.push("Core module required");
  if (!modules.some((module) => module.type === "engine")) warnings.push("At least one engine required");
  if (!modules.some((module) => module.type === "reactor")) warnings.push("Power module required");
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
