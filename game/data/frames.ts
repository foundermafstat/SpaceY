import type { FrameDef, GridCell } from "@/game/types";

const activeCells: GridCell[] = [
  [2, 0],
  [1, 1],
  [2, 1],
  [3, 1],
  [1, 2],
  [2, 2],
  [3, 2],
  [0, 3],
  [1, 3],
  [2, 3],
  [3, 3],
  [4, 3],
  [0, 4],
  [1, 4],
  [2, 4],
  [3, 4],
  [4, 4],
  [1, 5],
  [2, 5],
  [3, 5],
  [2, 6]
].map(([x, y]) => ({ x, y }));

const cells = (points: number[][]): GridCell[] => points.map(([x, y]) => ({ x, y }));

export const frameDefs: FrameDef[] = [
  {
    id: "scout_frame",
    name: "Scout Frame",
    size: { width: 5, height: 7 },
    activeCells,
    baseMass: 48,
    baseHp: 160,
    maxModules: 18,
    maxWeapons: 4,
    maxReactors: 2,
    maxMass: 180,
    spriteId: "frame_scout"
  },
  {
    id: "enemy_drone_frame",
    name: "Drone Frame",
    size: { width: 3, height: 3 },
    activeCells: cells([
      [1, 0],
      [0, 1],
      [1, 1],
      [2, 1],
      [1, 2]
    ]),
    baseMass: 18,
    baseHp: 34,
    maxModules: 6,
    maxWeapons: 1,
    maxReactors: 1,
    maxMass: 90,
    spriteId: "frame_enemy_drone"
  },
  {
    id: "enemy_raider_frame",
    name: "Enemy Raider Frame",
    size: { width: 4, height: 5 },
    activeCells: cells([
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
      [0, 2],
      [1, 2],
      [2, 2],
      [3, 2],
      [1, 3],
      [2, 3],
      [1, 4],
      [2, 4]
    ]),
    baseMass: 32,
    baseHp: 70,
    maxModules: 10,
    maxWeapons: 3,
    maxReactors: 1,
    maxMass: 130,
    spriteId: "frame_enemy_raider"
  },
  {
    id: "enemy_bomber_frame",
    name: "Enemy Bomber Frame",
    size: { width: 5, height: 5 },
    activeCells: cells([
      [2, 0],
      [1, 1],
      [2, 1],
      [3, 1],
      [0, 2],
      [1, 2],
      [2, 2],
      [3, 2],
      [4, 2],
      [1, 3],
      [2, 3],
      [3, 3],
      [1, 4],
      [2, 4],
      [3, 4]
    ]),
    baseMass: 48,
    baseHp: 108,
    maxModules: 12,
    maxWeapons: 3,
    maxReactors: 1,
    maxMass: 170,
    spriteId: "frame_enemy_bomber"
  }
];
