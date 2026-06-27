import { clamp, rotateTowards, type Vec } from "@/game/battle/math";
import type { EngineVector, GridCell } from "@/game/types";

export type PhysicsShipState = {
  pos: Vec;
  vel: Vec;
  rotation: number;
  angularVelocity?: number;
  acceleration: number;
  maxSpeed: number;
  turnRate: number;
  mass?: number;
  momentOfInertia?: number;
  centerOfMass?: GridCell;
  engineVectors?: EngineVector[];
  brakingPower?: number;
  driftFactor?: number;
};

export type RuntimePhysicsInput = {
  inputVector: Vec;
  powerEfficiency?: number;
  heatPenalty?: number;
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

export function applyShipPhysicsInput(ship: PhysicsShipState, input: RuntimePhysicsInput, dt: number) {
  const requestedPower = clamp(Math.hypot(input.inputVector.x, input.inputVector.y), 0, 1);
  const efficiency = clamp(input.powerEfficiency ?? 1, 0, 1) * (1 - clamp(input.heatPenalty ?? 0, 0, 0.85));
  const engineVectors = ship.engineVectors ?? [];
  const mainThrust = engineVectors.reduce((sum, engine) => sum + engine.thrust, 0);
  const lateralThrust = engineVectors.reduce((sum, engine) => sum + engine.lateralThrust, 0);
  const reverseThrust = engineVectors.reduce((sum, engine) => sum + engine.reverseThrust, 0);
  const netEngineTorque = engineVectors.reduce((sum, engine) => sum + engine.torqueArm * engine.thrust, 0);
  const mass = Math.max(1, ship.mass ?? mainThrust / Math.max(0.1, ship.acceleration));
  const inertia = Math.max(1, ship.momentOfInertia ?? mass * 4);

  if (requestedPower > 0.05) {
    const desiredDirection = Math.atan2(input.inputVector.y, input.inputVector.x);
    const turnAuthority = Math.max(
      ship.turnRate,
      ((lateralThrust + mainThrust * 0.18) / Math.max(40, mass)) * efficiency
    );
    ship.rotation = rotateTowards(ship.rotation, desiredDirection, turnAuthority * dt);

    const thrust = (mainThrust + lateralThrust * 0.45) * requestedPower * efficiency;
    const acceleration = Math.max(ship.acceleration, (thrust / mass) * 70);
    ship.vel.x += Math.cos(desiredDirection) * acceleration * dt;
    ship.vel.y += Math.sin(desiredDirection) * acceleration * dt;

    ship.angularVelocity =
      (ship.angularVelocity ?? 0) + (netEngineTorque / inertia) * requestedPower * efficiency * dt * 0.18;
  } else {
    applyBraking(ship, reverseThrust, mass, dt);
  }

  ship.angularVelocity = (ship.angularVelocity ?? 0) * Math.pow(0.82, dt * 60);
  ship.rotation += ship.angularVelocity * dt;

  const speed = Math.hypot(ship.vel.x, ship.vel.y);
  if (speed > ship.maxSpeed) {
    ship.vel.x = (ship.vel.x / speed) * ship.maxSpeed;
    ship.vel.y = (ship.vel.y / speed) * ship.maxSpeed;
  }

  const drag = 0.99 - clamp(ship.driftFactor ?? 0.5, 0, 1) * 0.006;
  ship.vel.x *= Math.pow(drag, dt * 60);
  ship.vel.y *= Math.pow(drag, dt * 60);
  ship.pos.x += ship.vel.x * dt;
  ship.pos.y += ship.vel.y * dt;
}

function applyBraking(ship: PhysicsShipState, reverseThrust: number, mass: number, dt: number) {
  const speed = Math.hypot(ship.vel.x, ship.vel.y);
  if (speed <= 0.001) return;
  const braking = ((ship.brakingPower ?? reverseThrust) / mass) * 38 * dt;
  const nextSpeed = Math.max(0, speed - braking);
  ship.vel.x = (ship.vel.x / speed) * nextSpeed;
  ship.vel.y = (ship.vel.y / speed) * nextSpeed;
}
