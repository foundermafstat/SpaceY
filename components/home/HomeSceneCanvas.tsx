"use client";

import { useEffect, useRef } from "react";
import { Application, Assets, Container, Graphics, Rectangle, Sprite, Texture, TilingSprite } from "pixi.js";
import { getModule } from "@/game/ship/build";
import { calculateShipStats } from "@/game/ship/stats";
import {
  battleVfxAtlas,
  moduleAtlas,
  moduleStateAtlas,
  weaponAtlas,
  weaponStateAtlas,
  type BattleVfxSpriteKey,
  type ModuleSpriteKey,
  type WeaponSpriteKey
} from "@/game/assets/moduleSprites";
import type { ShipBuild, WeaponDef } from "@/game/types";

const LOGO_SRC = "/assets/spacey/spacey-debris-logo.png";
const SPACE_TILE_SCALE = 0.8;
const SPACE_TILE_SRCS = [
  "/assets/backgrounds/deep-space-tile-01.webp",
  "/assets/backgrounds/deep-space-tile-02.webp",
  "/assets/backgrounds/deep-space-tile-03.webp",
  "/assets/backgrounds/deep-space-tile-04.webp",
  "/assets/backgrounds/deep-space-tile-05.webp",
  "/assets/backgrounds/deep-space-tile-06.webp",
  "/assets/backgrounds/deep-space-tile-07.webp",
  "/assets/backgrounds/deep-space-tile-08.webp"
];
const PLANET_SRCS = [
  "/assets/backgrounds/planets/planet-ice.webp",
  "/assets/backgrounds/planets/planet-lava.webp",
  "/assets/backgrounds/planets/planet-purple.webp",
  "/assets/backgrounds/planets/planet-cyan.webp",
  "/assets/backgrounds/planets/planet-desert.webp",
  "/assets/backgrounds/planets/planet-toxic.webp",
  "/assets/backgrounds/planets/planet-metal.webp",
  "/assets/backgrounds/planets/planet-storm.webp"
];
const PIECE_SRCS = Array.from(
  { length: 32 },
  (_, index) => `/assets/spacey/pieces/spacey-debris-piece-${String(index + 1).padStart(2, "0")}.png`
);
const SPACE_BOUNDS = { width: 1500, height: 2400 };

type Vec = { x: number; y: number };
type AttackType = "kinetic" | "plasma" | "missile" | "laser";
type PlanetTexture = { texture: Texture };
type AlphaBounds = {
  sourceWidth: number;
  sourceHeight: number;
  width: number;
  height: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  offsetX: number;
  offsetY: number;
  alpha: Uint8ClampedArray;
};
type ShipPart = {
  kind: "module" | "weapon";
  key: ModuleSpriteKey | WeaponSpriteKey;
  turretKey?: WeaponSpriteKey;
  x: number;
  y: number;
};
type ShipLayout = { attackType: AttackType; parts: ShipPart[] };
type WeaponSpec = { base: WeaponSpriteKey; turret: WeaponSpriteKey; tint: number };
type WeaponMount = Vec & { attackType: AttackType; weapon: WeaponDef; cooldown: number; turret?: Sprite };

const BATTLE_WEAPON_LAWS: Record<AttackType, WeaponDef> = {
  kinetic: getModule("autocannon").weapon!,
  laser: getModule("laser_turret").weapon!,
  plasma: getModule("plasma_cannon").weapon!,
  missile: getModule("missile_pod").weapon!
};

type HomeTextures = {
  background: Texture;
  planetImages: PlanetTexture[];
  logo: Texture;
  logoBounds: AlphaBounds;
  pieces: Texture[];
  modules: Record<ModuleSpriteKey, Texture>;
  weapons: Record<WeaponSpriteKey, Texture>;
  battleVfx: Record<BattleVfxSpriteKey, Texture>;
};

type Ship = {
  body: Container;
  pos: Vec;
  vel: Vec;
  team: number;
  moveFocus: Vec;
  heading: number;
  flightRotation: number;
  orbitAngle: number;
  orbitRadius: number;
  attackType: AttackType;
  acceleration: number;
  maxSpeed: number;
  turnRate: number;
  moduleCount: number;
  engineColor: number;
  radius: number;
  weaponMounts: WeaponMount[];
  engineMounts: Vec[];
};

type Projectile = {
  pos: Vec;
  previous: Vec;
  vel: Vec;
  direction: Vec;
  acceleration: number;
  target: Vec;
  body: Sprite;
  trail: Graphics;
  life: number;
  radius: number;
  attackType: AttackType;
  color: number;
  smoke: boolean;
  targetShip?: Ship;
};

type Particle = {
  body: Graphics;
  pos: Vec;
  vel: Vec;
  life: number;
  maxLife: number;
  size: number;
  color: number;
  alpha: number;
  kind: "spark" | "smoke";
};

type TempSprite = {
  sprite: Sprite;
  life: number;
  maxLife: number;
  baseAlpha: number;
  baseScale: number;
  spin: number;
  grow: number;
  frames?: Texture[];
};

type DriftingPiece = {
  sprite: Sprite;
  vel: Vec;
  spin: number;
  life: number;
};

type RotatingPlanet = Container & {
  baseX: number;
  baseY: number;
  driftAmplitude: number;
  driftPhase: number;
  driftSpeed: number;
  baseRotation: number;
  spinSpeed: number;
};

export default function HomeSceneCanvas() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const currentHost = host;

    let destroyed = false;
    let initialized = false;
    const app = new Application();

    const resize = () => {
      if (!initialized) return;
      app.renderer.resize(host.clientWidth, host.clientHeight);
    };

    async function boot() {
      await app.init({
        width: currentHost.clientWidth,
        height: currentHost.clientHeight,
        background: "#03050c",
        backgroundAlpha: 0,
        antialias: true,
        resolution: Math.min(window.devicePixelRatio, 2)
      });
      if (destroyed) {
        app.destroy();
        return;
      }

      initialized = true;
      currentHost.appendChild(app.canvas);
      window.addEventListener("resize", resize);

      const textures = await loadHomeTextures();
      if (destroyed) return;

      const rng = createRng((Date.now() ^ Math.floor(performance.now() * 1000)) >>> 0);
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const layers = {
        background: new Container(),
        planets: new Container(),
        farStars: new Container(),
        closeStars: new Container(),
        debris: new Container(),
        engineVfx: new Container(),
        ships: new Container(),
        projectiles: new Container(),
        vfx: new Container(),
        logo: new Container(),
        screen: new Container()
      };
      app.stage.addChild(
        layers.background,
        layers.planets,
        layers.farStars,
        layers.closeStars,
        layers.debris,
        layers.engineVfx,
        layers.ships,
        layers.projectiles,
        layers.logo,
        layers.vfx,
        layers.screen
      );

      const spaceTile = new TilingSprite({
        texture: textures.background,
        width: app.screen.width,
        height: app.screen.height
      });
      spaceTile.alpha = 0.5;
      spaceTile.tileScale.set(SPACE_TILE_SCALE);
      layers.background.addChild(spaceTile);

      seedStars(layers.farStars, 135, 0.15, 1.15, rng);
      seedStars(layers.closeStars, 70, 0.28, 1.9, rng);
      seedDust(layers.debris, 44, rng);
      seedPlanet(layers.planets, textures.planetImages, app.screen.width, app.screen.height, rng);

      const logo = new Sprite(textures.logo);
      logo.anchor.set(0.5);
      layers.logo.addChild(logo);

      const logoHits = new Container();
      layers.logo.addChild(logoHits);

      const shipCount = reducedMotion ? 6 : 12;
      const ships = Array.from({ length: shipCount }, (_, index) =>
        makeShip(app.screen.width, app.screen.height, rng, textures, index % 3)
      );
      ships.forEach((ship) => layers.ships.addChild(ship.body));

      const projectiles: Projectile[] = [];
      const particles: Particle[] = [];
      const tempSprites: TempSprite[] = [];
      const pieces: DriftingPiece[] = [];

      let time = 0;
      let hitCount = 0;
      let screenShake = 0;
      let logoPulse = 0;

      app.ticker.add(() => {
        const dt = Math.min(app.ticker.deltaMS / 1000, 0.033);
        time += dt * (reducedMotion ? 0.55 : 1);

        const logoMetrics = layoutLogo(logo, app.screen.width, app.screen.height, time, textures.logoBounds);
        updateBackground(spaceTile, layers, app.screen.width, app.screen.height, time, screenShake);
        updateShips(ships, layers, logoMetrics, textures, projectiles, particles, tempSprites, rng, dt, time, onLogoHit);
        updateProjectiles(
          projectiles,
          particles,
          tempSprites,
          pieces,
          layers,
          textures,
          ships,
          logoMetrics,
          app.screen.width,
          app.screen.height,
          rng,
          dt,
          onLogoHit
        );
        updatePieces(pieces, dt);
        updateParticles(particles, dt);
        updateTempSprites(tempSprites, dt);

        logoPulse = Math.max(0, logoPulse - dt * 2.5);
        screenShake = Math.max(0, screenShake - dt * 1.8);
        layers.screen.position.set(
          screenShake > 0 ? (rng() - 0.5) * 8 * screenShake : 0,
          screenShake > 0 ? (rng() - 0.5) * 8 * screenShake : 0
        );
        layers.logo.position.copyFrom(layers.screen.position);
        logo.tint = logoPulse > 0 ? 0xffe1c4 : 0xffffff;
      });

      function onLogoHit(pos: Vec, attackType: AttackType) {
        hitCount += 1;
        screenShake = Math.max(screenShake, attackType === "missile" ? 0.62 : 0.34);
        logoPulse = 1;
        spawnImpact(particles, tempSprites, layers.vfx, textures.battleVfx, pos, attackType);
        spawnExplosion(
          tempSprites,
          particles,
          layers.vfx,
          textures.battleVfx,
          pos,
          attackType,
          attackType === "missile" ? 46 : attackType === "plasma" ? 38 : attackType === "laser" ? 26 : 32
        );
        drawLogoCrack(logoHits, logo, textures.logoBounds, pos, rng);
        const pieceCount = attackType === "missile" ? 3 : 2;
        for (let i = 0; i < pieceCount; i += 1) {
          if (pieces.length > 44) removeOldPiece(pieces);
          spawnLogoPiece(pieces, layers.vfx, textures.pieces, pos, logo, rng);
        }
      }
    }

    boot();

    return () => {
      destroyed = true;
      window.removeEventListener("resize", resize);
      if (initialized) app.destroy();
    };
  }, []);

  return <div ref={hostRef} className="home-scene-canvas" />;
}

async function loadHomeTextures(): Promise<HomeTextures> {
  const backgroundSrc = SPACE_TILE_SRCS[Math.floor(Math.random() * SPACE_TILE_SRCS.length)];
  const [[background, logo, battleVfxBase, moduleBase, weaponBase, ...rest], logoBounds] = await Promise.all([
    Promise.all([
      Assets.load<Texture>(backgroundSrc),
      Assets.load<Texture>(LOGO_SRC),
      Assets.load<Texture>(battleVfxAtlas.src),
      Assets.load<Texture>(moduleStateAtlas.src),
      Assets.load<Texture>(weaponStateAtlas.src),
      ...PLANET_SRCS.map((src) => Assets.load<Texture>(src)),
      ...PIECE_SRCS.map((src) => Assets.load<Texture>(src))
    ]),
    measureImageAlphaBounds(LOGO_SRC)
  ]);
  const planetImages = rest.slice(0, PLANET_SRCS.length).map((texture) => ({ texture }));
  const pieces = rest.slice(PLANET_SRCS.length);

  return {
    background,
    planetImages,
    logo,
    logoBounds,
    pieces,
    modules: sliceAtlas(moduleBase, moduleAtlas),
    weapons: sliceAtlas(weaponBase, weaponAtlas),
    battleVfx: sliceBattleVfx(battleVfxBase)
  };
}

function layoutLogo(logo: Sprite, width: number, height: number, time: number, bounds: AlphaBounds) {
  const targetWidth = Math.min(width * 0.94, 420);
  const scale = targetWidth / logo.texture.width;
  const targetY = Math.max(110, height * 0.22);
  const startY = -logo.texture.height * scale * 0.7;
  const progress = easeOutBack(clamp((time - 0.15) / 1.05, 0, 1));
  logo.scale.set(scale);
  logo.position.set(width / 2, startY + (targetY - startY) * progress);
  logo.rotation = Math.sin(time * 1.2) * 0.006;
  const cos = Math.cos(logo.rotation);
  const sin = Math.sin(logo.rotation);
  return {
    x: logo.position.x,
    y: logo.position.y,
    scale,
    rotation: logo.rotation,
    mask: bounds,
    center: {
      x: logo.position.x + (bounds.offsetX * cos - bounds.offsetY * sin) * scale,
      y: logo.position.y + (bounds.offsetX * sin + bounds.offsetY * cos) * scale
    },
    width: bounds.width * scale,
    height: bounds.height * scale,
    active: progress > 0.75
  };
}

function measureImageAlphaBounds(src: string): Promise<AlphaBounds> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        resolve(fullAlphaBounds(width, height));
        return;
      }

      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, width, height).data;
      const alpha = new Uint8ClampedArray(width * height);
      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;

      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const alphaValue = pixels[(y * width + x) * 4 + 3];
          alpha[y * width + x] = alphaValue;
          if (alphaValue <= 10) continue;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }

      if (maxX < minX || maxY < minY) {
        resolve(fullAlphaBounds(width, height));
        return;
      }

      const alphaWidth = maxX - minX + 1;
      const alphaHeight = maxY - minY + 1;
      resolve({
        sourceWidth: width,
        sourceHeight: height,
        width: alphaWidth,
        height: alphaHeight,
        minX,
        minY,
        maxX,
        maxY,
        offsetX: minX + alphaWidth / 2 - width / 2,
        offsetY: minY + alphaHeight / 2 - height / 2,
        alpha
      });
    };
    image.onerror = () => resolve(fullAlphaBounds(1, 1));
    image.src = src;
  });
}

function fullAlphaBounds(width: number, height: number): AlphaBounds {
  return {
    sourceWidth: width,
    sourceHeight: height,
    width,
    height,
    minX: 0,
    minY: 0,
    maxX: width - 1,
    maxY: height - 1,
    offsetX: 0,
    offsetY: 0,
    alpha: new Uint8ClampedArray(width * height).fill(255)
  };
}

function updateBackground(
  spaceTile: TilingSprite,
  layers: Record<string, Container>,
  width: number,
  height: number,
  time: number,
  shake: number
) {
  spaceTile.width = width;
  spaceTile.height = height;
  spaceTile.tilePosition.set(time * -8, time * 5);
  layers.planets.position.set(Math.sin(time * 0.018) * 28, Math.cos(time * 0.014) * 18);
  layers.planets.children.forEach((child) => {
    const planet = child as RotatingPlanet;
    if (typeof planet.driftSpeed === "number") {
      planet.position.set(
        planet.baseX + Math.sin(time * planet.driftSpeed + planet.driftPhase) * planet.driftAmplitude,
        planet.baseY
      );
    }
    if (typeof planet.spinSpeed === "number") {
      planet.rotation = planet.baseRotation + time * planet.spinSpeed;
    }
  });
  layers.farStars.position.set(Math.sin(time * 0.11) * 12, Math.cos(time * 0.08) * 10);
  layers.closeStars.position.set(Math.sin(time * 0.18) * 23, Math.cos(time * 0.13) * 18);
  layers.debris.position.set(Math.sin(time * 0.22) * 28, time * 7 + shake * 2);
}

function angleDelta(from: number, to: number) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function rotateTowards(current: number, target: number, maxDelta: number) {
  const delta = angleDelta(current, target);
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}

function applyHomeShipPhysics(ship: Ship, desiredDirection: number, inputPower: number, dt: number) {
  const power = Math.min(1, Math.max(0, inputPower));
  if (power > 0.05) {
    ship.flightRotation = rotateTowards(ship.flightRotation, desiredDirection, ship.turnRate * dt);
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

function updateShips(
  ships: Ship[],
  layers: Record<string, Container>,
  logo: ReturnType<typeof layoutLogo>,
  textures: HomeTextures,
  projectiles: Projectile[],
  particles: Particle[],
  tempSprites: TempSprite[],
  rng: () => number,
  dt: number,
  time: number,
  onLogoHit: (pos: Vec, attackType: AttackType) => void
) {
  ships.forEach((ship, index) => {
    ship.orbitAngle += dt * (0.18 + index * 0.012);
    const enemy = findNearestEnemy(ship, ships);
    const focus = enemy && (index + Math.floor(time * 0.55)) % 3 !== 0 ? enemy.pos : logo.center;
    const focusEase = Math.min(1, dt * 0.72);
    ship.moveFocus.x += (focus.x - ship.moveFocus.x) * focusEase;
    ship.moveFocus.y += (focus.y - ship.moveFocus.y) * focusEase;
    const orbitDistance = Math.max(ship.orbitRadius * (enemy ? 0.78 : 1), logo.width * 0.58 + 74);
    const orbitX = Math.cos(ship.orbitAngle) * orbitDistance;
    const orbitY = Math.sin(ship.orbitAngle * 0.84) * orbitDistance * 0.56;
    const target = {
      x: ship.moveFocus.x + orbitX,
      y: ship.moveFocus.y + orbitY + 16
    };
    const dx = target.x - ship.pos.x;
    const dy = target.y - ship.pos.y;
    const dist = Math.max(1, Math.hypot(dx, dy));
    const desiredAngle = Math.atan2(dy, dx);
    const power = clamp(dist / Math.max(180, ship.orbitRadius * 0.45), 0.32, 0.88);
    applyHomeShipPhysics(ship, desiredAngle, power, dt);
  });

  resolveSceneCollisions(ships, logo);

  ships.forEach((ship) => {
    const enemy = findNearestEnemy(ship, ships);
    ship.heading = ship.flightRotation + Math.PI / 2;
    ship.body.position.set(ship.pos.x, ship.pos.y);
    ship.body.rotation = ship.heading;
    spawnEngineGlows(
      particles,
      layers.engineVfx,
      ship.pos,
      ship.heading,
      ship.flightRotation,
      ship.engineMounts,
      clamp(Math.hypot(ship.vel.x, ship.vel.y) / ship.maxSpeed, 0.24, 1),
      ship.body.scale.x,
      rng
    );

    const logoDist = distance(ship.pos, logo.center);
    const enemyDist = enemy ? distance(ship.pos, enemy.pos) : Number.POSITIVE_INFINITY;
    const logoReach = Math.max(logo.width, logo.height) * 0.46;
    ship.weaponMounts.forEach((weaponMount) => {
      weaponMount.cooldown -= dt;

      const enemyInRange = Boolean(enemy && enemyDist <= weaponMount.weapon.range);
      const logoInRange = logo.active && logoDist <= weaponMount.weapon.range + logoReach;
      if (!enemyInRange && !logoInRange) return;

      const targetShip = enemy && enemyInRange && (rng() < 0.64 || !logoInRange) ? enemy : undefined;
      const target = targetShip
        ? {
          x: targetShip.pos.x + (rng() - 0.5) * targetShip.radius * 0.55,
          y: targetShip.pos.y + (rng() - 0.5) * targetShip.radius * 0.55
        }
        : randomLogoBoundaryPoint(logo, rng);

      const turretAligned = rotateTurretToTarget(weaponMount, ship.heading, ship.pos, target, dt);
      if (!turretAligned || weaponMount.cooldown > 0 || projectiles.length >= 70) return;

      weaponMount.cooldown = Math.max(0.12, 1 / weaponMount.weapon.fireRate);
      fireAtLogo(ship, weaponMount, target, targetShip, textures, projectiles, particles, tempSprites, layers, time, onLogoHit);
    });
  });
}

function resolveSceneCollisions(ships: Ship[], logo: ReturnType<typeof layoutLogo>) {
  const logoRadiusX = logo.width * 0.46;
  const logoRadiusY = logo.height * 0.36;

  ships.forEach((ship) => {
    const dx = ship.pos.x - logo.center.x;
    const dy = ship.pos.y - logo.center.y;
    const angle = Math.atan2(dy, dx);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const logoEdge =
      1 / Math.sqrt((cos * cos) / (logoRadiusX * logoRadiusX) + (sin * sin) / (logoRadiusY * logoRadiusY));
    const minDistance = logoEdge + ship.radius + 46;
    const currentDistance = Math.max(0.001, Math.hypot(dx, dy));

    if (currentDistance < minDistance) {
      const push = minDistance - currentDistance;
      const nx = dx / currentDistance;
      const ny = dy / currentDistance;
      ship.pos.x += nx * push;
      ship.pos.y += ny * push;
      const inwardVelocity = ship.vel.x * nx + ship.vel.y * ny;
      if (inwardVelocity < 0) {
        ship.vel.x -= nx * inwardVelocity;
        ship.vel.y -= ny * inwardVelocity;
      }
    }
  });

  for (let i = 0; i < ships.length; i += 1) {
    for (let j = i + 1; j < ships.length; j += 1) {
      const a = ships[i];
      const b = ships[j];
      const dx = b.pos.x - a.pos.x;
      const dy = b.pos.y - a.pos.y;
      const currentDistance = Math.max(0.001, Math.hypot(dx, dy));
      const minDistance = a.radius + b.radius + 14;
      if (currentDistance >= minDistance) continue;

      const push = (minDistance - currentDistance) * 0.5;
      const nx = dx / currentDistance;
      const ny = dy / currentDistance;
      a.pos.x -= nx * push;
      a.pos.y -= ny * push;
      b.pos.x += nx * push;
      b.pos.y += ny * push;
      const relativeNormalVelocity = (b.vel.x - a.vel.x) * nx + (b.vel.y - a.vel.y) * ny;
      if (relativeNormalVelocity < 0) {
        const impulse = -relativeNormalVelocity * 0.46;
        a.vel.x -= nx * impulse;
        a.vel.y -= ny * impulse;
        b.vel.x += nx * impulse;
        b.vel.y += ny * impulse;
      }
    }
  }
}

function findNearestEnemy(ship: Ship, ships: Ship[]) {
  let nearest: Ship | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  ships.forEach((candidate) => {
    if (candidate === ship || candidate.team === ship.team) return;
    const candidateDistance = distance(ship.pos, candidate.pos);
    if (candidateDistance >= nearestDistance) return;
    nearest = candidate;
    nearestDistance = candidateDistance;
  });
  return nearest;
}

function hitShip(
  target: Ship,
  from: Vec,
  pos: Vec,
  attackType: AttackType,
  particles: Particle[],
  tempSprites: TempSprite[],
  layers: Record<string, Container>,
  textures: HomeTextures,
  force = 1
) {
  spawnImpact(particles, tempSprites, layers.vfx, textures.battleVfx, pos, attackType);
  spawnExplosion(
    tempSprites,
    particles,
    layers.vfx,
    textures.battleVfx,
    pos,
    attackType,
    attackType === "missile" ? 34 : attackType === "plasma" ? 26 : attackType === "laser" ? 16 : 22
  );
  const dx = target.pos.x - from.x;
  const dy = target.pos.y - from.y;
  const dist = Math.max(1, Math.hypot(dx, dy));
  target.vel.x += (dx / dist) * 86 * force;
  target.vel.y += (dy / dist) * 86 * force;
  if (attackType === "missile" || attackType === "plasma") {
    spawnSmoke(particles, layers.debris, pos, 0.9, Math.random);
  }
}

function fireAtLogo(
  ship: Ship,
  weapon: WeaponMount,
  target: Vec,
  targetShip: Ship | undefined,
  textures: HomeTextures,
  projectiles: Projectile[],
  particles: Particle[],
  tempSprites: TempSprite[],
  layers: Record<string, Container>,
  time: number,
  onLogoHit: (pos: Vec, attackType: AttackType) => void
) {
  const origin = getShipMountWorld(ship, weapon);
  const attackType = weapon.attackType;

  if (attackType === "laser") {
    spawnBeam(tempSprites, particles, layers.vfx, textures.battleVfx, origin, target);
    if (time > 1.35) {
      if (targetShip) {
        hitShip(targetShip, origin, target, "laser", particles, tempSprites, layers, textures, 0.85);
      } else {
        onLogoHit(target, "laser");
      }
    }
    return;
  }

  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dist = Math.max(1, Math.hypot(dx, dy));
  const speed = weapon.weapon.projectileSpeed ?? 460;
  const direction = { x: dx / dist, y: dy / dist };
  const color = getAttackColor(attackType);
  const body = new Sprite(textures.battleVfx[getProjectileSpriteKey(attackType)]);
  body.anchor.set(0.5);
  body.width = attackType === "missile" ? 34 : 28;
  body.height = attackType === "missile" ? 18 : 16;
  body.rotation = Math.atan2(dy, dx);
  if (attackType === "missile") body.tint = 0xffd08a;
  if (attackType === "plasma") body.tint = 0xb77cff;
  body.position.set(origin.x, origin.y);

  const trail = new Graphics();
  projectiles.push({
    pos: { ...origin },
    previous: { ...origin },
    vel: { x: direction.x * speed, y: direction.y * speed },
    direction,
    acceleration: attackType === "missile" ? Math.max(150, speed * 0.42) : 0,
    target,
    body,
    trail,
    life: attackType === "missile" ? 8 : 2.6,
    radius: attackType === "missile" ? 7 : 4,
    attackType,
    color,
    smoke: attackType === "missile",
    targetShip
  });
  layers.projectiles.addChild(trail, body);
}

function getShipMountWorld(ship: Ship, mount: Vec): Vec {
  const scale = ship.body.scale.x;
  const lx = mount.x * scale;
  const ly = mount.y * scale;
  const cos = Math.cos(ship.heading);
  const sin = Math.sin(ship.heading);
  return {
    x: ship.pos.x + lx * cos - ly * sin,
    y: ship.pos.y + lx * sin + ly * cos
  };
}

function rotateTurretToTarget(weapon: WeaponMount, ownerRotation: number, ownerPos: Vec, targetPos: Vec, dt: number) {
  if (!weapon.turret) return true;
  const targetAngle = Math.atan2(targetPos.y - ownerPos.y, targetPos.x - ownerPos.x);
  const localTargetAngle = targetAngle - ownerRotation + Math.PI / 2;
  const delta = angleDelta(weapon.turret.rotation, localTargetAngle);
  const maxTurn = Math.max(1.2, weapon.weapon.turnSpeed) * dt;
  weapon.turret.rotation += clamp(delta, -maxTurn, maxTurn);
  return Math.abs(delta) < 0.18;
}

function updateProjectiles(
  projectiles: Projectile[],
  particles: Particle[],
  tempSprites: TempSprite[],
  pieces: DriftingPiece[],
  layers: Record<string, Container>,
  textures: HomeTextures,
  ships: Ship[],
  logo: ReturnType<typeof layoutLogo>,
  screenWidth: number,
  screenHeight: number,
  rng: () => number,
  dt: number,
  onLogoHit: (pos: Vec, attackType: AttackType) => void
) {
  for (let i = projectiles.length - 1; i >= 0; i -= 1) {
    const projectile = projectiles[i];
    projectile.life -= dt;
    projectile.previous = { ...projectile.pos };
    if (projectile.attackType === "missile") {
      projectile.vel.x += projectile.direction.x * projectile.acceleration * dt;
      projectile.vel.y += projectile.direction.y * projectile.acceleration * dt;
    } else if (projectile.targetShip && ships.includes(projectile.targetShip)) {
      projectile.target = {
        x: projectile.targetShip.pos.x,
        y: projectile.targetShip.pos.y
      };
      const dx = projectile.target.x - projectile.pos.x;
      const dy = projectile.target.y - projectile.pos.y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const speed = Math.max(1, Math.hypot(projectile.vel.x, projectile.vel.y));
      const homing = projectile.attackType === "plasma" ? 0.04 : 0.025;
      projectile.vel.x = projectile.vel.x * (1 - homing) + (dx / dist) * speed * homing;
      projectile.vel.y = projectile.vel.y * (1 - homing) + (dy / dist) * speed * homing;
    }
    projectile.pos.x += projectile.vel.x * dt;
    projectile.pos.y += projectile.vel.y * dt;
    projectile.body.position.set(projectile.pos.x, projectile.pos.y);
    projectile.body.rotation = Math.atan2(projectile.vel.y, projectile.vel.x);
    drawProjectileTrail(projectile);

    if (projectile.smoke && rng() > 0.35) {
      spawnSmoke(particles, layers.debris, projectile.previous, 0.7, rng);
    }

    const reachedTarget = projectile.attackType !== "missile" && distance(projectile.pos, projectile.target) < projectile.radius + 12;
    const hitTargetShip =
      projectile.targetShip &&
      ships.includes(projectile.targetShip) &&
      (projectile.attackType === "missile"
        ? segmentPointDistance(projectile.previous, projectile.pos, projectile.targetShip.pos) <
          projectile.radius + projectile.targetShip.radius * 0.62
        : distance(projectile.pos, projectile.targetShip.pos) < projectile.radius + projectile.targetShip.radius * 0.62);
    const logoHitPoint = !projectile.targetShip ? segmentLogoHitPoint(projectile.previous, projectile.pos, logo) : undefined;
    const reachedLogoTarget = !projectile.targetShip && reachedTarget && pointInsideLogo(projectile.target, logo);
    const outOfScene = isOutsideScene(projectile.pos, screenWidth, screenHeight, projectile.attackType === "missile" ? 180 : 120);
    if (reachedTarget || hitTargetShip || logoHitPoint || outOfScene || projectile.life <= 0) {
      if (projectile.life > 0 && hitTargetShip && projectile.targetShip) {
        hitShip(projectile.targetShip, projectile.previous, projectile.pos, projectile.attackType, particles, tempSprites, layers, textures);
      } else if (projectile.life > 0 && !projectile.targetShip && (logoHitPoint || reachedLogoTarget)) {
        onLogoHit(logoHitPoint ?? projectile.target, projectile.attackType);
      }
      projectile.body.destroy();
      projectile.trail.destroy();
      projectiles.splice(i, 1);
      if (pieces.length > 28) removeOldPiece(pieces);
    }
  }
}

function updatePieces(pieces: DriftingPiece[], dt: number) {
  for (let i = pieces.length - 1; i >= 0; i -= 1) {
    const piece = pieces[i];
    piece.life -= dt;
    piece.sprite.x += piece.vel.x * dt;
    piece.sprite.y += piece.vel.y * dt;
    piece.sprite.rotation += piece.spin * dt;
    piece.sprite.alpha = Math.min(0.92, piece.life / 1.5);
    if (piece.life <= 0) {
      piece.sprite.destroy();
      pieces.splice(i, 1);
    }
  }
}

function updateParticles(particles: Particle[], dt: number) {
  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const particle = particles[i];
    particle.life -= dt;
    particle.pos.x += particle.vel.x * dt;
    particle.pos.y += particle.vel.y * dt;
    const t = Math.max(0, particle.life / particle.maxLife);
    particle.body.position.set(particle.pos.x, particle.pos.y);
    particle.body.alpha = particle.alpha * t;
    particle.body.scale.set(1 + (1 - t) * 0.55);
    if (particle.life <= 0) {
      particle.body.destroy();
      particles.splice(i, 1);
    }
  }
}

function updateTempSprites(tempSprites: TempSprite[], dt: number) {
  for (let i = tempSprites.length - 1; i >= 0; i -= 1) {
    const item = tempSprites[i];
    item.life -= dt;
    const t = Math.max(0, item.life / item.maxLife);
    item.sprite.alpha = item.baseAlpha * t;
    item.sprite.rotation += item.spin * dt;
    item.sprite.scale.set(item.baseScale * (1 + (1 - t) * item.grow));
    if (item.frames?.length) {
      const frameIndex = Math.min(item.frames.length - 1, Math.floor((1 - t) * item.frames.length));
      item.sprite.texture = item.frames[frameIndex];
    }
    if (item.life <= 0) {
      item.sprite.destroy();
      tempSprites.splice(i, 1);
    }
  }
}

function makeShip(width: number, height: number, rng: () => number, textures: HomeTextures, team: number): Ship {
  const body = new Container();
  const accent = [0x49d7ff, 0x9b5cff, 0xff9b42, 0x53e7a4][Math.floor(rng() * 4)];
  const layouts: ShipLayout[] = [
    {
      attackType: "kinetic",
      parts: [
        { kind: "module", key: "core", x: 0, y: 0 },
        { kind: "module", key: "hull", x: -1, y: 0 },
        { kind: "module", key: "hull", x: 1, y: 0 },
        { kind: "weapon", key: "autocannonBase", turretKey: "autocannonTurret", x: 0, y: -1 },
        { kind: "module", key: "ionEngine", x: 0, y: 1 }
      ]
    },
    {
      attackType: "laser",
      parts: [
        { kind: "module", key: "core", x: 0, y: 0 },
        { kind: "module", key: "reactor", x: 0, y: 1 },
        { kind: "weapon", key: "laserBase", turretKey: "laserTurret", x: -1, y: -1 },
        { kind: "weapon", key: "laserBase", turretKey: "laserTurret", x: 1, y: -1 },
        { kind: "module", key: "sideThruster", x: -1, y: 1 },
        { kind: "module", key: "sideThruster", x: 1, y: 1 }
      ]
    },
    {
      attackType: "plasma",
      parts: [
        { kind: "module", key: "core", x: 0, y: 0 },
        { kind: "module", key: "battery", x: -1, y: 0 },
        { kind: "module", key: "reactor", x: 1, y: 0 },
        { kind: "weapon", key: "plasmaBase", turretKey: "plasmaTurret", x: 0, y: -1 },
        { kind: "module", key: "plasmaThruster", x: -1, y: 1 },
        { kind: "module", key: "plasmaThruster", x: 1, y: 1 }
      ]
    },
    {
      attackType: "missile",
      parts: [
        { kind: "module", key: "core", x: 0, y: 0 },
        { kind: "module", key: "armor", x: -1, y: 0 },
        { kind: "module", key: "armor", x: 1, y: 0 },
        { kind: "weapon", key: "missileBase", turretKey: "missileTurret", x: -1, y: -1 },
        { kind: "weapon", key: "missileBase", turretKey: "missileTurret", x: 1, y: -1 },
        { kind: "module", key: "ionEngine", x: 0, y: 1 }
      ]
    }
  ];
  const layout = layouts[Math.floor(rng() * layouts.length)];
  const cell = 24 + rng() * 4;
  const moduleCount = layout.parts.length;
  const statModules: ShipBuild["modules"] = [];
  const weaponMounts: WeaponMount[] = [];
  const engineMounts: Vec[] = [];
  layout.parts.forEach((part) => {
    const weaponType = part.kind === "weapon" ? pickGeneratedWeaponType(layout.attackType, rng) : layout.attackType;
    statModules.push({
      instanceId: `home-${statModules.length}`,
      moduleId: getStatModuleId(part, weaponType),
      position: { x: part.x + 2, y: part.y + 2 },
      rotation: 0
    });
    const weaponSpec = part.kind === "weapon" ? getWeaponSpec(weaponType) : null;
    const sprite = new Sprite(
      weaponSpec
        ? textures.weapons[weaponSpec.base]
        : textures.modules[part.key as ModuleSpriteKey]
    );
    sprite.anchor.set(0.5);
    sprite.width = cell * (part.kind === "weapon" ? 1.45 : 1.6);
    sprite.height = cell * (part.kind === "weapon" ? 1.45 : 1.6);
    sprite.position.set(part.x * cell, part.y * cell);
    if (part.key === "plasmaThruster") sprite.tint = 0xd8a0ff;
    if (part.key === "ionEngine") sprite.tint = 0x9fe7ff;
    if (weaponSpec) sprite.tint = weaponSpec.tint;
    body.addChild(sprite);

    if (weaponSpec) {
      const turret = new Sprite(textures.weapons[weaponSpec.turret]);
      turret.anchor.set(0.5);
      turret.width = cell * 1.22;
      turret.height = cell * 1.22;
      turret.position.set(part.x * cell, part.y * cell);
      turret.tint = weaponSpec.tint;
      body.addChild(turret);
      weaponMounts.push({
        x: part.x * cell,
        y: part.y * cell - cell * 0.68,
        attackType: weaponType,
        weapon: BATTLE_WEAPON_LAWS[weaponType],
        cooldown: rng() * 0.8,
        turret
      });
    } else if (part.key === "ionEngine" || part.key === "sideThruster" || part.key === "plasmaThruster") {
      engineMounts.push({ x: part.x * cell, y: part.y * cell });
    }
  });
  body.scale.set(0.7 + rng() * 0.28);

  const side = Math.floor(rng() * 4);
  const pos = side === 0
    ? { x: -80, y: rng() * height }
    : side === 1
      ? { x: width + 80, y: rng() * height }
      : side === 2
        ? { x: rng() * width, y: -80 }
        : { x: rng() * width, y: height + 80 };
  const moveFocus = { x: width / 2, y: height * 0.32 };
  const dx = moveFocus.x - pos.x;
  const dy = moveFocus.y - pos.y;
  const dist = Math.max(1, Math.hypot(dx, dy));
  const tangent = rng() < 0.5 ? -1 : 1;
  const stats = calculateShipStats({
    schemaVersion: 3,
    id: "home-scene-ship",
    name: "Home Scene Ship",
    frameId: moduleCount <= 5 ? "enemy_drone_frame" : moduleCount >= 8 ? "enemy_bomber_frame" : "enemy_raider_frame",
    panels: [],
    modules: statModules
  });
  const acceleration = Math.max(30, stats.acceleration * 70);
  const maxSpeed = stats.maxSpeed;
  const turnRate = Math.max(1.5, stats.turnRate);
  const initialSpeed = maxSpeed * (0.32 + rng() * 0.16);
  const initialVel = {
    x: (dx / dist) * initialSpeed + (-dy / dist) * tangent * (12 + rng() * 18),
    y: (dy / dist) * initialSpeed + (dx / dist) * tangent * (12 + rng() * 18)
  };
  const flightRotation = Math.atan2(initialVel.y, initialVel.x);
  const heading = flightRotation + Math.PI / 2;

  return {
    body,
    pos,
    vel: initialVel,
    team,
    moveFocus,
    heading,
    flightRotation,
    orbitAngle: rng() * Math.PI * 2,
    orbitRadius: Math.min(width, height) * (0.42 + rng() * 0.18),
    attackType: layout.attackType,
    acceleration,
    maxSpeed,
    turnRate,
    moduleCount,
    engineColor: accent,
    radius: cell * body.scale.x * 2.25,
    weaponMounts,
    engineMounts
  };
}

function pickGeneratedWeaponType(primary: AttackType, rng: () => number): AttackType {
  if (rng() < 0.62) return primary;
  const types: AttackType[] = ["kinetic", "laser", "plasma", "missile"];
  return types[Math.floor(rng() * types.length)];
}

function getStatModuleId(part: ShipPart, weaponType: AttackType) {
  if (part.kind === "weapon") {
    if (weaponType === "laser") return "laser_turret";
    if (weaponType === "plasma") return "plasma_cannon";
    if (weaponType === "missile") return "missile_pod";
    return "autocannon";
  }
  if (part.key === "core") return "core_mk1";
  if (part.key === "armor") return "light_armor";
  if (part.key === "reactor" || part.key === "battery") return "small_reactor";
  if (part.key === "plasmaThruster") return "plasma_thruster";
  if (part.key === "sideThruster") return "side_thruster";
  if (part.key === "ionEngine") return "ion_engine";
  return "hull_block";
}

function getWeaponSpec(attackType: AttackType): WeaponSpec {
  if (attackType === "laser") {
    return { base: "laserBase", turret: "laserTurret", tint: 0x9af5ff };
  }
  if (attackType === "plasma") {
    return { base: "plasmaBase", turret: "plasmaTurret", tint: 0xc98cff };
  }
  if (attackType === "missile") {
    return { base: "missileBase", turret: "missileTurret", tint: 0xffd080 };
  }
  return { base: "autocannonBase", turret: "autocannonTurret", tint: 0xb8d8ff };
}

function spawnEngineGlows(
  particles: Particle[],
  layer: Container,
  pos: Vec,
  visualRotation: number,
  thrustRotation: number,
  engineMounts: Vec[],
  power: number,
  scale: number,
  rng: () => number
) {
  const mounts = engineMounts.length > 0 ? engineMounts : [{ x: 0, y: 28 }];
  mounts.forEach((mount) => {
    const world = getWorldMount(pos, visualRotation, mount, scale);
    const nozzleX = world.x - Math.cos(thrustRotation) * 10 * scale;
    const nozzleY = world.y - Math.sin(thrustRotation) * 10 * scale;
    const outerLength = (20 + power * 22) * scale;
    const outerHalf = (4 + power * 4) * scale;
    const innerLength = outerLength * 0.62;
    const innerHalf = outerHalf * 0.42;
    const flame = new Graphics()
      .moveTo(0, -outerHalf)
      .lineTo(-outerLength, 0)
      .lineTo(0, outerHalf)
      .closePath()
      .fill({ color: 0xff9b42, alpha: 0.22 + power * 0.18 })
      .moveTo(0, -innerHalf)
      .lineTo(-innerLength, 0)
      .lineTo(0, innerHalf)
      .closePath()
      .fill({ color: 0x6ceaff, alpha: 0.2 + power * 0.18 });
    flame.position.set(nozzleX, nozzleY);
    flame.rotation = thrustRotation;
    layer.addChild(flame);
    setTimeout(() => flame.destroy(), 100);

    if (rng() < 0.45) {
      const trailDistance = outerLength * (0.45 + rng() * 0.55);
      const trailSpread = outerHalf * (rng() - 0.5) * 0.9;
      const cos = Math.cos(thrustRotation);
      const sin = Math.sin(thrustRotation);
      addParticle(particles, layer, {
        pos: {
          x: nozzleX - cos * trailDistance - sin * trailSpread,
          y: nozzleY - sin * trailDistance + cos * trailSpread
        },
        vel: {
          x: -cos * (12 + rng() * 24),
          y: -sin * (12 + rng() * 24)
        },
        life: 0.16 + rng() * 0.12,
        size: (0.8 + rng() * 1.15) * scale,
        color: rng() < 0.45 ? 0x49d7ff : 0xff9b42,
        alpha: 0.24,
        kind: "smoke"
      });
    }
  });
}

function getWorldMount(pos: Vec, rotation: number, mount: Vec, scale = 1) {
  const lx = mount.x * scale;
  const ly = mount.y * scale;
  return {
    x: pos.x + Math.cos(rotation) * lx - Math.sin(rotation) * ly,
    y: pos.y + Math.sin(rotation) * lx + Math.cos(rotation) * ly
  };
}

function spawnImpact(
  particles: Particle[],
  tempSprites: TempSprite[],
  layer: Container,
  textures: Record<BattleVfxSpriteKey, Texture>,
  pos: Vec,
  attackType: AttackType
) {
  const color = getAttackColor(attackType);
  if (attackType === "missile") {
    spawnVfxSprite(tempSprites, layer, textures.armorImpact, pos, 20, 0.13, 0xffc37a, 0.62, 0.2);
    spawnVfxSprite(tempSprites, layer, textures.debrisCluster, pos, 13, 0.16, 0xffffff, 0.44, 0.18);
  } else if (attackType === "plasma") {
    spawnVfxSprite(tempSprites, layer, textures.smallExplosion, pos, 21, 0.14, 0xb66cff, 0.58, 0.24);
    spawnVfxSprite(tempSprites, layer, textures.shieldImpact, pos, 15, 0.12, 0x8b4dff, 0.36, 0.12);
  } else if (attackType === "laser") {
    spawnVfxSprite(tempSprites, layer, textures.kineticImpact, pos, 17, 0.1, 0x8ff8ff, 0.68, 0.16);
    spawnVfxSprite(tempSprites, layer, textures.shieldImpact, pos, 11, 0.09, 0x66e6ff, 0.3, 0.08);
  } else {
    spawnVfxSprite(tempSprites, layer, textures.kineticImpact, pos, 18, 0.12, 0xffffff, 0.72, 0.16);
    spawnVfxSprite(tempSprites, layer, textures.armorImpact, pos, 14, 0.11, 0xffd7a1, 0.44, 0.12);
  }
  const sparks = attackType === "missile" ? 8 : attackType === "plasma" ? 7 : 5;
  for (let i = 0; i < sparks; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 58 + Math.random() * (attackType === "missile" ? 150 : 112);
    addParticle(particles, layer, {
      pos: { ...pos },
      vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
      life: 0.22 + Math.random() * 0.22,
      size: 1 + Math.random() * (attackType === "missile" ? 1.8 : 1.35),
      color: i % 3 === 0 ? 0xffffff : color,
      alpha: 0.58,
      kind: "spark"
    });
  }
}

function spawnExplosion(
  tempSprites: TempSprite[],
  particles: Particle[],
  layer: Container,
  textures: Record<BattleVfxSpriteKey, Texture>,
  pos: Vec,
  attackType: AttackType,
  size: number
) {
  const tint = attackType === "kinetic" ? 0xffd7a1 : getAttackColor(attackType);
  if (attackType === "missile") {
    spawnVfxSprite(tempSprites, layer, textures.largeExplosion, pos, size, 0.26, 0xffb35c, 0.82, 0.3);
    spawnVfxSprite(tempSprites, layer, textures.debrisCluster, pos, size * 0.58, 0.22, 0xffffff, 0.58, 0.18);
  } else if (attackType === "plasma") {
    spawnVfxSprite(tempSprites, layer, textures.smallExplosion, pos, size, 0.24, 0xb66cff, 0.74, 0.34);
    spawnVfxSprite(tempSprites, layer, textures.shieldImpact, pos, size * 0.68, 0.2, tint, 0.42, 0.18);
  } else if (attackType === "laser") {
    spawnVfxSprite(tempSprites, layer, textures.kineticImpact, pos, size, 0.14, 0x8ff8ff, 0.78, 0.18);
    spawnVfxSprite(tempSprites, layer, textures.shieldImpact, pos, size * 0.52, 0.12, 0x66e6ff, 0.34, 0.08);
  } else {
    spawnVfxSprite(tempSprites, layer, textures.armorImpact, pos, size, 0.2, tint, 0.74, 0.24);
    spawnVfxSprite(tempSprites, layer, textures.kineticImpact, pos, size * 0.72, 0.16, 0xffffff, 0.58, 0.14);
  }
}

function spawnBeam(
  tempSprites: TempSprite[],
  particles: Particle[],
  layer: Container,
  textures: Record<BattleVfxSpriteKey, Texture>,
  from: Vec,
  to: Vec
) {
  const beam = new Graphics()
    .moveTo(from.x, from.y)
    .lineTo(to.x, to.y)
    .stroke({ color: 0x66e6ff, alpha: 0.78, width: 4 })
    .moveTo(from.x, from.y)
    .lineTo(to.x, to.y)
    .stroke({ color: 0xffffff, alpha: 0.84, width: 1 });
  layer.addChild(beam);
  tempSprites.push({
    sprite: beam as unknown as Sprite,
    life: 0.08,
    maxLife: 0.08,
    baseAlpha: 1,
    baseScale: 1,
    spin: 0,
    grow: 0
  });
  spawnVfxSprite(tempSprites, layer, textures.shieldImpact, to, 18, 0.1, 0x66e6ff, 0.34, 0.08);
}

function spawnVfxSprite(
  tempSprites: TempSprite[],
  layer: Container,
  texture: Texture,
  pos: Vec,
  size: number,
  life: number,
  tint = 0xffffff,
  alpha = 1,
  grow = 0.6
) {
  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5);
  sprite.width = size;
  sprite.height = size;
  sprite.position.set(pos.x, pos.y);
  sprite.tint = tint;
  sprite.alpha = alpha;
  sprite.rotation = Math.random() * Math.PI * 2;
  const baseScale = sprite.scale.x;
  layer.addChild(sprite);
  tempSprites.push({ sprite, life, maxLife: life, baseAlpha: alpha, baseScale, spin: 2.4 - Math.random() * 4.8, grow });
}

function spawnSmoke(particles: Particle[], layer: Container, pos: Vec, scale: number, rng: () => number) {
  addParticle(particles, layer, {
    pos: { x: pos.x + rng() * 8 - 4, y: pos.y + rng() * 8 - 4 },
    vel: { x: rng() * 20 - 10, y: rng() * 20 - 10 },
    life: 0.45 + rng() * 0.35,
    size: 5 * scale + rng() * 6 * scale,
    color: 0x6b7480,
    alpha: 0.12,
    kind: "smoke"
  });
}

function addParticle(
  particles: Particle[],
  layer: Container,
  input: Omit<Particle, "body" | "maxLife">
) {
  const body = new Graphics();
  body.circle(0, 0, input.size).fill({ color: input.color, alpha: input.alpha });
  body.position.set(input.pos.x, input.pos.y);
  layer.addChild(body);
  particles.push({ ...input, body, maxLife: input.life });
}

function spawnLogoPiece(
  pieces: DriftingPiece[],
  layer: Container,
  textures: Texture[],
  pos: Vec,
  logo: Sprite,
  rng: () => number
) {
  const texture = textures[Math.floor(rng() * textures.length)];
  const piece = new Sprite(texture);
  piece.anchor.set(0.5);
  const scale = (0.028 + rng() * 0.025) * Math.max(0.72, logo.scale.x / 0.18);
  piece.scale.set(scale);
  piece.position.set(pos.x + rng() * 18 - 9, pos.y + rng() * 18 - 9);
  piece.rotation = rng() * Math.PI * 2;
  piece.alpha = 0.92;
  layer.addChild(piece);

  const angle = Math.atan2(pos.y - logo.y, pos.x - logo.x) + (rng() - 0.5) * 1.1;
  pieces.push({
    sprite: piece,
    vel: {
      x: Math.cos(angle) * (28 + rng() * 72),
      y: Math.sin(angle) * (28 + rng() * 72) + 16
    },
    spin: -1.2 + rng() * 2.4,
    life: 8 + rng() * 8
  });
}

function removeOldPiece(pieces: DriftingPiece[]) {
  const old = pieces.shift();
  old?.sprite.destroy();
}

function drawLogoCrack(container: Container, logo: Sprite, logoMask: AlphaBounds, pos: Vec, rng: () => number) {
  const crack = new Graphics();
  const localX = pos.x - logo.x;
  const localY = pos.y - logo.y;
  crack.position.set(logo.x, logo.y);
  crack.alpha = 0.28;
  for (let i = 0; i < 3; i += 1) {
    const angle = rng() * Math.PI * 2;
    const length = 12 + rng() * 24;
    const steps = Math.max(2, Math.ceil(length / 4));
    let end = pos;
    for (let step = 1; step <= steps; step += 1) {
      const next = {
        x: pos.x + Math.cos(angle) * length * (step / steps),
        y: pos.y + Math.sin(angle) * length * (step / steps)
      };
      if (!pointInsideLogoSprite(next, logo, logoMask)) break;
      end = next;
    }
    if (distance(pos, end) < 3) continue;
    crack
      .moveTo(localX, localY)
      .lineTo(end.x - logo.x, end.y - logo.y)
      .stroke({ color: 0xcfefff, alpha: 0.36, width: 1 });
  }
  container.addChild(crack);
  if (container.children.length > 22) {
    container.removeChildAt(0).destroy();
  }
}

function randomLogoBoundaryPoint(logo: ReturnType<typeof layoutLogo>, rng: () => number): Vec {
  const mask = logo.mask;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const side = Math.floor(rng() * 4);
    if (side === 0 || side === 1) {
      const y = Math.floor(mask.minY + rng() * Math.max(1, mask.height));
      const startX = side === 0 ? mask.minX : mask.maxX;
      const endX = side === 0 ? mask.maxX : mask.minX;
      const step = side === 0 ? 1 : -1;
      for (let x = startX; side === 0 ? x <= endX : x >= endX; x += step) {
        if (isMaskOpaque(mask, x, y)) return logoImageToWorldPoint(logo, x, y);
      }
      continue;
    }

    const x = Math.floor(mask.minX + rng() * Math.max(1, mask.width));
    const startY = side === 2 ? mask.minY : mask.maxY;
    const endY = side === 2 ? mask.maxY : mask.minY;
    const step = side === 2 ? 1 : -1;
    for (let y = startY; side === 2 ? y <= endY : y >= endY; y += step) {
      if (isMaskOpaque(mask, x, y)) return logoImageToWorldPoint(logo, x, y);
    }
  }

  return logo.center;
}

function pointInsideLogo(point: Vec, logo: ReturnType<typeof layoutLogo>) {
  const imagePoint = logoWorldToImagePoint(point, logo);
  return isMaskOpaque(logo.mask, imagePoint.x, imagePoint.y);
}

function segmentLogoHitPoint(from: Vec, to: Vec, logo: ReturnType<typeof layoutLogo>) {
  const length = distance(from, to);
  const steps = Math.max(1, Math.ceil(length / 6));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const point = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    if (pointInsideLogo(point, logo)) return point;
  }
  return undefined;
}

function pointInsideLogoSprite(point: Vec, logo: Sprite, mask: AlphaBounds) {
  const imagePoint = logoSpriteWorldToImagePoint(point, logo, mask);
  return isMaskOpaque(mask, imagePoint.x, imagePoint.y);
}

function isMaskOpaque(mask: AlphaBounds, x: number, y: number) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= mask.sourceWidth || py >= mask.sourceHeight) return false;
  return mask.alpha[py * mask.sourceWidth + px] > 32;
}

function logoWorldToImagePoint(point: Vec, logo: ReturnType<typeof layoutLogo>): Vec {
  const dx = point.x - logo.x;
  const dy = point.y - logo.y;
  const cos = Math.cos(logo.rotation);
  const sin = Math.sin(logo.rotation);
  return {
    x: (dx * cos + dy * sin) / logo.scale + logo.mask.sourceWidth / 2,
    y: (-dx * sin + dy * cos) / logo.scale + logo.mask.sourceHeight / 2
  };
}

function logoSpriteWorldToImagePoint(point: Vec, logo: Sprite, mask: AlphaBounds): Vec {
  const dx = point.x - logo.x;
  const dy = point.y - logo.y;
  const cos = Math.cos(logo.rotation);
  const sin = Math.sin(logo.rotation);
  return {
    x: (dx * cos + dy * sin) / logo.scale.x + mask.sourceWidth / 2,
    y: (-dx * sin + dy * cos) / logo.scale.y + mask.sourceHeight / 2
  };
}

function logoImageToWorldPoint(logo: ReturnType<typeof layoutLogo>, x: number, y: number): Vec {
  const localX = (x - logo.mask.sourceWidth / 2) * logo.scale;
  const localY = (y - logo.mask.sourceHeight / 2) * logo.scale;
  const cos = Math.cos(logo.rotation);
  const sin = Math.sin(logo.rotation);
  return {
    x: logo.x + localX * cos - localY * sin,
    y: logo.y + localX * sin + localY * cos
  };
}

function segmentPointDistance(from: Vec, to: Vec, point: Vec) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 0.0001) return distance(from, point);
  const t = clamp(((point.x - from.x) * dx + (point.y - from.y) * dy) / lenSq, 0, 1);
  return distance({ x: from.x + dx * t, y: from.y + dy * t }, point);
}

function isOutsideScene(point: Vec, width: number, height: number, margin: number) {
  return point.x < -margin || point.x > width + margin || point.y < -margin || point.y > height + margin;
}

function drawProjectileTrail(projectile: Projectile) {
  const speed = Math.max(1, Math.hypot(projectile.vel.x, projectile.vel.y));
  const nx = projectile.vel.x / speed;
  const ny = projectile.vel.y / speed;
  const tail = projectile.smoke ? 42 : 28;
  projectile.trail.clear();
  for (let i = 0; i < 3; i += 1) {
    const start = 8 + i * (tail / 3);
    const end = start + tail / 5;
    projectile.trail
      .moveTo(projectile.pos.x - nx * end, projectile.pos.y - ny * end)
      .lineTo(projectile.pos.x - nx * start, projectile.pos.y - ny * start)
      .stroke({ color: projectile.color, alpha: 0.18 - i * 0.04, width: projectile.smoke ? 2 : 1.3 });
  }
}

function seedStars(layer: Container, count: number, alpha: number, maxSize: number, rng: () => number) {
  for (let i = 0; i < count; i += 1) {
    const star = new Graphics()
      .circle(0, 0, 0.35 + rng() * maxSize)
      .fill({ color: 0xd8e7ff, alpha: alpha * (0.35 + rng() * 0.65) });
    star.position.set(rng() * SPACE_BOUNDS.width - SPACE_BOUNDS.width / 2, rng() * SPACE_BOUNDS.height - SPACE_BOUNDS.height / 2);
    layer.addChild(star);
  }
  layer.position.set(SPACE_BOUNDS.width * 0.5, SPACE_BOUNDS.height * 0.5);
}

function seedDust(layer: Container, count: number, rng: () => number) {
  for (let i = 0; i < count; i += 1) {
    const size = 1.5 + rng() * 4.8;
    const rock = new Graphics()
      .poly([0, -size, size * 0.8, -size * 0.2, size * 0.35, size, -size * 0.9, size * 0.45])
      .fill({ color: 0x74808f, alpha: 0.09 + rng() * 0.08 });
    rock.position.set(rng() * SPACE_BOUNDS.width - SPACE_BOUNDS.width / 2, rng() * SPACE_BOUNDS.height - SPACE_BOUNDS.height / 2);
    rock.rotation = rng() * Math.PI * 2;
    layer.addChild(rock);
  }
  layer.position.set(SPACE_BOUNDS.width * 0.5, SPACE_BOUNDS.height * 0.5);
}

function seedPlanet(layer: Container, planets: PlanetTexture[], width: number, height: number, rng: () => number) {
  const selected = planets[Math.floor(rng() * planets.length)];
  const root = new Container() as RotatingPlanet;
  const planet = new Sprite(selected.texture);
  const targetDiameter = Math.max(width * 1.46, height * 0.82);
  const scale = targetDiameter / planet.texture.width;
  const planetHeight = planet.texture.height * scale;
  planet.anchor.set(0.5);
  planet.scale.set(scale);
  planet.alpha = 1;
  root.addChild(planet);
  root.baseRotation = rng() * Math.PI * 2;
  root.spinSpeed = (rng() < 0.5 ? -1 : 1) * (0.0012 + rng() * 0.0018);
  root.rotation = root.baseRotation;
  const side = rng() < 0.5 ? -1 : 1;
  root.baseX = width * 0.5 + side * width * (0.18 + rng() * 0.16);
  root.baseY = height - planetHeight * (0.03 + rng() * 0.09);
  root.driftAmplitude = width * (0.028 + rng() * 0.025);
  root.driftSpeed = 0.006 + rng() * 0.006;
  root.driftPhase = rng() * Math.PI * 2;
  root.position.set(root.baseX, root.baseY);
  layer.addChild(root);
}

function sliceBattleVfx(base: Texture) {
  const textures = {} as Record<BattleVfxSpriteKey, Texture>;
  (Object.keys(battleVfxAtlas.cells) as BattleVfxSpriteKey[]).forEach((key) => {
    const cell = battleVfxAtlas.cells[key];
    textures[key] = new Texture({
      source: base.source,
      frame: new Rectangle(
        cell.col * battleVfxAtlas.frameWidth + 18,
        cell.row * battleVfxAtlas.frameHeight + 18,
        battleVfxAtlas.frameWidth - 36,
        battleVfxAtlas.frameHeight - 36
      )
    });
  });
  return textures;
}

function sliceAtlas<T extends string>(
  base: Texture,
  atlas: {
    frameWidth: number;
    frameHeight: number;
    cells: Record<T, { col: number; row: number }>;
  }
) {
  const textures = {} as Record<T, Texture>;
  (Object.keys(atlas.cells) as T[]).forEach((key) => {
    const cell = atlas.cells[key];
    textures[key] = new Texture({
      source: base.source,
      frame: new Rectangle(
        cell.col * atlas.frameWidth,
        cell.row * atlas.frameHeight,
        atlas.frameWidth,
        atlas.frameHeight
      )
    });
  });
  return textures;
}

function getProjectileSpriteKey(attackType: AttackType): BattleVfxSpriteKey {
  if (attackType === "missile") return "missileProjectile";
  if (attackType === "plasma" || attackType === "laser") return "plasmaProjectile";
  return "kineticProjectile";
}

function getAttackColor(attackType: AttackType) {
  if (attackType === "missile") return 0xff9b42;
  if (attackType === "plasma") return 0x9b5cff;
  if (attackType === "laser") return 0x66e6ff;
  return 0x49d7ff;
}

function distance(a: Vec, b: Vec) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function easeOutBack(value: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(value - 1, 3) + c1 * Math.pow(value - 1, 2);
}

function createRng(seed: number) {
  let value = seed || 1;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}
