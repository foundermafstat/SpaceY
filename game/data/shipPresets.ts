import { installedModuleToElement } from "@/game/ship/domainCompat";
import type { InstalledModule, InstalledPanel, Rotation, ShipBuild } from "@/game/types";

const schemaVersion = 3;
const frameId = "scout_frame";

function panel(
  instanceId: string,
  panelId: string,
  x: number,
  y: number,
  rotation: Rotation = 0
): InstalledPanel {
  return { instanceId, panelId, position: { x, y }, rotation, state: "ideal" };
}

function module(
  instanceId: string,
  moduleId: string,
  x: number,
  y: number,
  rotation: Rotation = 0
): InstalledModule {
  return { instanceId, moduleId, position: { x, y }, rotation };
}

function build(def: Omit<ShipBuild, "schemaVersion" | "frameId" | "elements">): ShipBuild {
  return {
    ...def,
    schemaVersion,
    frameId,
    elements: def.modules.map(installedModuleToElement)
  };
}

export const shipBuildPresets: ShipBuild[] = [
  build({
    id: "preset-starter-scout",
    name: "Starter Scout",
    cabinId: "solo_pod_mk1",
    cabinPosition: { x: 2, y: 0 },
    cabinRotation: 0,
    panels: [
      panel("ps-spine", "spine_4", 2, 1),
      panel("ps-laser", "node_plate", 1, 2),
      panel("ps-shield", "node_plate", 3, 2),
      panel("ps-engine-l", "node_plate", 1, 5),
      panel("ps-engine-r", "node_plate", 3, 5)
    ],
    modules: [
      module("ms-reactor", "small_reactor", 2, 4),
      module("ms-engine-l", "ion_engine", 1, 5),
      module("ms-engine-r", "ion_engine", 3, 5),
      module("ms-autocannon", "autocannon", 2, 1),
      module("ms-laser", "laser_turret", 1, 2),
      module("ms-shield", "shield_generator", 3, 2),
      module("ms-hull", "hull_block", 2, 2)
    ]
  }),
  build({
    id: "preset-interceptor",
    name: "Needle Interceptor",
    cabinId: "cabin_2x1",
    cabinPosition: { x: 1, y: 3 },
    cabinRotation: 0,
    panels: [
      panel("pi-gun-l", "node_plate", 1, 2),
      panel("pi-gun-r", "node_plate", 2, 2),
      panel("pi-reactor", "node_plate", 0, 3),
      panel("pi-shield", "node_plate", 3, 3),
      panel("pi-engine-l", "node_plate", 1, 4),
      panel("pi-engine-r", "node_plate", 2, 4)
    ],
    modules: [
      module("mi-reactor", "small_reactor", 0, 3),
      module("mi-engine-l", "ion_engine", 1, 4),
      module("mi-engine-r", "ion_engine", 2, 4),
      module("mi-autocannon", "autocannon", 1, 2),
      module("mi-laser", "laser_turret", 2, 2),
      module("mi-shield", "shield_generator", 3, 3)
    ]
  }),
  build({
    id: "preset-gunship",
    name: "Spine Gunship",
    cabinId: "cabin_1x2",
    cabinPosition: { x: 2, y: 2 },
    cabinRotation: 0,
    panels: [
      panel("pg-nose", "node_plate", 2, 1),
      panel("pg-gun-l", "node_plate", 1, 2),
      panel("pg-gun-r", "node_plate", 3, 2),
      panel("pg-reactor", "node_plate", 1, 3),
      panel("pg-shield", "node_plate", 3, 3),
      panel("pg-engine", "spine_2", 2, 4)
    ],
    modules: [
      module("mg-reactor", "small_reactor", 1, 3),
      module("mg-engine", "plasma_thruster", 2, 4),
      module("mg-autocannon", "autocannon", 2, 1),
      module("mg-laser", "laser_turret", 1, 2),
      module("mg-missile", "missile_pod", 3, 2),
      module("mg-shield", "shield_generator", 3, 3)
    ]
  }),
  build({
    id: "preset-assault-frame",
    name: "Assault Frame",
    cabinId: "cabin_2x2",
    cabinPosition: { x: 1, y: 2 },
    cabinRotation: 0,
    panels: [
      panel("pa-gun-l", "node_plate", 1, 1),
      panel("pa-gun-r", "node_plate", 2, 1),
      panel("pa-reactor", "node_plate", 0, 3),
      panel("pa-shield", "node_plate", 3, 2),
      panel("pa-utility-l", "node_plate", 0, 4),
      panel("pa-utility-r", "node_plate", 3, 3),
      panel("pa-engine-l", "spine_2", 1, 4),
      panel("pa-engine-r", "spine_2", 2, 4)
    ],
    modules: [
      module("ma-reactor", "small_reactor", 0, 3),
      module("ma-engine-l", "ion_engine", 1, 4),
      module("ma-engine-r", "ion_engine", 2, 4),
      module("ma-autocannon", "autocannon", 1, 1),
      module("ma-laser", "laser_turret", 0, 4),
      module("ma-shield", "shield_generator", 3, 2)
    ]
  })
];

export function cloneShipBuild(build: ShipBuild): ShipBuild {
  return {
    ...build,
    cabinPosition: build.cabinPosition ? { ...build.cabinPosition } : undefined,
    panels: build.panels.map((item) => ({ ...item, position: { ...item.position } })),
    modules: build.modules.map((item) => ({ ...item, position: { ...item.position } })),
    elements: (build.elements ?? build.modules.map(installedModuleToElement)).map((item) => ({
      ...item,
      position: { ...item.position }
    }))
  };
}
