"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { defaultBuild } from "@/game/data/defaultBuild";
import { canInstallModule } from "@/game/ship/build";
import type { Rotation, ShipBuild } from "@/game/types";

type ShipState = {
  build: ShipBuild;
  selectedModuleId: string;
  rotation: Rotation;
  scrap: number;
  selectModule: (moduleId: string) => void;
  rotateSelected: () => void;
  installModule: (moduleId: string, position: { x: number; y: number }, rotation: Rotation) => void;
  removeModule: (instanceId: string) => void;
  resetBuild: () => void;
  addReward: (scrap: number) => void;
};

export const useShipStore = create<ShipState>()(
  persist(
    (set, get) => ({
      build: defaultBuild,
      selectedModuleId: "hull_block",
      rotation: 0,
      scrap: 0,
      selectModule: (moduleId) => set({ selectedModuleId: moduleId }),
      rotateSelected: () =>
        set((state) => ({
          rotation: (((state.rotation + 90) % 360) || 0) as Rotation
        })),
      installModule: (moduleId, position, rotation) => {
        const build = get().build;
        const result = canInstallModule(build, moduleId, position, rotation);
        if (!result.ok) return;
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
      resetBuild: () => set({ build: defaultBuild, selectedModuleId: "hull_block", rotation: 0 }),
      addReward: (scrap) => set((state) => ({ scrap: state.scrap + scrap }))
    }),
    {
      name: "starframe-arena-ship"
    }
  )
);
