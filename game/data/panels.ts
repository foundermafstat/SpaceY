import type { GridCell, PanelConnector, PanelConnectorSide, PanelDef } from "@/game/types";

const sides: PanelConnectorSide[] = ["top", "right", "bottom", "left"];
const deltas: Record<PanelConnectorSide, GridCell> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 }
};
const verticalIds = ["V1", "V2", "V3", "V4", "V5"];
const horizontalIds = ["H1", "H2", "H3", "H4", "H5"];

function cells(points: number[][]): GridCell[] {
  return points.map(([x, y]) => ({ x, y }));
}

function connectors(shape: GridCell[], seed: number): PanelConnector[] {
  const occupied = new Set(shape.map((cell) => `${cell.x}:${cell.y}`));
  return shape.flatMap((cell) =>
    sides.flatMap((side) => {
      const delta = deltas[side];
      if (occupied.has(`${cell.x + delta.x}:${cell.y + delta.y}`)) return [];
      const pool = side === "top" || side === "bottom" ? verticalIds : horizontalIds;
      return [
        {
          cell,
          side,
          id: pool[(cell.x + cell.y + seed) % pool.length]
        }
      ];
    })
  );
}

function panel(
  id: string,
  name: string,
  points: number[][],
  spriteIndex: number,
  tags: string[] = []
): PanelDef {
  const shape = cells(points);
  return {
    id,
    name,
    shape: { cells: shape },
    connectors: connectors(shape, spriteIndex),
    mass: Math.max(3, shape.length * 3),
    hp: shape.length * 24,
    spriteId: id,
    spriteIndex,
    tags
  };
}

export const panelDefs: PanelDef[] = [
  panel("node_plate", "Node Plate", [[0, 0]], 0, ["starter"]),
  panel("rail_2", "Rail 2", [[0, 0], [1, 0]], 1),
  panel("rail_3", "Rail 3", [[0, 0], [1, 0], [2, 0]], 2),
  panel("rail_4", "Rail 4", [[0, 0], [1, 0], [2, 0], [3, 0]], 3),
  panel("rail_5", "Rail 5", [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], 4),
  panel("spine_2", "Spine 2", [[0, 0], [0, 1]], 5),
  panel("spine_3", "Spine 3", [[0, 0], [0, 1], [0, 2]], 6),
  panel("spine_4", "Spine 4", [[0, 0], [0, 1], [0, 2], [0, 3]], 7, ["starter"]),
  panel("block_2x2", "Block 2x2", [[0, 0], [1, 0], [0, 1], [1, 1]], 8),
  panel("corner_l", "Corner L", [[0, 0], [0, 1], [1, 1]], 9),
  panel("corner_j", "Corner J", [[1, 0], [1, 1], [0, 1]], 10),
  panel("tee_nose", "Tee Nose", [[1, 0], [0, 1], [1, 1], [2, 1]], 11),
  panel("tee_tail", "Tee Tail", [[0, 0], [1, 0], [2, 0], [1, 1]], 12),
  panel("zig_z", "Zig Z", [[0, 0], [1, 0], [1, 1], [2, 1]], 13),
  panel("zig_s", "Zig S", [[1, 0], [2, 0], [0, 1], [1, 1]], 14),
  panel("long_l", "Long L", [[0, 0], [0, 1], [0, 2], [1, 2]], 15),
  panel("long_j", "Long J", [[1, 0], [1, 1], [1, 2], [0, 2]], 16),
  panel("step_5", "Step 5", [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]], 17),
  panel("cross_5", "Cross 5", [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]], 18),
  panel("u_plate", "U Plate", [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]], 19),
  panel("arrow_5", "Arrow 5", [[1, 0], [0, 1], [1, 1], [2, 1], [0, 2]], 20),
  panel("blade_left", "Blade Left", [[0, 0], [0, 1], [1, 1], [0, 2], [1, 2]], 21),
  panel("blade_right", "Blade Right", [[1, 0], [0, 1], [1, 1], [0, 2], [1, 2]], 22),
  panel("wide_bridge", "Wide Bridge", [[0, 0], [1, 0], [2, 0], [3, 0], [1, 1], [2, 1]], 23),
  panel("hull_chunk", "Hull Chunk", [[0, 0], [1, 0], [0, 1], [1, 1], [2, 1], [1, 2]], 24)
];
