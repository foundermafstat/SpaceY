import { getFrame, getModule, getTransformedCells } from "@/game/ship/build";
import type { ShipBuild } from "@/game/types";
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
