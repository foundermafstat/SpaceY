import { calculateShipStatsV2 } from "@/game/ship/statsV2";
import type { ShipBuild, ShipStats } from "@/game/types";

export function calculateShipStats(build: ShipBuild): ShipStats {
  const stats = calculateShipStatsV2(build);
  return {
    hp: stats.hp,
    shield: stats.shield,
    mass: stats.mass,
    thrust: stats.thrust,
    acceleration: stats.acceleration,
    maxSpeed: stats.maxSpeed,
    turnRate: stats.turnRate,
    energyProduction: stats.energyProduction,
    energyConsumption: stats.energyConsumption,
    energyBalance: stats.energyBalance,
    heat: stats.heat,
    dps: stats.dps,
    warnings: stats.warnings
  };
}
