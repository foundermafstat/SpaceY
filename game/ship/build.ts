import { cabinDefs } from "@/game/data/cabins";
import { compatibilityElementDefs, elementDefs } from "@/game/data/elements";
import { frameDefs } from "@/game/data/frames";
import { moduleDefs } from "@/game/data/modules";
import { panelDefs } from "@/game/data/panels";
import { moduleToElementRole } from "@/game/ship/domainCompat";
import type {
  GridCell,
  ElementDef,
  InstalledPanel,
  ModuleDef,
  PanelConnector,
  PanelConnectorSide,
  PanelDef,
  MountSlot,
  Rotation,
  ShipBuild
} from "@/game/types";

type ShapedDef = { shape: { cells: GridCell[] } };

const sideDeltas: Record<PanelConnectorSide, GridCell> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 }
};

const oppositeSide: Record<PanelConnectorSide, PanelConnectorSide> = {
  top: "bottom",
  right: "left",
  bottom: "top",
  left: "right"
};

const rotatedSide: Record<Rotation, Record<PanelConnectorSide, PanelConnectorSide>> = {
  0: { top: "top", right: "right", bottom: "bottom", left: "left" },
  90: { top: "right", right: "bottom", bottom: "left", left: "top" },
  180: { top: "bottom", right: "left", bottom: "top", left: "right" },
  270: { top: "left", right: "top", bottom: "right", left: "bottom" }
};

export function getFrame(frameId: string) {
  const frame = frameDefs.find((item) => item.id === frameId);
  if (!frame) throw new Error(`Unknown frame: ${frameId}`);
  return frame;
}

export function getCabin(cabinId: string) {
  const cabin = cabinDefs.find((item) => item.id === cabinId);
  if (!cabin) throw new Error(`Unknown cabin: ${cabinId}`);
  return cabin;
}

export function getModule(moduleId: string) {
  const module = moduleDefs.find((item) => item.id === moduleId);
  if (!module) throw new Error(`Unknown module: ${moduleId}`);
  return module;
}

export function getElement(elementId: string): ElementDef {
  const element =
    elementDefs.find((item) => item.id === elementId) ??
    compatibilityElementDefs.find((item) => item.id === elementId);
  if (!element) throw new Error(`Unknown element: ${elementId}`);
  return element;
}

export function getPanel(panelId: string) {
  const panel = panelDefs.find((item) => item.id === panelId);
  if (!panel) throw new Error(`Unknown panel: ${panelId}`);
  return panel;
}

export function rotateCell(cell: GridCell, rotation: Rotation) {
  if (rotation === 90) return { x: -cell.y, y: cell.x };
  if (rotation === 180) return { x: -cell.x, y: -cell.y };
  if (rotation === 270) return { x: cell.y, y: -cell.x };
  return cell;
}

export function getTransformedCells(item: ShapedDef, position: GridCell, rotation: Rotation) {
  return item.shape.cells.map((cell) => {
    const rotated = rotateCell(cell, rotation);
    return { x: position.x + rotated.x, y: position.y + rotated.y };
  });
}

export function getCellOccupant(build: ShipBuild, cell: GridCell) {
  for (const installed of build.modules) {
    const module = getModule(installed.moduleId);
    const cells = getTransformedCells(module, installed.position, installed.rotation);
    if (cells.some((candidate) => candidate.x === cell.x && candidate.y === cell.y)) {
      return installed;
    }
  }
  return null;
}

export function getPanelCellOccupant(build: ShipBuild, cell: GridCell) {
  for (const installed of build.panels ?? []) {
    const panel = getPanel(installed.panelId);
    const cells = getTransformedCells(panel, installed.position, installed.rotation);
    if (cells.some((candidate) => candidate.x === cell.x && candidate.y === cell.y)) {
      return installed;
    }
  }
  return null;
}

export function getBuildableCellKeys(build: ShipBuild) {
  const keys = new Set<string>();
  for (const installed of build.panels ?? []) {
    const panel = getPanel(installed.panelId);
    getTransformedCells(panel, installed.position, installed.rotation).forEach((cell) => {
      keys.add(cellKey(cell));
    });
  }
  return keys;
}

export function getInstalledPanelConnectors(installed: InstalledPanel) {
  const panel = getPanel(installed.panelId);
  return getTransformedPanelConnectors(panel, installed.position, installed.rotation);
}

export function getTransformedPanelConnectors(
  panel: PanelDef,
  position: GridCell,
  rotation: Rotation
): PanelConnector[] {
  return panel.connectors.map((connector) => {
    const cell = rotateCell(connector.cell, rotation);
    return {
      ...connector,
      cell: { x: position.x + cell.x, y: position.y + cell.y },
      side: rotatedSide[rotation][connector.side]
    };
  });
}

export function getTransformedPanelMountSlots(
  panel: PanelDef,
  position: GridCell,
  rotation: Rotation
): MountSlot[] {
  return panel.mountSlots.map((slot) => {
    const cell = rotateCell(slot.cell, rotation);
    return {
      ...slot,
      cell: { x: position.x + cell.x, y: position.y + cell.y }
    };
  });
}

export function canInstallModule(
  build: ShipBuild,
  moduleId: string,
  position: GridCell,
  rotation: Rotation
) {
  const frame = getFrame(build.frameId);
  const module = getModule(moduleId);
  const panelCells = getBuildableCellKeys(build);
  const targetCells = getTransformedCells(module, position, rotation);
  const elementRole = moduleToElementRole(module);

  if (build.modules.length >= frame.maxModules) {
    return { ok: false, reason: "Module limit reached" };
  }
  if (
    module.type === "weapon" &&
    build.modules.filter((installed) => getModule(installed.moduleId).type === "weapon").length >=
      frame.maxWeapons
  ) {
    return { ok: false, reason: "Weapon limit reached" };
  }
  if (
    module.type === "reactor" &&
    build.modules.filter((installed) => getModule(installed.moduleId).type === "reactor").length >=
      frame.maxReactors
  ) {
    return { ok: false, reason: "Reactor limit reached" };
  }

  for (const cell of targetCells) {
    if (!panelCells.has(cellKey(cell))) {
      return { ok: false, reason: "No panel support" };
    }
    const installedPanel = getPanelCellOccupant(build, cell);
    if (!installedPanel) {
      return { ok: false, reason: "No panel support" };
    }
    const panel = getPanel(installedPanel.panelId);
    if (!panel.allowedElementRoles.includes(elementRole)) {
      return { ok: false, reason: "Panel mount incompatible" };
    }
    if (module.type === "reactor" && !panel.networks.includes("power")) {
      return { ok: false, reason: "Power network required" };
    }
    if (getCellOccupant(build, cell)) {
      return { ok: false, reason: "Cell occupied" };
    }
  }

  return { ok: true, reason: null };
}

export function canInstallPanel(
  build: ShipBuild,
  panelId: string,
  position: GridCell,
  rotation: Rotation
) {
  const frame = getFrame(build.frameId);
  const panel = getPanel(panelId);
  const panels = build.panels ?? [];
  const targetCells = getTransformedCells(panel, position, rotation);
  const targetCellKeys = new Set(targetCells.map(cellKey));
  const activeCellKeys = new Set(frame.activeCells.map(cellKey));

  for (const cell of targetCells) {
    if (cell.x < 0 || cell.y < 0 || cell.x >= frame.size.width || cell.y >= frame.size.height) {
      return { ok: false, reason: "Outside construction grid" };
    }
    if (!activeCellKeys.has(cellKey(cell))) {
      return { ok: false, reason: "Outside frame shape" };
    }
    if (getPanelCellOccupant(build, cell)) {
      return { ok: false, reason: "Panel overlaps" };
    }
  }

  if (panels.length === 0) {
    const seedCell = {
      x: Math.floor(frame.size.width / 2),
      y: Math.floor(frame.size.height / 2)
    };
    return targetCellKeys.has(cellKey(seedCell))
      ? { ok: true, reason: null }
      : { ok: false, reason: "First panel must cover center" };
  }

  const existingCells = new Set<string>();
  const existingConnectorIds = new Map<string, string[]>();
  for (const installed of panels) {
    const installedPanel = getPanel(installed.panelId);
    getTransformedCells(installedPanel, installed.position, installed.rotation).forEach((cell) => {
      existingCells.add(cellKey(cell));
    });
    getInstalledPanelConnectors(installed).forEach((connector) => {
      addMapValue(existingConnectorIds, edgeKey(connector.cell, connector.side), connector.id);
    });
  }

  const newConnectorIds = new Map<string, string[]>();
  getTransformedPanelConnectors(panel, position, rotation).forEach((connector) => {
    addMapValue(newConnectorIds, edgeKey(connector.cell, connector.side), connector.id);
  });

  let matchedEdges = 0;
  for (const cell of targetCells) {
    for (const side of Object.keys(sideDeltas) as PanelConnectorSide[]) {
      const delta = sideDeltas[side];
      const neighbor = { x: cell.x + delta.x, y: cell.y + delta.y };
      if (!existingCells.has(cellKey(neighbor))) continue;

      const newIds = newConnectorIds.get(edgeKey(cell, side)) ?? [];
      const existingIds =
        existingConnectorIds.get(edgeKey(neighbor, oppositeSide[side])) ?? [];
      if (!newIds.some((id) => existingIds.includes(id))) {
        return { ok: false, reason: "Connector mismatch" };
      }
      matchedEdges += 1;
    }
  }

  return matchedEdges > 0
    ? { ok: true, reason: null }
    : { ok: false, reason: "Matching connector required" };
}

export function cellKey(cell: GridCell) {
  return `${cell.x}:${cell.y}`;
}

function edgeKey(cell: GridCell, side: PanelConnectorSide) {
  return `${cell.x}:${cell.y}:${side}`;
}

function addMapValue(map: Map<string, string[]>, key: string, value: string) {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}
