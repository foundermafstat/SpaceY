import { clamp, rotateTowards, type Vec } from "@/game/battle/math";

export type PhysicsShipState = {
  pos: Vec;
  vel: Vec;
  rotation: number;
  acceleration: number;
  maxSpeed: number;
  turnRate: number;
};

export function applyShipPhysics(
  ship: PhysicsShipState,
  desiredDirection: number,
  inputPower: number,
  dt: number
) {
  const power = clamp(inputPower, 0, 1);
  if (power > 0.05) {
    ship.rotation = rotateTowards(ship.rotation, desiredDirection, ship.turnRate * dt);
    ship.vel.x += Math.cos(desiredDirection) * ship.acceleration * power * dt;
    ship.vel.y += Math.sin(desiredDirection) * ship.acceleration * power * dt;
  }

  const speed = Math.hypot(ship.vel.x, ship.vel.y);
  if (speed > ship.maxSpeed) {
    ship.vel.x = (ship.vel.x / speed) * ship.maxSpeed;
    ship.vel.y = (ship.vel.y / speed) * ship.maxSpeed;
  }

  ship.vel.x *= 0.99;
  ship.vel.y *= 0.99;
  ship.pos.x += ship.vel.x * dt;
  ship.pos.y += ship.vel.y * dt;
}
