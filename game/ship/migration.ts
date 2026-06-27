import { getCabinIdForFrame } from "@/game/data/cabins";
import { defaultBuild } from "@/game/data/defaultBuild";
import { installedModuleToElement } from "@/game/ship/domainCompat";
import type {
  GridCell,
  InstalledElement,
  InstalledModule,
  InstalledPanel,
  Rotation,
  ShipBuild,
  ShipBuildSchemaVersion
} from "@/game/types";

export const CURRENT_SHIP_BUILD_SCHEMA_VERSION: ShipBuildSchemaVersion = 3;

type PersistedShipBuild = Partial<Omit<ShipBuild, "schemaVersion">> & {
  schemaVersion?: number;
  elements?: Array<InstalledModule | InstalledElement>;
  modules?: InstalledModule[];
  panels?: InstalledPanel[];
};

export function migrateShipBuild(value: unknown): ShipBuild {
  if (!isObject(value)) return cloneDefaultBuild();

const build = value as PersistedShipBuild;
  if (!Array.isArray(build.panels)) return cloneDefaultBuild();

  const modules = Array.isArray(build.modules)
    ? build.modules
    : Array.isArray(build.elements)
      ? build.elements.flatMap(elementToLegacyModule)
      : [];
  const elements = Array.isArray(build.elements)
    ? build.elements.map(normalizeElement)
    : modules.map(installedModuleToElement);

  return {
    ...cloneDefaultBuild(),
    ...build,
    schemaVersion: CURRENT_SHIP_BUILD_SCHEMA_VERSION,
    frameId: typeof build.frameId === "string" ? build.frameId : defaultBuild.frameId,
    cabinId: typeof build.cabinId === "string"
      ? build.cabinId
      : getCabinIdForFrame(typeof build.frameId === "string" ? build.frameId : defaultBuild.frameId),
    cabinPosition: isGridCell(build.cabinPosition) ? build.cabinPosition : defaultBuild.cabinPosition,
    cabinRotation: isRotation(build.cabinRotation) ? build.cabinRotation : defaultBuild.cabinRotation,
    panels: build.panels,
    modules,
    elements
  };
}

function cloneDefaultBuild(): ShipBuild {
  return {
    ...defaultBuild,
    cabinPosition: defaultBuild.cabinPosition ? { ...defaultBuild.cabinPosition } : undefined,
    panels: defaultBuild.panels.map((panel) => ({ ...panel, position: { ...panel.position } })),
    modules: defaultBuild.modules.map((module) => ({ ...module, position: { ...module.position } })),
    elements: (defaultBuild.elements ?? defaultBuild.modules.map(installedModuleToElement)).map((element) => ({
      ...element,
      position: { ...element.position }
    }))
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isGridCell(value: unknown): value is GridCell {
  return isObject(value) && typeof value.x === "number" && typeof value.y === "number";
}

function isRotation(value: unknown): value is Rotation {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

function normalizeElement(element: InstalledModule | InstalledElement): InstalledElement {
  if ("elementId" in element) {
    return element;
  }
  return installedModuleToElement(element);
}

function elementToLegacyModule(element: InstalledModule | InstalledElement): InstalledModule[] {
  if ("moduleId" in element) return [element];
  if (!element.legacyModuleId) return [];
  return [
    {
      instanceId: element.instanceId,
      moduleId: element.legacyModuleId,
      position: element.position,
      rotation: element.rotation
    }
  ];
}
