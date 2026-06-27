import type { ShipBuild } from "@/game/types";

export const defaultBuild: ShipBuild = {
  schemaVersion: 3,
  id: "starter-build",
  name: "Starter Scout",
  frameId: "scout_frame",
  cabinId: "solo_pod_mk1",
  cabinPosition: { x: 2, y: 0 },
  cabinRotation: 0,
  panels: [
    { instanceId: "p-spine", panelId: "spine_4", position: { x: 2, y: 1 }, rotation: 0, state: "ideal" },
    { instanceId: "p-left-gun", panelId: "node_plate", position: { x: 1, y: 2 }, rotation: 0, state: "ideal" },
    { instanceId: "p-right-shield", panelId: "node_plate", position: { x: 3, y: 2 }, rotation: 0, state: "ideal" },
    { instanceId: "p-left-engine", panelId: "node_plate", position: { x: 1, y: 5 }, rotation: 0, state: "ideal" },
    { instanceId: "p-right-engine", panelId: "node_plate", position: { x: 3, y: 5 }, rotation: 0, state: "ideal" }
  ],
  modules: [
    { instanceId: "m-core", moduleId: "core_mk1", position: { x: 2, y: 3 }, rotation: 0 },
    { instanceId: "m-reactor", moduleId: "small_reactor", position: { x: 2, y: 4 }, rotation: 0 },
    { instanceId: "m-engine-l", moduleId: "ion_engine", position: { x: 1, y: 5 }, rotation: 0 },
    { instanceId: "m-engine-r", moduleId: "ion_engine", position: { x: 3, y: 5 }, rotation: 0 },
    { instanceId: "m-gun", moduleId: "autocannon", position: { x: 2, y: 1 }, rotation: 0 },
    { instanceId: "m-laser", moduleId: "laser_turret", position: { x: 1, y: 2 }, rotation: 0 },
    { instanceId: "m-shield", moduleId: "shield_generator", position: { x: 3, y: 2 }, rotation: 0 },
    { instanceId: "m-hull-a", moduleId: "hull_block", position: { x: 2, y: 2 }, rotation: 0 }
  ],
  elements: [
    { instanceId: "m-core", elementId: "core_mk1", legacyModuleId: "core_mk1", position: { x: 2, y: 3 }, rotation: 0 },
    { instanceId: "m-reactor", elementId: "small_reactor", legacyModuleId: "small_reactor", position: { x: 2, y: 4 }, rotation: 0 },
    { instanceId: "m-engine-l", elementId: "ion_engine", legacyModuleId: "ion_engine", position: { x: 1, y: 5 }, rotation: 0 },
    { instanceId: "m-engine-r", elementId: "ion_engine", legacyModuleId: "ion_engine", position: { x: 3, y: 5 }, rotation: 0 },
    { instanceId: "m-gun", elementId: "autocannon", legacyModuleId: "autocannon", position: { x: 2, y: 1 }, rotation: 0 },
    { instanceId: "m-laser", elementId: "laser_turret", legacyModuleId: "laser_turret", position: { x: 1, y: 2 }, rotation: 0 },
    { instanceId: "m-shield", elementId: "shield_generator", legacyModuleId: "shield_generator", position: { x: 3, y: 2 }, rotation: 0 },
    { instanceId: "m-hull-a", elementId: "hull_block", legacyModuleId: "hull_block", position: { x: 2, y: 2 }, rotation: 0 }
  ]
};
