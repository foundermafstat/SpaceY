import { getCabinIdForFrame } from "@/game/data/cabins";
import { installedModuleToElement } from "@/game/ship/domainCompat";
import type { ShipBuild } from "@/game/types";

export type EnemyKind = "drone" | "raider" | "bomber";

export type EnemyDef = {
  kind: EnemyKind;
  threat: number;
  build: ShipBuild;
};

export const enemyDefs: EnemyDef[] = [
  {
    kind: "drone",
    threat: 1,
    build: makeEnemyBuild("enemy-drone", "Drone", "enemy_drone_frame", [
      { instanceId: "d-core", moduleId: "core_mk1", position: { x: 1, y: 1 }, rotation: 0 },
      { instanceId: "d-reactor", moduleId: "small_reactor", position: { x: 0, y: 1 }, rotation: 0 },
      { instanceId: "d-engine", moduleId: "ion_engine", position: { x: 1, y: 2 }, rotation: 0 },
      { instanceId: "d-gun", moduleId: "autocannon", position: { x: 1, y: 0 }, rotation: 0 },
      { instanceId: "d-hull", moduleId: "hull_block", position: { x: 2, y: 1 }, rotation: 0 }
    ])
  },
  {
    kind: "raider",
    threat: 2,
    build: makeEnemyBuild("enemy-raider", "Raider", "enemy_raider_frame", [
      { instanceId: "r-core", moduleId: "core_mk1", position: { x: 1, y: 2 }, rotation: 0 },
      { instanceId: "r-reactor", moduleId: "small_reactor", position: { x: 2, y: 2 }, rotation: 0 },
      { instanceId: "r-engine-l", moduleId: "ion_engine", position: { x: 1, y: 4 }, rotation: 0 },
      { instanceId: "r-engine-r", moduleId: "ion_engine", position: { x: 2, y: 4 }, rotation: 0 },
      { instanceId: "r-gun", moduleId: "autocannon", position: { x: 1, y: 1 }, rotation: 0 },
      { instanceId: "r-laser", moduleId: "laser_turret", position: { x: 2, y: 1 }, rotation: 0 },
      { instanceId: "r-shield", moduleId: "shield_generator", position: { x: 1, y: 3 }, rotation: 0 }
    ])
  },
  {
    kind: "bomber",
    threat: 3,
    build: makeEnemyBuild("enemy-bomber", "Bomber", "enemy_bomber_frame", [
      { instanceId: "b-core", moduleId: "core_mk1", position: { x: 2, y: 2 }, rotation: 0 },
      { instanceId: "b-reactor", moduleId: "small_reactor", position: { x: 2, y: 3 }, rotation: 0 },
      { instanceId: "b-engine", moduleId: "plasma_thruster", position: { x: 1, y: 3 }, rotation: 0 },
      { instanceId: "b-missile-l", moduleId: "missile_pod", position: { x: 1, y: 1 }, rotation: 0 },
      { instanceId: "b-missile-r", moduleId: "missile_pod", position: { x: 3, y: 1 }, rotation: 0 },
      { instanceId: "b-armor", moduleId: "light_armor", position: { x: 2, y: 1 }, rotation: 0 },
      { instanceId: "b-hull-l", moduleId: "hull_block", position: { x: 1, y: 2 }, rotation: 0 },
      { instanceId: "b-hull-r", moduleId: "hull_block", position: { x: 3, y: 2 }, rotation: 0 }
    ])
  }
];

export function getEnemyDef(kind: EnemyKind) {
  const def = enemyDefs.find((enemy) => enemy.kind === kind);
  if (!def) throw new Error(`Unknown enemy kind: ${kind}`);
  return def;
}

function makeEnemyBuild(
  id: string,
  name: string,
  frameId: string,
  modules: ShipBuild["modules"]
): ShipBuild {
  return {
    schemaVersion: 3,
    id,
    name,
    frameId,
    cabinId: getCabinIdForFrame(frameId),
    panels: [],
    modules,
    elements: modules.map(installedModuleToElement)
  };
}
