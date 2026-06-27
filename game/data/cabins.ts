import { frameDefs } from "@/game/data/frames";
import { frameToCabinDef } from "@/game/ship/domainCompat";
import type { CabinDef, GridCell } from "@/game/types";

const scoutFrame = frameDefs.find((frame) => frame.id === "scout_frame");
if (!scoutFrame) throw new Error("Missing scout_frame");

const cells = (points: number[][]): GridCell[] => points.map(([x, y]) => ({ x, y }));

const cabinAssets = [
  {
    id: "solo_pod_mk1",
    name: "Solo Pod Mk I",
    spriteId: "cabin_1x1",
    assetGridSize: { width: 1, height: 1 },
    cells: cells([[0, 0]]),
    crew: 1,
    baseEnergy: 10
  },
  {
    id: "cabin_1x2",
    name: "Cabin 1x2",
    spriteId: "cabin_1x2",
    assetGridSize: { width: 1, height: 2 },
    cells: cells([[0, 0], [0, 1]]),
    crew: 2,
    baseEnergy: 12
  },
  {
    id: "cabin_2x1",
    name: "Cabin 2x1",
    spriteId: "cabin_2x1",
    assetGridSize: { width: 2, height: 1 },
    cells: cells([[0, 0], [1, 0]]),
    crew: 2,
    baseEnergy: 12
  },
  {
    id: "cabin_3x1",
    name: "Cabin 3x1",
    spriteId: "cabin_3x1",
    assetGridSize: { width: 3, height: 1 },
    cells: cells([[0, 0], [1, 0], [2, 0]]),
    crew: 3,
    baseEnergy: 14
  },
  {
    id: "cabin_2x2",
    name: "Cabin 2x2",
    spriteId: "cabin_2x2",
    assetGridSize: { width: 2, height: 2 },
    cells: cells([[0, 0], [1, 0], [0, 1], [1, 1]]),
    crew: 3,
    baseEnergy: 16
  },
  {
    id: "cabin_t_3x2",
    name: "Cabin T 3x2",
    spriteId: "cabin_t_3x2",
    assetGridSize: { width: 3, height: 2 },
    cells: cells([[1, 0], [0, 1], [1, 1], [2, 1]]),
    crew: 4,
    baseEnergy: 16
  },
  {
    id: "cabin_cross_3x3",
    name: "Cabin Cross 3x3",
    spriteId: "cabin_cross_3x3",
    assetGridSize: { width: 3, height: 3 },
    cells: cells([[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]]),
    crew: 5,
    baseEnergy: 18
  },
  {
    id: "cabin_u_3x2",
    name: "Cabin U 3x2",
    spriteId: "cabin_u_3x2",
    assetGridSize: { width: 3, height: 2 },
    cells: cells([[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]]),
    crew: 5,
    baseEnergy: 18
  },
  {
    id: "cabin_block_3x2",
    name: "Cabin Block 3x2",
    spriteId: "cabin_block_3x2",
    assetGridSize: { width: 3, height: 2 },
    cells: cells([[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]]),
    crew: 6,
    baseEnergy: 20
  },
  {
    id: "cabin_notch_3x2",
    name: "Cabin Notch 3x2",
    spriteId: "cabin_notch_3x2",
    assetGridSize: { width: 3, height: 2 },
    cells: cells([[0, 0], [1, 0], [2, 0], [0, 1], [1, 1]]),
    crew: 5,
    baseEnergy: 18
  },
  {
    id: "cabin_zig_3x2",
    name: "Cabin Zig 3x2",
    spriteId: "cabin_zig_3x2",
    assetGridSize: { width: 3, height: 2 },
    cells: cells([[1, 0], [2, 0], [0, 1], [1, 1]]),
    crew: 4,
    baseEnergy: 16
  }
];

const playerCabins: CabinDef[] = cabinAssets.map((asset) => ({
  id: asset.id,
  name: asset.name,
  gridSize: scoutFrame.size,
  activeCells: scoutFrame.activeCells,
  shape: { cells: asset.cells },
  assetGridSize: asset.assetGridSize,
  baseMass: scoutFrame.baseMass + asset.cells.length * 4,
  baseHp: scoutFrame.baseHp + asset.cells.length * 18,
  baseEnergy: asset.baseEnergy,
  crew: asset.crew,
  panelLimit: scoutFrame.maxModules,
  maxMass: scoutFrame.maxMass,
  role: "scout",
  spriteId: asset.spriteId,
  legacyFrameId: scoutFrame.id
}));

const enemyCabins = frameDefs
  .filter((frame) => frame.id !== "scout_frame")
  .map(frameToCabinDef);

export const cabinDefs: CabinDef[] = [
  ...playerCabins,
  ...enemyCabins
];

export function getCabinIdForFrame(frameId: string) {
  return cabinDefs.find((cabin) => cabin.legacyFrameId === frameId)?.id ?? "solo_pod_mk1";
}
