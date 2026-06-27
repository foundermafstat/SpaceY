import { moduleDefs } from "@/game/data/modules";
import { moduleToElementDef } from "@/game/ship/domainCompat";
import type { ElementDef } from "@/game/types";

const functionalElementIds = new Set([
  "ion_engine",
  "plasma_thruster",
  "side_thruster",
  "small_reactor",
  "autocannon",
  "laser_turret",
  "plasma_cannon",
  "missile_pod",
  "shield_generator"
]);

export const elementDefs: ElementDef[] = moduleDefs
  .filter((module) => functionalElementIds.has(module.id))
  .map(moduleToElementDef);

export const compatibilityElementDefs: ElementDef[] = moduleDefs.map(moduleToElementDef);
