"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { defaultBuild } from "@/game/data/defaultBuild";
import { isMissionId } from "@/game/data/missions";
import { cloneShipBuild, shipBuildPresets } from "@/game/data/shipPresets";
import {
  applyMissionRewards,
  EMPTY_PLAYER_WALLET,
  normalizePlayerWallet,
  resolveMissionResultRewards
} from "@/game/mission/rewards";
import type { MissionResult } from "@/game/mission/runtime";
import {
  canInstallModule,
  canInstallPanel,
  canPlaceCabin,
  cellKey,
  getCabin,
  getDefaultCabinPosition,
  getModule,
  getPanel,
  getTransformedCells
} from "@/game/ship/build";
import { installedModuleToElement } from "@/game/ship/domainCompat";
import { CURRENT_SHIP_BUILD_SCHEMA_VERSION, migrateShipBuild } from "@/game/ship/migration";
import type {
  MissionDef,
  MissionId,
  MissionItemRewardGrant,
  PlayerWallet
} from "@/game/mission/types";
import type { BuildMode, Rotation, ShipBuild } from "@/game/types";

const rotations: Rotation[] = [0, 90, 180, 270];
const buildModes: BuildMode[] = ["structure", "modules"];

type ShipState = {
  build: ShipBuild;
  buildMode: BuildMode;
  selectedModuleId: string;
  selectedPanelId: string;
  rotation: Rotation;
  wallet: PlayerWallet;
  selectedMissionId: MissionId | null;
  lastMissionResult: MissionResult | null;
  completedAttemptIds: string[];
  pendingItemRewards: MissionItemRewardGrant[];
  setBuildMode: (mode: BuildMode) => void;
  selectMission: (id: MissionId) => void;
  clearMission: () => void;
  loadPreset: (presetId: string) => void;
  selectCabin: (cabinId: string) => void;
  moveCabin: (position: { x: number; y: number }, rotation?: Rotation) => boolean;
  selectModule: (moduleId: string) => void;
  selectPanel: (panelId: string) => void;
  rotateSelected: () => void;
  installModule: (moduleId: string, position: { x: number; y: number }, rotation: Rotation) => boolean;
  moveModule: (instanceId: string, position: { x: number; y: number }, rotation?: Rotation) => boolean;
  removeModule: (instanceId: string) => void;
  installPanel: (panelId: string, position: { x: number; y: number }, rotation: Rotation) => boolean;
  movePanel: (instanceId: string, position: { x: number; y: number }, rotation?: Rotation) => boolean;
  removePanel: (instanceId: string) => void;
  resetBuild: () => void;
  completeMission: (mission: MissionDef, result: MissionResult) => MissionResult;
};

type PersistedShipState = Omit<
  Partial<ShipState>,
  "completedAttemptIds" | "lastMissionResult" | "pendingItemRewards" | "wallet"
> & {
  completedAttemptIds?: unknown;
  scrap?: unknown;
  lastMissionResult?: unknown;
  pendingItemRewards?: unknown;
  wallet?: unknown;
};

function normalizePersistedState(persisted: unknown, current: ShipState): ShipState {
  const state = persisted && typeof persisted === "object"
    ? persisted as PersistedShipState
    : {};
  const { scrap: legacyScrap, ...persistedState } = state;
  return {
    ...current,
    ...persistedState,
    build: migrateShipBuild(state.build),
    buildMode: normalizeBuildMode(state.buildMode),
    selectedModuleId: state.selectedModuleId ?? "hull_block",
    selectedPanelId: state.selectedPanelId ?? "node_plate",
    rotation: rotations.includes(state.rotation as Rotation) ? state.rotation as Rotation : 0,
    selectedMissionId: normalizeMissionId(state.selectedMissionId),
    wallet: normalizePlayerWallet(state.wallet, legacyScrap),
    lastMissionResult: normalizeMissionResult(state.lastMissionResult),
    completedAttemptIds: normalizeStringIds(state.completedAttemptIds),
    pendingItemRewards: normalizePendingItemRewards(state.pendingItemRewards)
  };
}

function normalizeMissionId(value: unknown): MissionId | null {
  return isMissionId(value) ? value : null;
}

function normalizeBuildMode(value: unknown): BuildMode {
  if (value === "modules") return "modules";
  if (value === "structure" || value === "cabins" || value === "panels") return "structure";
  return "structure";
}

function normalizeMissionResult(value: unknown): MissionResult | null {
  if (!value || typeof value !== "object") return null;
  const result = value as Partial<MissionResult>;
  if (typeof result.attemptId !== "string" || result.attemptId.length === 0) return null;
  if (!isMissionId(result.missionId)) return null;
  if (result.outcome !== "victory" && result.outcome !== "defeat") return null;
  if (!Array.isArray(result.damagedPartIds) || !Array.isArray(result.detachedPartIds)) return null;
  if (!Array.isArray(result.rewards)) return null;
  return value as MissionResult;
}

function normalizeStringIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(
    (id): id is string => typeof id === "string" && id.length > 0 && id.length <= 128
  ))];
}

function normalizePendingItemRewards(value: unknown): MissionItemRewardGrant[] {
  if (!Array.isArray(value)) return [];
  return value.filter((reward): reward is MissionItemRewardGrant => {
    if (!reward || typeof reward !== "object") return false;
    const item = reward as Partial<MissionItemRewardGrant>;
    return item.kind === "item"
      && typeof item.id === "string"
      && typeof item.itemDefId === "string"
      && typeof item.label === "string"
      && (item.rarity === "common" || item.rarity === "uncommon" || item.rarity === "superRare");
  });
}

export const useShipStore = create<ShipState>()(
  persist(
    (set, get) => ({
      build: defaultBuild,
      buildMode: "structure",
      selectedModuleId: "hull_block",
      selectedPanelId: "node_plate",
      rotation: 0,
      wallet: { ...EMPTY_PLAYER_WALLET },
      selectedMissionId: null,
      lastMissionResult: null,
      completedAttemptIds: [],
      pendingItemRewards: [],
      setBuildMode: (mode) => set({ buildMode: mode }),
      selectMission: (id) => set({ selectedMissionId: id }),
      clearMission: () => set({ selectedMissionId: null }),
      loadPreset: (presetId) => {
        const preset = shipBuildPresets.find((item) => item.id === presetId);
        if (!preset) return;
        set({
          build: cloneShipBuild(preset),
          buildMode: "structure",
          selectedModuleId: "hull_block",
          selectedPanelId: "node_plate",
          rotation: 0
        });
      },
      selectCabin: (cabinId) => {
        const build = get().build;
        if (build.cabinId === cabinId) return;
        const cabin = getCabin(cabinId);
        const cabinPosition = getDefaultCabinPosition(cabin);
        set({
          build: {
            ...build,
            frameId: cabin.legacyFrameId ?? build.frameId,
            cabinId,
            cabinPosition,
            cabinRotation: 0,
            panels: [],
            modules: [],
            elements: []
          },
          selectedPanelId: "node_plate",
          selectedModuleId: "hull_block",
          rotation: 0
        });
      },
      moveCabin: (position, rotation) => {
        const build = get().build;
        if (!build.cabinId) return false;
        const nextRotation = rotation ?? build.cabinRotation ?? 0;
        const result = canPlaceCabin(build, build.cabinId, position, nextRotation);
        if (!result.ok) return false;
        set({
          build: {
            ...build,
            cabinPosition: position,
            cabinRotation: nextRotation
          }
        });
        return true;
      },
      selectModule: (moduleId) => set({ selectedModuleId: moduleId }),
      selectPanel: (panelId) => set({ selectedPanelId: panelId }),
      rotateSelected: () =>
        set((state) => {
          const currentIndex = rotations.indexOf(state.rotation);
          const nextIndex = currentIndex < 0 ? 1 : (currentIndex + 1) % rotations.length;
          return { rotation: rotations[nextIndex] };
        }),
      installModule: (moduleId, position, rotation) => {
        const build = get().build;
        const result = canInstallModule(build, moduleId, position, rotation);
        if (!result.ok) return false;
        const modules = [
          ...build.modules,
          {
            instanceId: `${moduleId}-${Date.now()}-${Math.round(Math.random() * 1000)}`,
            moduleId,
            position,
            rotation
          }
        ];
        set({
          build: {
            ...build,
            modules,
            elements: modules.map(installedModuleToElement)
          }
        });
        return true;
      },
      moveModule: (instanceId, position, rotation) => {
        const build = get().build;
        const moving = build.modules.find((module) => module.instanceId === instanceId);
        if (!moving) return false;
        const nextRotation = rotation ?? moving.rotation;
        const candidateBuild = {
          ...build,
          modules: build.modules.filter((module) => module.instanceId !== instanceId)
        };
        const result = canInstallModule(candidateBuild, moving.moduleId, position, nextRotation);
        if (!result.ok) return false;
        const modules = build.modules.map((module) =>
          module.instanceId === instanceId
            ? { ...module, position, rotation: nextRotation }
            : module
        );
        set({
          build: {
            ...build,
            modules,
            elements: modules.map(installedModuleToElement)
          }
        });
        return true;
      },
      installPanel: (panelId, position, rotation) => {
        const build = get().build;
        const result = canInstallPanel(build, panelId, position, rotation);
        if (!result.ok) return false;
        set({
          build: {
            ...build,
            panels: [
              ...(build.panels ?? []),
              {
                instanceId: `${panelId}-${Date.now()}-${Math.round(Math.random() * 1000)}`,
                panelId,
                position,
                rotation,
                state: "ideal"
              }
            ]
          }
        });
        return true;
      },
      movePanel: (instanceId, position, rotation) => {
        const build = get().build;
        const panels = build.panels ?? [];
        const moving = panels.find((panel) => panel.instanceId === instanceId);
        if (!moving) return false;
        const panel = getPanel(moving.panelId);
        const removedCells = new Set(
          getTransformedCells(panel, moving.position, moving.rotation).map(cellKey)
        );
        const hasModule = build.modules.some((installed) => {
          const module = getModule(installed.moduleId);
          return getTransformedCells(module, installed.position, installed.rotation).some((cell) =>
            removedCells.has(cellKey(cell))
          );
        });
        if (hasModule) return false;
        const nextRotation = rotation ?? moving.rotation;
        const candidateBuild = {
          ...build,
          panels: panels.filter((panel) => panel.instanceId !== instanceId)
        };
        const result = canInstallPanel(candidateBuild, moving.panelId, position, nextRotation);
        if (!result.ok) return false;
        set({
          build: {
            ...build,
            panels: panels.map((panel) =>
              panel.instanceId === instanceId
                ? { ...panel, position, rotation: nextRotation }
                : panel
            )
          }
        });
        return true;
      },
      removePanel: (instanceId) => {
        const build = get().build;
        const panelInstance = (build.panels ?? []).find((panel) => panel.instanceId === instanceId);
        if (!panelInstance) return;
        const panel = getPanel(panelInstance.panelId);
        const removedCells = new Set(
          getTransformedCells(panel, panelInstance.position, panelInstance.rotation).map(cellKey)
        );
        const hasModule = build.modules.some((installed) => {
          const module = getModule(installed.moduleId);
          return getTransformedCells(module, installed.position, installed.rotation).some((cell) =>
            removedCells.has(cellKey(cell))
          );
        });
        if (hasModule) return;
        set({
          build: {
            ...build,
            panels: (build.panels ?? []).filter((panel) => panel.instanceId !== instanceId)
          }
        });
      },
      removeModule: (instanceId) => {
        const build = get().build;
        const modules = build.modules.filter((module) => module.instanceId !== instanceId);
        set({
          build: {
            ...build,
            modules,
            elements: modules.map(installedModuleToElement)
          }
        });
      },
      resetBuild: () =>
        set({
          build: defaultBuild,
          buildMode: "structure",
          selectedModuleId: "hull_block",
          selectedPanelId: "node_plate",
          rotation: 0
        }),
      completeMission: (mission, result) => {
        const completedResult = resolveMissionResultRewards(mission, result);
        const state = get();
        if (state.completedAttemptIds.includes(completedResult.attemptId)) {
          const priorResult = state.lastMissionResult?.attemptId === completedResult.attemptId
            ? state.lastMissionResult
            : { ...completedResult, rewards: [] };
          set({ lastMissionResult: priorResult });
          return priorResult;
        }
        const itemRewards = completedResult.rewards.filter(
          (reward): reward is MissionItemRewardGrant => reward.kind === "item"
        );
        set({
          lastMissionResult: completedResult,
          wallet: applyMissionRewards(state.wallet, completedResult.rewards),
          completedAttemptIds: [...state.completedAttemptIds, completedResult.attemptId],
          pendingItemRewards: [...state.pendingItemRewards, ...itemRewards]
        });
        return completedResult;
      }
    }),
    {
      name: "starframe-arena-ship",
      skipHydration: true,
      version: CURRENT_SHIP_BUILD_SCHEMA_VERSION,
      migrate: (persisted) => {
        const state = persisted && typeof persisted === "object"
          ? persisted as PersistedShipState
          : {};
        const { scrap: legacyScrap, ...persistedState } = state;
        return {
          ...persistedState,
          build: migrateShipBuild(state.build),
          buildMode: normalizeBuildMode(state.buildMode),
          selectedModuleId: state.selectedModuleId ?? "hull_block",
          selectedPanelId: state.selectedPanelId ?? "node_plate",
          rotation: rotations.includes(state.rotation as Rotation) ? state.rotation as Rotation : 0,
          selectedMissionId: normalizeMissionId(state.selectedMissionId),
          wallet: normalizePlayerWallet(state.wallet, legacyScrap),
          lastMissionResult: normalizeMissionResult(state.lastMissionResult),
          completedAttemptIds: normalizeStringIds(state.completedAttemptIds),
          pendingItemRewards: normalizePendingItemRewards(state.pendingItemRewards)
        };
      },
      merge: (persisted, current) => normalizePersistedState(persisted, current)
    }
  )
);
