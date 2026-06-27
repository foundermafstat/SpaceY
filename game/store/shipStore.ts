"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { defaultBuild } from "@/game/data/defaultBuild";
import { cloneShipBuild, shipBuildPresets } from "@/game/data/shipPresets";
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
import type { BuildMode, Rotation, ShipBuild } from "@/game/types";

const rotations: Rotation[] = [0, 90, 180, 270];
const buildModes: BuildMode[] = ["cabins", "panels", "modules"];

type ShipState = {
  build: ShipBuild;
  buildMode: BuildMode;
  selectedModuleId: string;
  selectedPanelId: string;
  rotation: Rotation;
  scrap: number;
  setBuildMode: (mode: BuildMode) => void;
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
  addReward: (scrap: number) => void;
};

function normalizePersistedState(persisted: unknown, current: ShipState): ShipState {
  const state = persisted as Partial<ShipState>;
  return {
    ...current,
    ...state,
    build: migrateShipBuild(state.build),
    buildMode: buildModes.includes(state.buildMode as BuildMode) ? state.buildMode as BuildMode : "modules",
    selectedModuleId: state.selectedModuleId ?? "hull_block",
    selectedPanelId: state.selectedPanelId ?? "node_plate",
    rotation: rotations.includes(state.rotation as Rotation) ? state.rotation as Rotation : 0
  };
}

export const useShipStore = create<ShipState>()(
  persist(
    (set, get) => ({
      build: defaultBuild,
      buildMode: "modules",
      selectedModuleId: "hull_block",
      selectedPanelId: "node_plate",
      rotation: 0,
      scrap: 0,
      setBuildMode: (mode) => set({ buildMode: mode }),
      loadPreset: (presetId) => {
        const preset = shipBuildPresets.find((item) => item.id === presetId);
        if (!preset) return;
        set({
          build: cloneShipBuild(preset),
          buildMode: "modules",
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
          buildMode: "modules",
          selectedModuleId: "hull_block",
          selectedPanelId: "node_plate",
          rotation: 0
        }),
      addReward: (scrap) => set((state) => ({ scrap: state.scrap + scrap }))
    }),
    {
      name: "starframe-arena-ship",
      version: CURRENT_SHIP_BUILD_SCHEMA_VERSION,
      migrate: (persisted) => {
        const state = persisted as Partial<ShipState>;
        return {
          ...state,
          build: migrateShipBuild(state.build),
          buildMode: buildModes.includes(state.buildMode as BuildMode) ? state.buildMode as BuildMode : "modules",
          selectedModuleId: state.selectedModuleId ?? "hull_block",
          selectedPanelId: state.selectedPanelId ?? "node_plate",
          rotation: rotations.includes(state.rotation as Rotation) ? state.rotation as Rotation : 0
        };
      },
      merge: (persisted, current) => normalizePersistedState(persisted, current)
    }
  )
);
