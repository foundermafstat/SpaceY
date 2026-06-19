import { frameDefs } from "@/game/data/frames";
import { moduleDefs } from "@/game/data/modules";
import type { GridCell, ModuleDef, Rotation, ShipBuild } from "@/game/types";

export function getFrame(frameId: string) {
  const frame = frameDefs.find((item) => item.id === frameId);
  if (!frame) throw new Error(`Unknown frame: ${frameId}`);
  return frame;
}

export function getModule(moduleId: string) {
  const module = moduleDefs.find((item) => item.id === moduleId);
  if (!module) throw new Error(`Unknown module: ${moduleId}`);
  return module;
}

export function getTransformedCells(module: ModuleDef, position: GridCell, rotation: Rotation) {
  return module.shape.cells.map((cell) => {
    const rotated =
      rotation === 90
        ? { x: -cell.y, y: cell.x }
        : rotation === 180
          ? { x: -cell.x, y: -cell.y }
          : rotation === 270
            ? { x: cell.y, y: -cell.x }
            : cell;
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

export function canInstallModule(
  build: ShipBuild,
  moduleId: string,
  position: GridCell,
  rotation: Rotation
) {
  const frame = getFrame(build.frameId);
  const module = getModule(moduleId);
  const frameCells = new Set(frame.activeCells.map((cell) => `${cell.x}:${cell.y}`));
  const targetCells = getTransformedCells(module, position, rotation);

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
    if (!frameCells.has(`${cell.x}:${cell.y}`)) {
      return { ok: false, reason: "Outside frame" };
    }
    if (getCellOccupant(build, cell)) {
      return { ok: false, reason: "Cell occupied" };
    }
  }

  return { ok: true, reason: null };
}
