"use client";

import { useEffect, useRef } from "react";
import { Application, Assets, Container, Graphics, Rectangle, Sprite, Texture, TilingSprite } from "@/game/render/three/three2d";
import { angleDelta, clamp, distance, getWorldMount, type Vec } from "@/game/battle/math";
import { applyShipPhysics } from "@/game/battle/shipPhysics";
import {
  HOME_COSMIC_GLOW_CONFIGS,
  HOME_PLANET_LAYOUTS,
  PLANET_GLOW_COLORS,
  PLANET_SRCS,
  SPACE_TILE_SCALE,
  pickSpaceTileSource
} from "@/game/render/spaceScene/constants";
import { addLayers, createLayerSet } from "@/game/render/spaceScene/layers";
import { cloneShipBuild, shipBuildPresets } from "@/game/data/shipPresets";
import {
  getCabin,
  getInstalledCabinPosition,
  getModule,
  getPanel,
  getTransformedCells
} from "@/game/ship/build";
import { calculateShipStats } from "@/game/ship/stats";
import {
  battleVfxAtlas,
  cabinAtlas,
  moduleAtlas,
  moduleStateAtlas,
  panelAtlas,
  weaponAtlas,
  weaponStateAtlas,
  type BattleVfxSpriteKey,
  type ModuleSpriteKey,
  type WeaponSpriteKey
} from "@/game/assets/moduleSprites";
import type { CabinDef, GridCell, PanelDef, Rotation, WeaponDef } from "@/game/types";

const LOGO_SRC = "/assets/spacey/spacey-debris-logo-epic.png";
const PIECE_SRCS = Array.from(
  { length: 32 },
  (_, index) => `/assets/spacey/pieces/spacey-debris-piece-${String(index + 1).padStart(2, "0")}.png`
);
const SPACE_BOUNDS = { width: 1500, height: 2400 };
const PLANET_GLOW_PADDING_FACTOR = 0.08;
const PLANET_GLOW_SOFT_BLUR_FACTOR = 0.025;
const PLANET_GLOW_TIGHT_BLUR_FACTOR = 0.009;
const FRONT_PLANET_GLOW_WIDTH_MULTIPLIER = 2.35;
const FRONT_PLANET_GLOW_ALPHA_MULTIPLIER = 1.18;
const HOME_LOGO_VISUAL_SCALE = 1.2;
const HOME_SHIP_VISUAL_SCALE = 1.2;
const HOME_ACTION_RATE_MULTIPLIER = 1.58;
const HOME_PROJECTILE_SPEED_MULTIPLIER = 1.48;
const HOME_EXPLOSION_SIZE_MULTIPLIER = 1.18;
const HOME_LAYER_ORDER = [
  "background",
  "glows",
  "planets",
  "farStars",
  "closeStars",
  "debris",
  "engineVfx",
  "ships",
  "projectiles",
  "logo",
  "vfx",
  "screen"
] as const;

type AttackType = "kinetic" | "plasma" | "missile" | "laser";
type PlanetTexture = { glowColor: number; texture: Texture };
const HOME_PANEL_SPRITE_IDS = [
  "single_1",
  "bar_2h",
  "bar_2v",
  "bar_3h",
  "bar_4h",
  "block_2x2",
  "corner_l_2x2",
  "tee_3x2",
  "cross_3x3",
  "long_l_3x3",
  "zig_3x3",
  "c_2x3",
  "long_corner_2x3",
  "block_tail_2x3"
] as const;
type HomePanelSpriteKey = (typeof HOME_PANEL_SPRITE_IDS)[number];
const HOME_PANEL_SPRITE_ASSETS: Record<HomePanelSpriteKey, { width: number; height: number }> = {
  single_1: { width: 1, height: 1 },
  bar_2h: { width: 2, height: 1 },
  bar_2v: { width: 1, height: 2 },
  bar_3h: { width: 3, height: 1 },
  bar_4h: { width: 4, height: 1 },
  block_2x2: { width: 2, height: 2 },
  corner_l_2x2: { width: 2, height: 2 },
  tee_3x2: { width: 3, height: 2 },
  cross_3x3: { width: 3, height: 3 },
  long_l_3x3: { width: 3, height: 3 },
  zig_3x3: { width: 3, height: 3 },
  c_2x3: { width: 2, height: 3 },
  long_corner_2x3: { width: 2, height: 3 },
  block_tail_2x3: { width: 2, height: 3 }
};
const HOME_CABIN_SPRITE_IDS = [
  "cabin_1x1",
  "cabin_1x2",
  "cabin_2x1",
  "cabin_2x2",
  "cabin_3x1",
  "cabin_block_3x2",
  "cabin_cross_3x3",
  "cabin_notch_3x2",
  "cabin_t_3x2",
  "cabin_u_3x2",
  "cabin_zig_3x2"
] as const;
type HomeCabinSpriteKey = (typeof HOME_CABIN_SPRITE_IDS)[number];
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
  panels: Record<HomePanelSpriteKey, Texture>;
  cabins: Record<HomeCabinSpriteKey, Texture>;
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
  glow: Sprite;
  image: Sprite;
  alphaBase: number;
  baseXFactor: number;
  baseYFactor: number;
  driftPhase: number;
  driftSpeed: number;
  driftXFactor: number;
  driftYFactor: number;
  glowAlphaBoost: number;
  baseRotation: number;
  heightFactor: number;
  maxWidthFactor: number;
  spinSpeed: number;
  widthFactor: number;
};

type CosmicGlow = Container & {
  alphaBase: number;
  baseRotation: number;
  baseScale: number;
  baseXFactor: number;
  baseYFactor: number;
  driftPhase: number;
  driftSpeed: number;
  driftXFactor: number;
  driftYFactor: number;
  pulsePhase: number;
  pulseSpeed: number;
  rotationSpeed: number;
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
      const layers = createLayerSet(HOME_LAYER_ORDER);
      addLayers(app.stage, layers, HOME_LAYER_ORDER);

      const spaceTile = new TilingSprite({
        texture: textures.background,
        width: app.screen.width,
        height: app.screen.height
      });
      spaceTile.alpha = 0.5;
      spaceTile.tileScale.set(SPACE_TILE_SCALE);
      layers.background.addChild(spaceTile);

      seedCosmicGlows(layers.glows, app.screen.width, app.screen.height, rng);
      seedStars(layers.farStars, 135, 0.15, 1.15, rng);
      seedStars(layers.closeStars, 70, 0.28, 1.9, rng);
      seedDust(layers.debris, 44, rng);
      seedPlanets(layers.planets, textures.planetImages, rng);

      const logo = new Sprite(textures.logo);
      logo.anchor.set(0.5);
      layers.logo.addChild(logo);

      const logoHits = new Container();
      layers.logo.addChild(logoHits);

      const shipCount = reducedMotion ? 8 : 16;
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
        screenShake = Math.max(screenShake, attackType === "missile" ? 0.76 : 0.42);
        logoPulse = 1;
        spawnImpact(particles, tempSprites, layers.vfx, textures.battleVfx, pos, attackType);
        spawnExplosion(
          tempSprites,
          particles,
          layers.vfx,
          textures.battleVfx,
          pos,
          attackType,
          (attackType === "missile" ? 56 : attackType === "plasma" ? 46 : attackType === "laser" ? 32 : 40) *
          HOME_EXPLOSION_SIZE_MULTIPLIER
        );
        drawLogoCrack(logoHits, logo, textures.logoBounds, pos, rng);
        const pieceCount = attackType === "missile" ? 5 : 3;
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
  const backgroundSrc = pickSpaceTileSource();
  const [[background, logo, battleVfxBase, moduleBase, weaponBase, panelTextures, cabinTextures, ...rest], logoBounds] = await Promise.all([
    Promise.all([
      Assets.load<Texture>(backgroundSrc),
      Assets.load<Texture>(LOGO_SRC),
      Assets.load<Texture>(battleVfxAtlas.src),
      Assets.load<Texture>(moduleStateAtlas.src),
      Assets.load<Texture>(weaponStateAtlas.src),
      loadStructureTextures(panelAtlas.src, HOME_PANEL_SPRITE_IDS),
      loadStructureTextures(cabinAtlas.src, HOME_CABIN_SPRITE_IDS),
      ...PLANET_SRCS.map((src) => Assets.load<Texture>(src)),
      ...PIECE_SRCS.map((src) => Assets.load<Texture>(src))
    ]),
    measureImageAlphaBounds(LOGO_SRC)
  ]);
  const planetImages = rest.slice(0, PLANET_SRCS.length).map((texture, index) => ({
    glowColor: PLANET_GLOW_COLORS[index] ?? 0x8fdfff,
    texture
  }));
  const pieces = rest.slice(PLANET_SRCS.length);

  return {
    background,
    planetImages,
    logo,
    logoBounds,
    pieces,
    modules: sliceAtlas(moduleBase, moduleAtlas),
    weapons: sliceAtlas(weaponBase, weaponAtlas),
    panels: panelTextures,
    cabins: cabinTextures,
    battleVfx: sliceBattleVfx(battleVfxBase)
  };
}

function layoutLogo(logo: Sprite, width: number, height: number, time: number, bounds: AlphaBounds) {
  const targetWidth = Math.min(width * 0.96, 420 * HOME_LOGO_VISUAL_SCALE);
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
  layers.glows.position.set(Math.sin(time * 0.014) * 18, Math.cos(time * 0.011) * 12);
  layers.glows.children.forEach((child) => {
    const glow = child as CosmicGlow;
    if (typeof glow.pulseSpeed !== "number") return;
    glow.position.set(
      width * glow.baseXFactor + Math.sin(time * glow.driftSpeed + glow.driftPhase) * width * glow.driftXFactor,
      height * glow.baseYFactor + Math.cos(time * glow.driftSpeed + glow.driftPhase) * height * glow.driftYFactor
    );
    glow.alpha = glow.alphaBase * (0.72 + Math.sin(time * glow.pulseSpeed + glow.pulsePhase) * 0.28);
    glow.rotation = glow.baseRotation + Math.sin(time * glow.rotationSpeed + glow.driftPhase) * 0.16;
    glow.scale.set(glow.baseScale * (0.96 + Math.sin(time * glow.pulseSpeed * 0.62 + glow.pulsePhase) * 0.04));
  });
  layers.planets.position.set(Math.sin(time * 0.018) * 18, Math.cos(time * 0.014) * 12);
  layers.planets.children.forEach((child) => {
    const planet = child as RotatingPlanet;
    if (typeof planet.driftSpeed === "number") {
      const targetDiameter = Math.min(
        Math.max(width * planet.widthFactor, height * planet.heightFactor),
        width * planet.maxWidthFactor
      );
      planet.image.scale.set(targetDiameter / planet.image.texture.width);
      planet.image.alpha = 1;
      planet.glow.scale.set(targetDiameter / planet.image.texture.width);
      planet.glow.alpha = Math.min(
        0.98,
        planet.alphaBase * planet.glowAlphaBoost * (1.08 + Math.sin(time * 0.18 + planet.driftPhase) * 0.12)
      );
      planet.position.set(
        width * planet.baseXFactor + Math.sin(time * planet.driftSpeed + planet.driftPhase) * width * planet.driftXFactor,
        height * planet.baseYFactor + Math.cos(time * planet.driftSpeed + planet.driftPhase) * height * planet.driftYFactor
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

function applyHomeShipPhysics(ship: Ship, desiredDirection: number, inputPower: number, dt: number) {
  const state = {
    pos: ship.pos,
    vel: ship.vel,
    rotation: ship.flightRotation,
    acceleration: ship.acceleration,
    maxSpeed: ship.maxSpeed,
    turnRate: ship.turnRate
  };
  applyShipPhysics(state, desiredDirection, inputPower, dt);
  ship.flightRotation = state.rotation;
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
    ship.orbitAngle += dt * (0.25 + index * 0.016);
    const enemy = findNearestEnemy(ship, ships);
    const focus = enemy && (index + Math.floor(time * 0.8)) % 3 !== 0 ? enemy.pos : logo.center;
    const focusEase = Math.min(1, dt * 0.92);
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
    const power = clamp(dist / Math.max(160, ship.orbitRadius * 0.4), 0.42, 1);
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

      const targetShip = enemy && enemyInRange && (rng() < 0.72 || !logoInRange) ? enemy : undefined;
      const target = targetShip
        ? {
          x: targetShip.pos.x + (rng() - 0.5) * targetShip.radius * 0.55,
          y: targetShip.pos.y + (rng() - 0.5) * targetShip.radius * 0.55
        }
        : randomLogoBoundaryPoint(logo, rng);

      const turretAligned = rotateTurretToTarget(weaponMount, ship.heading, ship.pos, target, dt);
      if (!turretAligned || weaponMount.cooldown > 0 || projectiles.length >= 130) return;

      weaponMount.cooldown = Math.max(0.07, 1 / (weaponMount.weapon.fireRate * HOME_ACTION_RATE_MULTIPLIER));
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
  const speed = (weapon.weapon.projectileSpeed ?? 460) * HOME_PROJECTILE_SPEED_MULTIPLIER;
  const direction = { x: dx / dist, y: dy / dist };
  const color = getAttackColor(attackType);
  const body = new Sprite(textures.battleVfx[getProjectileSpriteKey(attackType)]);
  body.anchor.set(0.5);
  body.width = attackType === "missile" ? 40 : 32;
  body.height = attackType === "missile" ? 21 : 18;
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
    acceleration: attackType === "missile" ? Math.max(240, speed * 0.52) : 0,
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
  const build = cloneShipBuild(shipBuildPresets[Math.floor(rng() * shipBuildPresets.length)]);
  const cabin = build.cabinId ? getCabin(build.cabinId) : null;
  const gridSize = cabin?.gridSize ?? { width: 5, height: 6 };
  const centerX = (gridSize.width - 1) / 2;
  const centerY = (gridSize.height - 1) / 2;
  const cell = 24 + rng() * 4;
  const moduleCount = build.modules.length + (build.panels?.length ?? 0) + (cabin ? 1 : 0);
  const weaponMounts: WeaponMount[] = [];
  const engineMounts: Vec[] = [];

  build.panels.forEach((installed) => {
    const panel = getPanel(installed.panelId);
    const spriteKey = getHomePanelSpriteKey(panel);
    const asset = HOME_PANEL_SPRITE_ASSETS[spriteKey];
    const cells = getTransformedCells(panel, installed.position, installed.rotation);
    const center = getCellsCenter(cells);
    const sprite = new Sprite(textures.panels[spriteKey]);
    sprite.anchor.set(0.5);
    sprite.width = asset.width * cell * 1.32;
    sprite.height = asset.height * cell * 1.32;
    sprite.angle = installed.rotation;
    sprite.position.set((center.x - centerX) * cell, (center.y - centerY) * cell);
    sprite.alpha = 0.92;
    body.addChild(sprite);
  });

  if (cabin) {
    const cabinPosition = getInstalledCabinPosition(build);
    if (cabinPosition) {
      const cabinSpriteKey = getHomeCabinSpriteKey(cabin);
      const cabinCenter = getCabinCenter(cabin, cabinPosition, build.cabinRotation ?? 0);
      const sprite = new Sprite(textures.cabins[cabinSpriteKey]);
      sprite.anchor.set(0.5);
      sprite.width = cabin.assetGridSize.width * cell * 1.28;
      sprite.height = cabin.assetGridSize.height * cell * 1.28;
      sprite.angle = build.cabinRotation ?? 0;
      sprite.position.set((cabinCenter.x - centerX) * cell, (cabinCenter.y - centerY) * cell);
      body.addChild(sprite);
    }
  }

  let primaryAttackType: AttackType = "kinetic";
  build.modules.forEach((installed) => {
    const module = getModule(installed.moduleId);
    if (build.cabinId && module.type === "core") return;
    const x = (installed.position.x - centerX) * cell;
    const y = (installed.position.y - centerY) * cell;
    const weaponType = module.weapon ? getAttackTypeForModule(installed.moduleId) : null;
    const weaponSpec = weaponType ? getWeaponSpec(weaponType) : null;
    const sprite = new Sprite(
      weaponSpec
        ? textures.weapons[weaponSpec.base]
        : textures.modules[getModuleSpriteKeyForHome(installed.moduleId)]
    );
    sprite.anchor.set(0.5);
    sprite.width = cell * (weaponSpec ? 1.42 : 1.28);
    sprite.height = cell * (weaponSpec ? 1.42 : 1.28);
    sprite.position.set(x, y);
    sprite.angle = installed.rotation;
    if (module.type === "engine") sprite.tint = installed.moduleId === "plasma_thruster" ? 0xd8a0ff : 0x9fe7ff;
    if (weaponSpec) sprite.tint = weaponSpec.tint;
    body.addChild(sprite);

    if (weaponSpec && weaponType) {
      primaryAttackType = weaponType;
      const turret = new Sprite(textures.weapons[weaponSpec.turret]);
      turret.anchor.set(0.5);
      turret.width = cell * 1.22;
      turret.height = cell * 1.22;
      turret.position.set(x, y);
      turret.tint = weaponSpec.tint;
      body.addChild(turret);
      weaponMounts.push({
        x,
        y: y - cell * 0.7,
        attackType: weaponType,
        weapon: BATTLE_WEAPON_LAWS[weaponType],
        cooldown: rng() * 0.42,
        turret
      });
    } else if (module.type === "engine") {
      engineMounts.push({ x, y });
    }
  });
  body.scale.set((0.7 + rng() * 0.28) * HOME_SHIP_VISUAL_SCALE);

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
  const stats = calculateShipStats(build);
  const acceleration = Math.max(30, stats.acceleration * 70);
  const maxSpeed = stats.maxSpeed * 1.08;
  const turnRate = Math.max(1.8, stats.turnRate * 1.08);
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
    attackType: primaryAttackType,
    acceleration,
    maxSpeed,
    turnRate,
    moduleCount,
    engineColor: accent,
    radius: cell * body.scale.x * 2.85,
    weaponMounts,
    engineMounts
  };
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

function getAttackTypeForModule(moduleId: string): AttackType {
  const damageType = getModule(moduleId).weapon?.damageType;
  if (damageType === "energy") return "laser";
  if (damageType === "plasma") return "plasma";
  if (damageType === "explosive") return "missile";
  return "kinetic";
}

function getModuleSpriteKeyForHome(moduleId: string): ModuleSpriteKey {
  const module = getModule(moduleId);
  if (module.type === "core") return "core";
  if (module.type === "armor") return "armor";
  if (module.type === "reactor") return "reactor";
  if (module.type === "shield") return "shield";
  if (module.type === "battery") return "battery";
  if (module.type === "engine") {
    if (moduleId === "plasma_thruster") return "plasmaThruster";
    if (moduleId === "side_thruster") return "sideThruster";
    return "ionEngine";
  }
  return "hull";
}

function getHomePanelSpriteKey(panel: PanelDef): HomePanelSpriteKey {
  return (HOME_PANEL_SPRITE_IDS as readonly string[]).includes(panel.spriteId)
    ? (panel.spriteId as HomePanelSpriteKey)
    : "single_1";
}

function getHomeCabinSpriteKey(cabin: CabinDef): HomeCabinSpriteKey {
  return cabin.spriteId && (HOME_CABIN_SPRITE_IDS as readonly string[]).includes(cabin.spriteId)
    ? (cabin.spriteId as HomeCabinSpriteKey)
    : "cabin_1x1";
}

function getCellsCenter(cells: GridCell[]) {
  const bounds = cells.reduce(
    (acc, cell) => ({
      minX: Math.min(acc.minX, cell.x),
      minY: Math.min(acc.minY, cell.y),
      maxX: Math.max(acc.maxX, cell.x),
      maxY: Math.max(acc.maxY, cell.y)
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  );
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2
  };
}

function getCabinCenter(cabin: CabinDef, position: GridCell, rotation: Rotation) {
  return getCellsCenter(getTransformedCells(cabin, position, rotation));
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
    if (rng() > 0.58) return;
    const world = getWorldMount(pos, visualRotation, mount, scale);
    const nozzleX = world.x - Math.cos(thrustRotation) * 10 * scale;
    const nozzleY = world.y - Math.sin(thrustRotation) * 10 * scale;
    const outerLength = (13 + power * 16) * scale;
    const outerHalf = (3.2 + power * 3.2) * scale;
    const innerLength = outerLength * 0.62;
    const innerHalf = outerHalf * 0.42;
    const flame = new Graphics()
      .moveTo(0, -outerHalf)
      .lineTo(-outerLength, 0)
      .lineTo(0, outerHalf)
      .closePath()
      .fill({ color: 0xff9b42, alpha: 0.14 + power * 0.13 })
      .moveTo(0, -innerHalf)
      .lineTo(-innerLength, 0)
      .lineTo(0, innerHalf)
      .closePath()
      .fill({ color: 0x6ceaff, alpha: 0.13 + power * 0.13 });
    flame.position.set(nozzleX, nozzleY);
    flame.rotation = thrustRotation;
    layer.addChild(flame);
    setTimeout(() => flame.destroy(), 70);

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
  const sparks = attackType === "missile" ? 15 : attackType === "plasma" ? 13 : 9;
  for (let i = 0; i < sparks; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 86 + Math.random() * (attackType === "missile" ? 210 : 162);
    addParticle(particles, layer, {
      pos: { ...pos },
      vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
      life: 0.24 + Math.random() * 0.28,
      size: 1.15 + Math.random() * (attackType === "missile" ? 2.2 : 1.7),
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
    spawnVfxSprite(tempSprites, layer, textures.mediumExplosion, pos, size * 0.72, 0.2, 0xffd08a, 0.6, 0.24);
    spawnVfxSprite(tempSprites, layer, textures.debrisCluster, pos, size * 0.58, 0.22, 0xffffff, 0.58, 0.18);
  } else if (attackType === "plasma") {
    spawnVfxSprite(tempSprites, layer, textures.smallExplosion, pos, size, 0.24, 0xb66cff, 0.74, 0.34);
    spawnVfxSprite(tempSprites, layer, textures.mediumExplosion, pos, size * 0.78, 0.2, 0xd4a4ff, 0.48, 0.28);
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
  const tail = projectile.smoke ? 54 : 38;
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

function seedCosmicGlows(layer: Container, width: number, height: number, rng: () => number) {
  const viewportScale = Math.max(width, height) / 1280;
  HOME_COSMIC_GLOW_CONFIGS.forEach((config) => {
    const glow = new Container() as CosmicGlow;
    const radiusX = randomRange(config.radiusX, rng);
    const radiusY = randomRange(config.radiusY, rng);
    const alphaBase = randomRange(config.alpha, rng);
    for (let i = 0; i < 5; i += 1) {
      const layerRatio = 1 - i * 0.15;
      const layerAlpha = alphaBase * (0.12 + i * 0.05);
      const haze = new Graphics()
        .ellipse(0, 0, radiusX * layerRatio, radiusY * layerRatio)
        .fill({ color: config.color, alpha: layerAlpha });
      glow.addChild(haze);
    }

    glow.alphaBase = alphaBase;
    glow.baseRotation = rng() * Math.PI;
    glow.baseScale = viewportScale * (0.88 + rng() * 0.24);
    glow.baseXFactor = randomRange(config.xFactor, rng);
    glow.baseYFactor = randomRange(config.yFactor, rng);
    glow.driftPhase = rng() * Math.PI * 2;
    glow.driftSpeed = randomRange(config.driftSpeed, rng);
    glow.driftXFactor = randomRange(config.driftXFactor, rng);
    glow.driftYFactor = randomRange(config.driftYFactor, rng);
    glow.pulsePhase = rng() * Math.PI * 2;
    glow.pulseSpeed = randomRange(config.pulseSpeed, rng);
    glow.rotationSpeed = randomRange(config.rotationSpeed, rng);
    glow.rotation = glow.baseRotation;
    glow.scale.set(glow.baseScale);
    layer.addChild(glow);
  });
}

function seedPlanets(layer: Container, planets: PlanetTexture[], rng: () => number) {
  const selectedPlanets = [...planets].sort(() => rng() - 0.5).slice(0, HOME_PLANET_LAYOUTS.length);
  const primarySide = rng() < 0.5 ? -1 : 1;
  HOME_PLANET_LAYOUTS.forEach((layout, index) => {
    const selected = selectedPlanets[index] ?? planets[index % planets.length];
    const root = new Container() as RotatingPlanet;
    const planet = new Sprite(selected.texture);
    const glow = createPlanetGlow(
      selected.texture,
      selected.glowColor,
      index === 0 ? FRONT_PLANET_GLOW_WIDTH_MULTIPLIER : 1
    );
    planet.anchor.set(0.5);
    root.glow = glow;
    root.image = planet;
    root.addChild(glow);
    root.addChild(planet);
    const side = index === 0 ? primarySide : -primarySide;
    const edgeOffset = randomRange(layout.edgeOffset, rng);
    root.alphaBase = randomRange(layout.alpha, rng);
    root.baseXFactor = side < 0 ? edgeOffset : 1 - edgeOffset;
    root.baseYFactor = randomRange(layout.yFactor, rng);
    root.baseRotation = rng() * Math.PI * 2;
    root.driftPhase = rng() * Math.PI * 2;
    root.driftSpeed = randomRange(layout.driftSpeed, rng);
    root.driftXFactor = randomRange(layout.driftXFactor, rng);
    root.driftYFactor = randomRange(layout.driftYFactor, rng);
    root.glowAlphaBoost = index === 0 ? FRONT_PLANET_GLOW_ALPHA_MULTIPLIER : 1;
    root.heightFactor = randomRange(layout.heightFactor, rng);
    root.maxWidthFactor = layout.maxWidthFactor;
    root.spinSpeed = (rng() < 0.5 ? -1 : 1) * randomRange(layout.spinSpeed, rng);
    root.widthFactor = randomRange(layout.widthFactor, rng);
    root.rotation = root.baseRotation;
    layer.addChild(root);
  });
}

function createPlanetGlow(texture: Texture, color: number, widthMultiplier = 1) {
  const sourceWidth = texture.width;
  const sourceHeight = texture.height;
  const maxSize = Math.max(sourceWidth, sourceHeight);
  const padding = Math.ceil(maxSize * PLANET_GLOW_PADDING_FACTOR * widthMultiplier);
  const softBlur = Math.max(8, Math.ceil(maxSize * PLANET_GLOW_SOFT_BLUR_FACTOR * widthMultiplier));
  const tightBlur = Math.max(3, Math.ceil(maxSize * PLANET_GLOW_TIGHT_BLUR_FACTOR * widthMultiplier));
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(sourceWidth + padding * 2);
  canvas.height = Math.ceil(sourceHeight + padding * 2);
  const context = canvas.getContext("2d");
  if (!context) return new Sprite(Texture.fromCanvas(canvas));

  const red = (color >> 16) & 0xff;
  const green = (color >> 8) & 0xff;
  const blue = color & 0xff;
  const rgba = (alpha: number) => `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  const drawMask = (target: CanvasRenderingContext2D) => {
    target.drawImage(
      texture.source.image,
      texture.frame.x,
      texture.frame.y,
      texture.frame.width,
      texture.frame.height,
      padding,
      padding,
      sourceWidth,
      sourceHeight
    );
  };
  const drawGlowLayer = (blur: number, alpha: number) => {
    const layer = document.createElement("canvas");
    layer.width = canvas.width;
    layer.height = canvas.height;
    const layerContext = layer.getContext("2d");
    if (!layerContext) return;
    layerContext.filter = `blur(${blur}px)`;
    drawMask(layerContext);
    layerContext.globalCompositeOperation = "source-in";
    layerContext.fillStyle = rgba(alpha);
    layerContext.fillRect(0, 0, layer.width, layer.height);
    context.drawImage(layer, 0, 0);
  };

  drawGlowLayer(softBlur, 0.62);
  drawGlowLayer(tightBlur, 0.86);
  context.globalCompositeOperation = "destination-out";
  drawMask(context);

  const glow = new Sprite(Texture.fromCanvas(canvas));
  glow.anchor.set(0.5);
  return glow;
}

function randomRange(range: readonly [number, number], rng: () => number) {
  return range[0] + (range[1] - range[0]) * rng();
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

async function loadStructureTextures<T extends string>(baseSrc: string, ids: readonly T[]) {
  const entries = await Promise.all(
    ids.map(async (id) => [id, await Assets.load<Texture>(`${baseSrc}/ideal/${id}.webp`)] as const)
  );
  return Object.fromEntries(entries) as Record<T, Texture>;
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
