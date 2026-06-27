import type {
  ElementRole,
  GridCell,
  MountSlot,
  NetworkType,
  PanelConnector,
  PanelConnectorSide,
  PanelDef,
  PanelRole,
  SocketType
} from "@/game/types";

const sides: PanelConnectorSide[] = ["top", "right", "bottom", "left"];
const deltas: Record<PanelConnectorSide, GridCell> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 }
};
const verticalIds = ["V1", "V2", "V3", "V4", "V5"];
const horizontalIds = ["H1", "H2", "H3", "H4", "H5"];
const allElementRoles: ElementRole[] = [
  "structure",
  "armor",
  "engine",
  "maneuver_thruster",
  "weapon",
  "reactor",
  "battery",
  "shield",
  "utility"
];
const hullElementRoles: ElementRole[] = ["structure", "armor", "utility"];
const poweredElementRoles: ElementRole[] = ["structure", "armor", "reactor", "battery", "shield", "utility"];
const panelSpriteIds: Record<string, string> = {
  node_plate: "single_1",
  rail_2: "bar_2h",
  rail_3: "bar_3h",
  rail_4: "bar_4h",
  rail_5: "bar_4h",
  spine_2: "bar_2v",
  spine_3: "bar_3h",
  spine_4: "bar_4h",
  block_2x2: "block_2x2",
  corner_l: "corner_l_2x2",
  corner_j: "corner_l_2x2",
  tee_nose: "tee_3x2",
  tee_tail: "tee_3x2",
  zig_z: "zig_3x3",
  zig_s: "zig_3x3",
  long_l: "long_l_3x3",
  long_j: "long_l_3x3",
  step_5: "bar_3h",
  cross_5: "cross_3x3",
  u_plate: "bar_3h",
  arrow_5: "tee_3x2",
  blade_left: "bar_2h",
  blade_right: "bar_2h",
  wide_bridge: "bar_4h",
  hull_chunk: "bar_3h"
};

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

function panelMetadata(id: string, shape: GridCell[]) {
  const isStarterMount = id === "node_plate";
  const isSpine = id.startsWith("spine");
  const role: PanelRole = isStarterMount ? "utility_mount" : isSpine ? "spine" : "hull";
  const networks: NetworkType[] = isStarterMount || isSpine
    ? ["structure", "power", "heat", "control"]
    : ["structure"];
  const socket: SocketType = isStarterMount ? "utility" : isSpine ? "power" : "hard";
  const allowedElementRoles = isStarterMount || isSpine
    ? allElementRoles
    : id === "cross_5"
      ? poweredElementRoles
      : hullElementRoles;

  return {
    role,
    networks,
    external: true,
    armorClass: role === "hull" ? 1 : 0,
    detachResistance: 1 + shape.length * 0.12,
    allowedElementRoles,
    mountSlots: shape.map((cell): MountSlot => ({
      id: `${id}-${cell.x}-${cell.y}`,
      cell,
      socket,
      networkTypes: networks
    }))
  };
}

function panel(
  id: string,
  name: string,
  points: number[][],
  spriteIndex: number,
  tags: string[] = []
): PanelDef {
  const shape = cells(points);
  const metadata = panelMetadata(id, shape);
  return {
    id,
    name,
    shape: { cells: shape },
    connectors: connectors(shape, spriteIndex),
    ...metadata,
    mass: Math.max(3, shape.length * 3),
    hp: shape.length * 24,
    spriteId: panelSpriteIds[id] ?? "single_1",
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
