import { getFrame, getModule, getTransformedCells } from "@/game/ship/build";
import type { ShipRuntime } from "@/game/ship/runtime";
import type { RuntimePartState, ShipBuild } from "@/game/types";
import type { Vec } from "@/game/battle/math";

type PositionTarget = {
  position: {
    set: (x: number, y: number) => void;
  };
};

type CollisionShip = {
  build: ShipBuild;
  pos: Vec;
  vel: Vec;
  rotation: number;
};

type EnemyCollisionShip = CollisionShip & {
  hp: number;
  body: PositionTarget;
};

export type CollisionTransform = {
  pos: Vec;
  rotation: number;
  cellSize?: number;
};

export type RuntimeCollisionShape = {
  partId: string;
  kind: RuntimePartState["kind"];
  localCells: Vec[];
  worldCells: Vec[];
  center: Vec;
  radius: number;
};

export type HitPartResult = {
  partId: string;
  kind: RuntimePartState["kind"];
  point: Vec;
  distance: number;
};

export function resolveShipCollisions(
  player: CollisionShip,
  playerBody: PositionTarget,
  enemies: EnemyCollisionShip[]
) {
  const activeEnemies = enemies.filter((enemy) => enemy.hp > 0);
  for (let pass = 0; pass < 2; pass += 1) {
    activeEnemies.forEach((enemy) => resolveModuleCollision(player, enemy));
    for (let i = 0; i < activeEnemies.length; i += 1) {
      for (let j = i + 1; j < activeEnemies.length; j += 1) {
        resolveModuleCollision(activeEnemies[i], activeEnemies[j]);
      }
    }
  }

  playerBody.position.set(player.pos.x, player.pos.y);
  activeEnemies.forEach((enemy) => enemy.body.position.set(enemy.pos.x, enemy.pos.y));
}

function resolveModuleCollision(a: CollisionShip, b: CollisionShip) {
  const aPoints = getCollisionPoints(a.build, a.pos, a.rotation);
  const bPoints = getCollisionPoints(b.build, b.pos, b.rotation);
  const minDist = 25;
  let pushX = 0;
  let pushY = 0;
  let hits = 0;

  for (const ap of aPoints) {
    for (const bp of bPoints) {
      const dx = bp.x - ap.x;
      const dy = bp.y - ap.y;
      const dist = Math.max(0.001, Math.hypot(dx, dy));
      if (dist >= minDist) continue;
      const push = (minDist - dist) / minDist;
      pushX += (dx / dist) * push;
      pushY += (dy / dist) * push;
      hits += 1;
    }
  }

  if (hits === 0) return;
  const nx = pushX / hits;
  const ny = pushY / hits;
  const len = Math.max(0.001, Math.hypot(nx, ny));
  const separation = Math.min(18, hits * 1.8);
  const sx = (nx / len) * separation;
  const sy = (ny / len) * separation;

  a.pos.x -= sx * 0.5;
  a.pos.y -= sy * 0.5;
  b.pos.x += sx * 0.5;
  b.pos.y += sy * 0.5;
  a.vel.x *= 0.62;
  a.vel.y *= 0.62;
  b.vel.x *= 0.62;
  b.vel.y *= 0.62;
}

export function getCollisionPoints(build: ShipBuild, pos: Vec, rotation: number) {
  const frame = getFrame(build.frameId);
  const centerX = (frame.size.width - 1) / 2;
  const centerY = (frame.size.height - 1) / 2;
  const cell = 26;
  const visualRotation = rotation + Math.PI / 2;
  const cos = Math.cos(visualRotation);
  const sin = Math.sin(visualRotation);
  const points: Vec[] = [];

  build.modules.forEach((installed) => {
    const module = getModule(installed.moduleId);
    getTransformedCells(module, installed.position, installed.rotation).forEach((shipCell) => {
      const lx = (shipCell.x - centerX) * cell;
      const ly = (shipCell.y - centerY) * cell;
      points.push({
        x: pos.x + lx * cos - ly * sin,
        y: pos.y + lx * sin + ly * cos
      });
    });
  });

  return points;
}

export function projectileHitsShip(
  projectile: { pos: Vec; radius: number },
  build: ShipBuild,
  pos: Vec,
  rotation: number
) {
  return getCollisionPoints(build, pos, rotation).some((point) => {
    return Math.hypot(point.x - projectile.pos.x, point.y - projectile.pos.y) < 18 + projectile.radius;
  });
}

export function getRuntimeCollisionShapes(
  shipRuntime: ShipRuntime,
  transform: CollisionTransform = { pos: { x: 0, y: 0 }, rotation: 0 }
): RuntimeCollisionShape[] {
  const cellSize = transform.cellSize ?? 26;
  const center = getRuntimeGridCenter(shipRuntime.parts);

  return shipRuntime.parts
    .filter((part) => !part.detached)
    .map((part) => {
      const localCells = part.gridCells.map((cell) => ({
        x: (cell.x - center.x) * cellSize,
        y: (cell.y - center.y) * cellSize
      }));
      const worldCells = localCells.map((cell) => transformLocalPoint(cell, transform));
      return {
        partId: part.id,
        kind: part.kind,
        localCells,
        worldCells,
        center: averagePoints(worldCells),
        radius: Math.max(18, cellSize * 0.68)
      };
    });
}

export function findHitPart(
  projectile: { pos: Vec; radius: number },
  shipRuntime: ShipRuntime,
  transform: CollisionTransform = { pos: { x: 0, y: 0 }, rotation: 0 }
): HitPartResult | null {
  let best: HitPartResult | null = null;
  for (const shape of getRuntimeCollisionShapes(shipRuntime, transform)) {
    for (const point of shape.worldCells) {
      const distance = Math.hypot(point.x - projectile.pos.x, point.y - projectile.pos.y);
      if (distance >= shape.radius + projectile.radius) continue;
      if (!best || distance < best.distance) {
        best = { partId: shape.partId, kind: shape.kind, point, distance };
      }
    }
  }
  return best;
}

export function findPartsInRadius(
  center: Vec,
  radius: number,
  shipRuntime: ShipRuntime,
  transform: CollisionTransform = { pos: { x: 0, y: 0 }, rotation: 0 }
) {
  return getRuntimeCollisionShapes(shipRuntime, transform).filter((shape) => {
    return shape.worldCells.some((point) => Math.hypot(point.x - center.x, point.y - center.y) <= radius + shape.radius);
  });
}

export function resolveShipOverlap(
  aRuntime: ShipRuntime,
  aTransform: CollisionTransform,
  bRuntime: ShipRuntime,
  bTransform: CollisionTransform
) {
  const aShapes = getRuntimeCollisionShapes(aRuntime, aTransform);
  const bShapes = getRuntimeCollisionShapes(bRuntime, bTransform);
  let pushX = 0;
  let pushY = 0;
  let hits = 0;

  for (const aShape of aShapes) {
    for (const bShape of bShapes) {
      const dx = bShape.center.x - aShape.center.x;
      const dy = bShape.center.y - aShape.center.y;
      const dist = Math.max(0.001, Math.hypot(dx, dy));
      const minDist = aShape.radius + bShape.radius;
      if (dist >= minDist) continue;
      const push = (minDist - dist) / minDist;
      pushX += (dx / dist) * push;
      pushY += (dy / dist) * push;
      hits += 1;
    }
  }

  if (hits === 0) return { a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, hits };
  const len = Math.max(0.001, Math.hypot(pushX, pushY));
  const separation = Math.min(24, hits * 2);
  const x = (pushX / len) * separation;
  const y = (pushY / len) * separation;
  return {
    a: { x: -x * 0.5, y: -y * 0.5 },
    b: { x: x * 0.5, y: y * 0.5 },
    hits
  };
}

function transformLocalPoint(point: Vec, transform: CollisionTransform): Vec {
  const visualRotation = transform.rotation + Math.PI / 2;
  const cos = Math.cos(visualRotation);
  const sin = Math.sin(visualRotation);
  return {
    x: transform.pos.x + point.x * cos - point.y * sin,
    y: transform.pos.y + point.x * sin + point.y * cos
  };
}

function getRuntimeGridCenter(parts: RuntimePartState[]): Vec {
  const cells = parts.flatMap((part) => part.gridCells);
  if (cells.length === 0) return { x: 0, y: 0 };
  const minX = Math.min(...cells.map((cell) => cell.x));
  const maxX = Math.max(...cells.map((cell) => cell.x));
  const minY = Math.min(...cells.map((cell) => cell.y));
  const maxY = Math.max(...cells.map((cell) => cell.y));
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

function averagePoints(points: Vec[]): Vec {
  if (points.length === 0) return { x: 0, y: 0 };
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length
  };
}
