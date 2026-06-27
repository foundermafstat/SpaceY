import { defaultBuild } from "@/game/data/defaultBuild";
import type { InstalledModule, InstalledPanel, ShipBuild, ShipBuildSchemaVersion } from "@/game/types";

export const CURRENT_SHIP_BUILD_SCHEMA_VERSION: ShipBuildSchemaVersion = 3;

type PersistedShipBuild = Partial<Omit<ShipBuild, "schemaVersion">> & {
  schemaVersion?: number;
  elements?: InstalledModule[];
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
      ? build.elements
      : [];
  const elements = Array.isArray(build.elements) ? build.elements : modules;

  return {
    ...cloneDefaultBuild(),
    ...build,
    schemaVersion: CURRENT_SHIP_BUILD_SCHEMA_VERSION,
    frameId: typeof build.frameId === "string" ? build.frameId : defaultBuild.frameId,
    panels: build.panels,
    modules,
    elements
  };
}

function cloneDefaultBuild(): ShipBuild {
  return {
    ...defaultBuild,
    panels: defaultBuild.panels.map((panel) => ({ ...panel, position: { ...panel.position } })),
    modules: defaultBuild.modules.map((module) => ({ ...module, position: { ...module.position } })),
    elements: (defaultBuild.elements ?? defaultBuild.modules).map((module) => ({
      ...module,
      position: { ...module.position }
    }))
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
