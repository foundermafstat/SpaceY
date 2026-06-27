import { clamp } from "@/game/battle/math";
import type { ShipStatsV2 } from "@/game/types";

export type EnergyPriority = "lifeSupport" | "engines" | "shields" | "weapons" | "utility";

export type EnergyLoad = {
  id: string;
  priority: EnergyPriority;
  amountPerSecond: number;
};

export type EnergySystemState = {
  capacity: number;
  current: number;
  generationPerSecond: number;
  baseLoad: number;
  priorityLoads: Record<EnergyPriority, number>;
  brownoutLevel: number;
};

const priorityPenalty: Record<EnergyPriority, number> = {
  lifeSupport: 0,
  engines: 0.25,
  shields: 0.45,
  weapons: 0.72,
  utility: 0.9
};

export function createEnergySystem(stats: ShipStatsV2): EnergySystemState {
  const batteryBuffer = stats.powerStorage;
  const reactorBuffer = Math.max(20, stats.powerOutput * 2);
  const capacity = Math.max(20, batteryBuffer + reactorBuffer);

  return {
    capacity,
    current: capacity,
    generationPerSecond: stats.powerOutput,
    baseLoad: Math.max(1, stats.powerDemand * 0.18),
    priorityLoads: emptyPriorityLoads(),
    brownoutLevel: 0
  };
}

export function updateEnergySystem(state: EnergySystemState, dt: number, loads: EnergyLoad[]) {
  state.priorityLoads = emptyPriorityLoads();
  loads.forEach((load) => {
    state.priorityLoads[load.priority] += Math.max(0, load.amountPerSecond);
  });

  const totalLoad =
    state.baseLoad + Object.values(state.priorityLoads).reduce((sum, load) => sum + load, 0);
  const net = state.generationPerSecond - totalLoad;
  state.current = clamp(state.current + net * dt, 0, state.capacity);

  if (net >= 0 && state.current > 0) {
    state.brownoutLevel = Math.max(0, state.brownoutLevel - dt * 1.5);
    return;
  }

  const deficitRatio = clamp(Math.abs(net) / Math.max(1, totalLoad), 0, 1);
  const bufferPressure = 1 - state.current / Math.max(1, state.capacity);
  state.brownoutLevel = clamp(Math.max(state.brownoutLevel, deficitRatio * bufferPressure), 0, 1);
}

export function getEnergyEfficiency(state: EnergySystemState, priority: EnergyPriority) {
  return clamp(1 - state.brownoutLevel * priorityPenalty[priority], 0.1, 1);
}

export function trySpendEnergy(state: EnergySystemState, priority: EnergyPriority, amount: number) {
  if (amount <= 0) return true;

  const efficiency = getEnergyEfficiency(state, priority);
  const effectiveCost = amount / Math.max(0.1, efficiency);
  if (state.current >= effectiveCost) {
    state.current -= effectiveCost;
    return true;
  }

  state.brownoutLevel = clamp(state.brownoutLevel + priorityPenalty[priority] * 0.18, 0, 1);
  return priority === "lifeSupport" && state.current > 0;
}

export function getEngineEnergyLoad(stats: ShipStatsV2, inputPower: number) {
  const draw = stats.engineVectors.reduce((sum, engine) => sum + engine.energyDrawPerSecond, 0);
  return draw * clamp(inputPower, 0, 1);
}

function emptyPriorityLoads(): Record<EnergyPriority, number> {
  return {
    lifeSupport: 0,
    engines: 0,
    shields: 0,
    weapons: 0,
    utility: 0
  };
}
