import {
  canInstallModule,
  canInstallPanel,
  canPlaceCabin,
  cellKey,
  getBuildGrid,
  getCabinCellOccupant,
  getInstalledCabinPosition,
  getModule,
  getPanel,
  getTransformedCells
} from "@/game/ship/build";
import { calculateShipStats } from "@/game/ship/stats";
import type { GridCell, Rotation, ShipBuild } from "@/game/types";

export type BuildValidationSeverity = "blocker" | "warning" | "hint";

export type BuildValidationIssue = {
  severity: BuildValidationSeverity;
  code: string;
  message: string;
};

export type BuildValidationResult = {
  blockers: BuildValidationIssue[];
  warnings: BuildValidationIssue[];
  hints: BuildValidationIssue[];
};

export function validatePanelPlacement(
  build: ShipBuild,
  panelId: string,
  position: GridCell,
  rotation: Rotation
) {
  return canInstallPanel(build, panelId, position, rotation);
}

export function validateElementPlacement(
  build: ShipBuild,
  moduleId: string,
  position: GridCell,
  rotation: Rotation
) {
  return canInstallModule(build, moduleId, position, rotation);
}

export function validateWholeBuild(build: ShipBuild): BuildValidationResult {
  const blockers: BuildValidationIssue[] = [];
  const warnings: BuildValidationIssue[] = [];
  const hints: BuildValidationIssue[] = [];

  if (!build.cabinId) {
    blockers.push({
      severity: "blocker",
      code: "missing_cabin",
      message: "Cabin required"
    });
  }

  if (build.cabinId) {
    const cabinPlacement = canPlaceCabin(
      build,
      build.cabinId,
      getInstalledCabinPosition(build) ?? { x: 0, y: 0 },
      build.cabinRotation ?? 0
    );
    if (!cabinPlacement.ok) {
      blockers.push({
        severity: "blocker",
        code: "invalid_cabin",
        message: cabinPlacement.reason ?? "Invalid cabin placement"
      });
    }
  }

  const buildGrid = getBuildGrid(build);
  const activeCells = new Set(buildGrid.activeCells.map(cellKey));
  const occupiedPanelCells = new Set<string>();
  for (const installed of build.panels ?? []) {
    const panel = getPanel(installed.panelId);
    for (const cell of getTransformedCells(panel, installed.position, installed.rotation)) {
      if (!activeCells.has(cellKey(cell))) {
        blockers.push({
          severity: "blocker",
          code: "panel_outside_frame",
          message: "Panel outside frame shape"
        });
      }
      if (occupiedPanelCells.has(cellKey(cell))) {
        blockers.push({
          severity: "blocker",
          code: "panel_overlap",
          message: "Panel overlaps"
        });
      }
      if (getCabinCellOccupant(build, cell)) {
        blockers.push({
          severity: "blocker",
          code: "panel_cabin_overlap",
          message: "Panel overlaps cabin"
        });
      }
      occupiedPanelCells.add(cellKey(cell));
    }
  }

  const elementBuild: ShipBuild = { ...build, modules: [] };
  for (const installed of build.modules) {
    const module = getModule(installed.moduleId);
    if (build.cabinId && module.type === "core") continue;
    const placement = canInstallModule(
      elementBuild,
      installed.moduleId,
      installed.position,
      installed.rotation
    );
    if (!placement.ok) {
      blockers.push({
        severity: "blocker",
        code: "invalid_element",
        message: placement.reason ?? "Invalid element placement"
      });
    }
    elementBuild.modules = [...elementBuild.modules, installed];
  }

  const stats = calculateShipStats(build);
  stats.warnings.forEach((message) => {
    warnings.push({ severity: "warning", code: "stats_warning", message });
  });
  if (stats.shield <= 0) {
    warnings.push({ severity: "warning", code: "missing_shield", message: "No shield installed" });
  }
  if (stats.turnRate < 1.6) {
    hints.push({ severity: "hint", code: "low_maneuver", message: "Add maneuver thrust" });
  }

  return { blockers, warnings, hints };
}

export function getBuildBlockers(build: ShipBuild) {
  return validateWholeBuild(build).blockers;
}

export function getBuildWarnings(build: ShipBuild) {
  return validateWholeBuild(build).warnings;
}

export function getBuildHints(build: ShipBuild) {
  return validateWholeBuild(build).hints;
}
