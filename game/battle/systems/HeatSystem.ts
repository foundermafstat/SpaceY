import { clamp } from "@/game/battle/math";
import type { ShipStatsV2 } from "@/game/types";

export type HeatLoad = {
  partId: string;
  heatPerSecond: number;
};

export type HeatSystemState = {
  currentHeat: number;
  heatCapacity: number;
  generationByPart: Record<string, number>;
  dissipationByPanel: Record<string, number>;
  overheatThreshold: number;
  cooldownThreshold: number;
  overheatedParts: Set<string>;
};

export function createHeatSystem(stats: ShipStatsV2): HeatSystemState {
  const heatCapacity = Math.max(60, stats.mass * 0.72 + stats.heatDissipation * 4);

  return {
    currentHeat: Math.max(0, stats.heat) * 0.2,
    heatCapacity,
    generationByPart: {},
    dissipationByPanel: { passive: stats.heatDissipation },
    overheatThreshold: heatCapacity * 0.72,
    cooldownThreshold: heatCapacity * 0.45,
    overheatedParts: new Set()
  };
}

export function updateHeatSystem(state: HeatSystemState, stats: ShipStatsV2, dt: number, loads: HeatLoad[]) {
  loads.forEach((load) => {
    state.generationByPart[load.partId] = (state.generationByPart[load.partId] ?? 0) + load.heatPerSecond * dt;
  });

  const generated = loads.reduce((sum, load) => sum + Math.max(0, load.heatPerSecond), 0);
  const passiveGeneration = Math.max(0, stats.heatGeneration - stats.heatDissipation) * 0.18;
  const dissipation = Math.max(0, stats.heatDissipation);
  state.currentHeat = clamp(
    state.currentHeat + (generated + passiveGeneration - dissipation) * dt,
    0,
    state.heatCapacity
  );

  if (state.currentHeat <= state.cooldownThreshold) {
    state.overheatedParts.clear();
  }
}

export function addHeat(state: HeatSystemState, partId: string, amount: number) {
  if (amount <= 0) return;
  state.currentHeat = clamp(state.currentHeat + amount, 0, state.heatCapacity);
  state.generationByPart[partId] = (state.generationByPart[partId] ?? 0) + amount;
  if (state.currentHeat >= state.overheatThreshold) {
    state.overheatedParts.add(partId);
  }
}

export function isPartOverheated(state: HeatSystemState, partId: string) {
  return state.overheatedParts.has(partId);
}

export function getHeatPenalty(state: HeatSystemState) {
  if (state.currentHeat <= state.overheatThreshold) return 0;
  return clamp(
    (state.currentHeat - state.overheatThreshold) /
      Math.max(1, state.heatCapacity - state.overheatThreshold),
    0,
    1
  );
}

export function getEngineHeatLoad(stats: ShipStatsV2, inputPower: number) {
  const draw = stats.engineVectors.reduce((sum, engine) => sum + engine.heatPerSecond, 0);
  return draw * clamp(inputPower, 0, 1);
}
