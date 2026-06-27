"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { defaultBuild } from "@/game/data/defaultBuild";
import {
  canInstallModule,
  canInstallPanel,
  cellKey,
  getModule,
  getPanel,
  getTransformedCells
} from "@/game/ship/build";
import type { BuildMode, Rotation, ShipBuild } from "@/game/types";

type ShipState = {
  build: ShipBuild;
  buildMode: BuildMode;
  selectedModuleId: string;
  selectedPanelId: string;
  rotation: Rotation;
  scrap: number;
  setBuildMode: (mode: BuildMode) => void;
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
      selectModule: (moduleId) => set({ selectedModuleId: moduleId }),
      selectPanel: (panelId) => set({ selectedPanelId: panelId }),
      rotateSelected: () =>
        set((state) => ({
          rotation: (((state.rotation + 90) % 360) || 0) as Rotation
        })),
      installModule: (moduleId, position, rotation) => {
        const build = get().build;
        const result = canInstallModule(build, moduleId, position, rotation);
        if (!result.ok) return false;
        set({
          build: {
            ...build,
            modules: [
              ...build.modules,
              {
                instanceId: `${moduleId}-${Date.now()}-${Math.round(Math.random() * 1000)}`,
                moduleId,
                position,
                rotation
              }
            ]
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
        set({
          build: {
            ...build,
            modules: build.modules.map((module) =>
              module.instanceId === instanceId
                ? { ...module, position, rotation: nextRotation }
                : module
            )
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
        set({
          build: {
            ...build,
            modules: build.modules.filter((module) => module.instanceId !== instanceId)
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
      version: 2,
      migrate: (persisted) => {
        const state = persisted as Partial<ShipState>;
        if (!state.build || !Array.isArray((state.build as { panels?: unknown }).panels)) {
          return {
            ...state,
            build: defaultBuild,
            buildMode: "modules",
            selectedModuleId: "hull_block",
            selectedPanelId: "node_plate"
          };
        }
        return state;
      }
    }
  )
);
