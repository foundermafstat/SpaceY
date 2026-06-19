import type { ModuleDef } from "@/game/types";

const sockets = {
  top: "hard",
  right: "hard",
  bottom: "hard",
  left: "hard"
} as const;

export const moduleDefs: ModuleDef[] = [
  {
    id: "core_mk1",
    name: "Core Mk I",
    type: "core",
    rarity: "common",
    shape: { cells: [{ x: 0, y: 0 }] },
    sockets,
    mass: 18,
    hp: 80,
    energyProduction: 10,
    spriteId: "core_mk1",
    tags: ["required"]
  },
  {
    id: "hull_block",
    name: "Hull Block",
    type: "hull",
    rarity: "common",
    shape: { cells: [{ x: 0, y: 0 }] },
    sockets,
    mass: 8,
    hp: 44,
    spriteId: "hull_block",
    tags: ["structure"]
  },
  {
    id: "hull_bridge_2x1",
    name: "Hull Bridge 2x1",
    type: "hull",
    rarity: "common",
    shape: {
      cells: [
        { x: 0, y: 0 },
        { x: 1, y: 0 }
      ]
    },
    sockets,
    mass: 15,
    hp: 78,
    spriteId: "hull_bridge_2x1",
    tags: ["structure"]
  },
  {
    id: "light_armor",
    name: "Light Armor",
    type: "armor",
    rarity: "common",
    shape: { cells: [{ x: 0, y: 0 }] },
    sockets,
    mass: 12,
    hp: 72,
    spriteId: "light_armor",
    tags: ["defense"]
  },
  {
    id: "ion_engine",
    name: "Ion Engine",
    type: "engine",
    rarity: "common",
    shape: { cells: [{ x: 0, y: 0 }] },
    sockets: { ...sockets, bottom: "engine" },
    mass: 11,
    hp: 34,
    energyConsumption: 5,
    heatGeneration: 4,
    thrust: 82,
    maneuverThrust: 18,
    spriteId: "ion_engine",
    tags: ["engine", "light"]
  },
  {
    id: "plasma_thruster",
    name: "Plasma Thruster",
    type: "engine",
    rarity: "rare",
    shape: {
      cells: [
        { x: 0, y: 0 },
        { x: 0, y: 1 }
      ]
    },
    sockets: { ...sockets, bottom: "engine" },
    mass: 18,
    hp: 48,
    energyConsumption: 9,
    heatGeneration: 8,
    thrust: 145,
    maneuverThrust: 22,
    spriteId: "plasma_thruster",
    tags: ["engine", "medium"]
  },
  {
    id: "side_thruster",
    name: "Side Thruster",
    type: "engine",
    rarity: "common",
    shape: { cells: [{ x: 0, y: 0 }] },
    sockets: { ...sockets, left: "engine", right: "engine" },
    mass: 9,
    hp: 30,
    energyConsumption: 4,
    heatGeneration: 3,
    thrust: 25,
    maneuverThrust: 58,
    spriteId: "side_thruster",
    tags: ["engine", "maneuver"]
  },
  {
    id: "small_reactor",
    name: "Small Reactor",
    type: "reactor",
    rarity: "common",
    shape: { cells: [{ x: 0, y: 0 }] },
    sockets: { top: "power", right: "power", bottom: "power", left: "power" },
    mass: 16,
    hp: 38,
    energyProduction: 44,
    heatGeneration: 8,
    spriteId: "small_reactor",
    tags: ["power"]
  },
  {
    id: "autocannon",
    name: "Autocannon",
    type: "weapon",
    rarity: "common",
    shape: { cells: [{ x: 0, y: 0 }] },
    sockets: { ...sockets, top: "weapon" },
    mass: 14,
    hp: 35,
    energyConsumption: 3,
    heatGeneration: 5,
    weapon: {
      damageType: "kinetic",
      damage: 8,
      fireRate: 3.2,
      cooldown: 0.31,
      range: 380,
      projectileSpeed: 540,
      turnSpeed: 5,
      targetingMode: "nearest",
      energyPerShot: 1,
      heatPerShot: 1
    },
    spriteId: "autocannon",
    tags: ["weapon"]
  },
  {
    id: "laser_turret",
    name: "Laser Turret",
    type: "weapon",
    rarity: "common",
    shape: { cells: [{ x: 0, y: 0 }] },
    sockets: { ...sockets, top: "weapon" },
    mass: 13,
    hp: 30,
    energyConsumption: 9,
    heatGeneration: 7,
    weapon: {
      damageType: "energy",
      damage: 7,
      fireRate: 2.4,
      cooldown: 0.42,
      range: 430,
      turnSpeed: 6,
      targetingMode: "nearest",
      energyPerShot: 2,
      heatPerShot: 2
    },
    spriteId: "laser_turret",
    tags: ["weapon", "energy"]
  },
  {
    id: "plasma_cannon",
    name: "Plasma Cannon",
    type: "weapon",
    rarity: "rare",
    shape: { cells: [{ x: 0, y: 0 }] },
    sockets: { ...sockets, top: "weapon" },
    mass: 22,
    hp: 42,
    energyConsumption: 12,
    heatGeneration: 12,
    weapon: {
      damageType: "plasma",
      damage: 28,
      fireRate: 0.75,
      cooldown: 1.33,
      range: 360,
      projectileSpeed: 330,
      turnSpeed: 3,
      targetingMode: "nearest",
      energyPerShot: 5,
      heatPerShot: 5,
      aoeRadius: 32
    },
    spriteId: "plasma_cannon",
    tags: ["weapon", "heavy"]
  },
  {
    id: "missile_pod",
    name: "Missile Pod",
    type: "weapon",
    rarity: "rare",
    shape: { cells: [{ x: 0, y: 0 }] },
    sockets: { ...sockets, top: "weapon" },
    mass: 18,
    hp: 36,
    energyConsumption: 7,
    heatGeneration: 6,
    weapon: {
      damageType: "explosive",
      damage: 24,
      fireRate: 0.9,
      cooldown: 1.1,
      range: 520,
      projectileSpeed: 260,
      turnSpeed: 2,
      targetingMode: "nearest",
      energyPerShot: 3,
      heatPerShot: 3,
      aoeRadius: 26
    },
    spriteId: "missile_pod",
    tags: ["weapon", "missile"]
  },
  {
    id: "shield_generator",
    name: "Shield Generator",
    type: "shield",
    rarity: "common",
    shape: { cells: [{ x: 0, y: 0 }] },
    sockets,
    mass: 14,
    hp: 30,
    energyConsumption: 10,
    shield: { capacity: 60, regen: 4, radius: 90 },
    spriteId: "shield_generator",
    tags: ["defense", "shield"]
  }
];
