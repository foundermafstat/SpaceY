import type { ShipBuild } from "@/game/types";

export const defaultBuild: ShipBuild = {
  id: "starter-build",
  name: "Starter Scout",
  frameId: "scout_frame",
  modules: [
    { instanceId: "m-core", moduleId: "core_mk1", position: { x: 2, y: 3 }, rotation: 0 },
    { instanceId: "m-reactor", moduleId: "small_reactor", position: { x: 2, y: 4 }, rotation: 0 },
    { instanceId: "m-engine-l", moduleId: "ion_engine", position: { x: 1, y: 5 }, rotation: 0 },
    { instanceId: "m-engine-r", moduleId: "ion_engine", position: { x: 3, y: 5 }, rotation: 0 },
    { instanceId: "m-gun", moduleId: "autocannon", position: { x: 2, y: 1 }, rotation: 0 },
    { instanceId: "m-laser", moduleId: "laser_turret", position: { x: 1, y: 2 }, rotation: 0 },
    { instanceId: "m-shield", moduleId: "shield_generator", position: { x: 3, y: 2 }, rotation: 0 },
    { instanceId: "m-hull-a", moduleId: "hull_block", position: { x: 2, y: 2 }, rotation: 0 }
  ]
};
