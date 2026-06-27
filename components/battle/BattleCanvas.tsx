"use client";

import { useEffect, useRef } from "react";
import { Application, Assets, Container, Graphics, Rectangle, Sprite, Text, Texture, TilingSprite } from "pixi.js";
import type { TextStyleFontWeight } from "pixi.js";
import { getFrame, getModule, getTransformedCells } from "@/game/ship/build";
import { calculateShipStatsV2 } from "@/game/ship/statsV2";
import { getWorldMount, clampToScreenEdge, type Vec } from "@/game/battle/math";
import { applyShipPhysicsInput } from "@/game/battle/shipPhysics";
import { projectileHitsShip, resolveShipCollisions } from "@/game/battle/collision";
import { collectWeapons, rotateTurretToTarget, type WeaponState } from "@/game/battle/weapons";
import {
  createEnergySystem,
  getEnergyEfficiency,
  getEngineEnergyLoad,
  trySpendEnergy,
  updateEnergySystem,
  type EnergySystemState
} from "@/game/battle/systems/EnergySystem";
import {
  battleVfxAtlas,
  getModuleSpriteKey,
  hoverAtlas,
  moduleAtlas,
  moduleStateAtlas,
  weaponAtlas,
  weaponStateAtlas,
  type BattleVfxSpriteKey,
  type HoverSpriteKey,
  type ModuleSpriteKey,
  type WeaponSpriteKey
} from "@/game/assets/moduleSprites";
import type { ModuleDef, ShipBuild, WeaponDef } from "@/game/types";

const BACKGROUND_SCENE = { width: 2400, height: 3600 };
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

type BattleCanvasProps = {
  build: ShipBuild;
  onResult: (result: "victory" | "defeat") => void;
};

type Enemy = {
  kind: "drone" | "raider" | "bomber";
  build: ShipBuild;
  pos: Vec;
  vel: Vec;
  rotation: number;
  angularVelocity: number;
  hp: number;
  maxHp: number;
  acceleration: number;
  maxSpeed: number;
  turnRate: number;
  energy: EnergySystemState;
  mass: number;
  momentOfInertia: number;
  engineVectors: ReturnType<typeof calculateShipStatsV2>["engineVectors"];
  brakingPower: number;
  driftFactor: number;
  radius: number;
  body: Container;
  visual: ShipVisual;
  weapons: WeaponState[];
  engineMounts: Vec[];
  stats: ReturnType<typeof calculateShipStatsV2>;
};
type Projectile = {
  pos: Vec;
  vel: Vec;
  owner: "player" | "enemy";
  damageType: WeaponDef["damageType"];
  damage: number;
  radius: number;
  life: number;
  body: Sprite;
  color: number;
  smoke: boolean;
  previous: Vec;
  trail: Graphics;
};

type BattleSoundKey =
  | "autocannon"
  | "laser"
  | "plasma"
  | "missile"
  | "thruster"
  | "impactKinetic"
  | "impactEnergy"
  | "impactPlasma"
  | "impactExplosive";
type ExplosionAnimationKey = "small" | "medium" | "large" | "plasma" | "smoke" | "reactor";

const EXPLOSION_ANIMATION_ROWS: Record<ExplosionAnimationKey, { row: number; frames: number }> = {
  small: { row: 0, frames: 5 },
  medium: { row: 1, frames: 9 },
  large: { row: 2, frames: 8 },
  plasma: { row: 3, frames: 9 },
  smoke: { row: 4, frames: 6 },
  reactor: { row: 5, frames: 9 }
};

const BATTLE_AUDIO = {
  engineIdle: "/assets/audio/engine-idle-loop.mp3",
  engineThrust: "/assets/audio/engine-thrust-loop.mp3",
  thruster: "/assets/audio/thruster-burst.mp3",
  autocannon: "/assets/audio/weapon-autocannon-shot.mp3",
  laser: "/assets/audio/weapon-laser-shot.mp3",
  plasma: "/assets/audio/weapon-plasma-shot.mp3",
  missile: "/assets/audio/weapon-missile-launch.mp3",
  impactKinetic: "/assets/audio/impact-kinetic-hull.mp3",
  impactEnergy: "/assets/audio/impact-energy-shield.mp3",
  impactPlasma: "/assets/audio/impact-plasma-armor.mp3",
  impactExplosive: "/assets/audio/impact-missile-explosion.mp3"
} as const;
type Particle = {
  pos: Vec;
  vel: Vec;
  life: number;
  maxLife: number;
  size: number;
  color: number;
  alpha: number;
  body: Graphics;
  kind: "spark" | "smoke" | "flash" | "shockwave" | "debris";
};
type EnemyMarker = {
  enemy: Enemy;
  root: Container;
  plate: Graphics;
  pointer: Graphics;
  name: Text;
  hp: Text;
  distance: Text;
};

type AtlasTextures = {
  background: Texture;
  planetImages: Texture[];
  modules: StateTextureMap<ModuleSpriteKey>;
  weapons: StateTextureMap<WeaponSpriteKey>;
  hover: Record<HoverSpriteKey, Texture>;
  battleVfx: Record<BattleVfxSpriteKey, Texture>;
  aiExplosionAnimations: Record<ExplosionAnimationKey, Texture[]>;
};

type ModuleDamageState = "ideal" | "lightDamage" | "heavyDamage" | "debris";
type StateTextureMap<T extends string> = Record<ModuleDamageState, Record<T, Texture>>;
type ShipVisualPart = {
  module: ModuleDef;
  sprite: Sprite;
  weaponBaseKey?: WeaponSpriteKey;
  turret?: Sprite;
  weaponTurretKey?: WeaponSpriteKey;
};

type ShipVisual = {
  container: Container;
  turrets: Map<string, Sprite>;
  engineMounts: Vec[];
  parts: ShipVisualPart[];
  damageState: ModuleDamageState;
};

export default function BattleCanvas({ build, onResult }: BattleCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const resultRef = useRef(false);

  useEffect(() => {
    if (!hostRef.current) return;

    let destroyed = false;
    let initialized = false;
    let battleAudio: ReturnType<typeof createBattleAudio> | null = null;
    const app = new Application();
    const host = hostRef.current;
    const stats = calculateShipStatsV2(build);
    const resize = () => {
      if (!initialized) return;
      app.renderer.resize(host.clientWidth, host.clientHeight);
    };

    async function boot() {
      await app.init({
        width: host.clientWidth,
        height: host.clientHeight,
        background: "#03050c",
        antialias: true,
        resolution: Math.min(window.devicePixelRatio, 2)
      });
      if (destroyed) {
        app.destroy();
        return;
      }
      initialized = true;
      host.appendChild(app.canvas);
      window.addEventListener("resize", resize);
      const textures = await loadAtlasTextures();

      const spaceTile = new TilingSprite({
        texture: textures.background,
        width: app.screen.width,
        height: app.screen.height
      });
      spaceTile.alpha = 0.5;
      spaceTile.tileScale.set(SPACE_TILE_SCALE);
      const layers = {
        background: new Container(),
        farParticles: new Container(),
        debris: new Container(),
        ships: new Container(),
        engineVfx: new Container(),
        projectiles: new Container(),
        impactVfx: new Container(),
        explosions: new Container(),
        uiWorld: new Container(),
        screenVfx: new Container(),
        hud: new Container()
      };
      const backgroundLayers = {
        deep_space_background_dark: new Container(),
        nebula_layer_blue: new Container(),
        nebula_layer_purple: new Container(),
        battle_planets_layer: new Container(),
        far_stars_layer: new Container(),
        close_stars_layer: new Container(),
        asteroid_debris_layer: new Container(),
        dust_particles_layer: new Container(),
        battlefield_grid_subtle: new Container(),
        space_clouds_soft: new Container()
      };
      const backgroundGradient = new Graphics();
      let backgroundGradientWidth = 0;
      let backgroundGradientHeight = 0;
      const refreshBackgroundGradient = () => {
        if (backgroundGradientWidth === app.screen.width && backgroundGradientHeight === app.screen.height) return;
        backgroundGradientWidth = app.screen.width;
        backgroundGradientHeight = app.screen.height;
        drawBattleBackgroundGradient(backgroundGradient, app.screen.width, app.screen.height);
      };
      const damageFlash = new Graphics();
      refreshBackgroundGradient();
      backgroundLayers.deep_space_background_dark.addChild(backgroundGradient, spaceTile);
      layers.background.addChild(
        backgroundLayers.deep_space_background_dark,
        backgroundLayers.nebula_layer_blue,
        backgroundLayers.nebula_layer_purple,
        backgroundLayers.battle_planets_layer,
        backgroundLayers.far_stars_layer,
        backgroundLayers.close_stars_layer,
        backgroundLayers.asteroid_debris_layer,
        backgroundLayers.dust_particles_layer,
        backgroundLayers.battlefield_grid_subtle,
        backgroundLayers.space_clouds_soft
      );
      layers.screenVfx.addChild(damageFlash);
      app.stage.addChild(
        layers.background,
        layers.farParticles,
        layers.debris,
        layers.engineVfx,
        layers.ships,
        layers.projectiles,
        layers.impactVfx,
        layers.explosions,
        layers.uiWorld,
        layers.screenVfx,
        layers.hud
      );
      seedNebulaLayer(backgroundLayers.nebula_layer_blue, 0x1a5f9f, 0.08);
      seedNebulaLayer(backgroundLayers.nebula_layer_purple, 0x5c3b8f, 0.06);
      seedStarLayer(backgroundLayers.far_stars_layer, 140, 0.08, 1.2);
      seedStarLayer(backgroundLayers.close_stars_layer, 65, 0.12, 1.7);
      seedAsteroidDebris(backgroundLayers.asteroid_debris_layer);
      seedDustParticles(backgroundLayers.dust_particles_layer);
      seedBattlefieldGrid(backgroundLayers.battlefield_grid_subtle);
      seedSpaceClouds(backgroundLayers.space_clouds_soft);
      seedBattlePlanets(backgroundLayers.battle_planets_layer, textures.planetImages, app.screen.width, app.screen.height);

      const ship = buildShipGraphic(build, textures);
      layers.ships.addChild(ship.container);

      const player = {
        build,
        pos: { x: 0, y: 0 },
        vel: { x: 0, y: 0 },
        hp: stats.hp,
        maxHp: stats.hp,
        rotation: -Math.PI / 2,
        angularVelocity: 0,
        maxSpeed: stats.maxSpeed,
        acceleration: Math.max(35, stats.acceleration * 70),
        turnRate: Math.max(1.8, stats.turnRate),
        energy: createEnergySystem(stats),
        mass: stats.mass,
        momentOfInertia: stats.momentOfInertia,
        engineVectors: stats.engineVectors,
        brakingPower: stats.brakingPower,
        driftFactor: stats.driftFactor
      };
      const joystick = { active: false, origin: { x: 0, y: 0 }, value: { x: 0, y: 0 } };
      const enemies: Enemy[] = [
        makeEnemy("drone", -210, -260, textures),
        makeEnemy("drone", 190, -310, textures),
        makeEnemy("raider", 250, -460, textures),
        makeEnemy("bomber", -260, -540, textures)
      ];
      enemies.forEach((enemy) => layers.ships.addChild(enemy.body));
      const enemyMarkers = enemies.map((enemy) => makeEnemyMarker(enemy));
      enemyMarkers.forEach((marker) => layers.uiWorld.addChild(marker.root));

      const projectiles: Projectile[] = [];
      const particles: Particle[] = [];
      const weapons = collectWeapons(build, ship.turrets);
      const audio = createBattleAudio();
      battleAudio = audio;
      let screenShake = 0;
      let damagePulse = 0;
      let previousPlayerHp = player.hp;

      const joystickBase = new Graphics()
        .circle(0, 0, 48)
        .stroke({ color: 0x49d7ff, alpha: 0.32, width: 2 })
        .fill({ color: 0x49d7ff, alpha: 0.08 });
      const joystickKnob = new Graphics()
        .circle(0, 0, 22)
        .fill({ color: 0x49d7ff, alpha: 0.45 });
      joystickBase.visible = false;
      joystickKnob.visible = false;
      layers.hud.addChild(joystickBase, joystickKnob);

      app.stage.eventMode = "static";
      app.stage.hitArea = app.screen;
      app.stage.on("pointerdown", (event) => {
        audio.unlock();
        audio.play("thruster");
        joystick.active = true;
        joystick.origin = { x: event.global.x, y: event.global.y };
        joystick.value = { x: 0, y: 0 };
        joystickBase.position.set(event.global.x, event.global.y);
        joystickKnob.position.set(event.global.x, event.global.y);
        joystickBase.visible = true;
        joystickKnob.visible = true;
      });
      app.stage.on("pointermove", (event) => {
        if (!joystick.active) return;
        const dx = event.global.x - joystick.origin.x;
        const dy = event.global.y - joystick.origin.y;
        const dist = Math.hypot(dx, dy);
        const limit = 52;
        const scale = dist > limit ? limit / dist : 1;
        joystick.value = { x: (dx * scale) / limit, y: (dy * scale) / limit };
        joystickKnob.position.set(joystick.origin.x + dx * scale, joystick.origin.y + dy * scale);
      });
      app.stage.on("pointerup", releaseJoystick);
      app.stage.on("pointerupoutside", releaseJoystick);

      function releaseJoystick() {
        joystick.active = false;
        joystick.value = { x: 0, y: 0 };
        joystickBase.visible = false;
        joystickKnob.visible = false;
      }

      app.ticker.add(() => {
        const dt = Math.min(app.ticker.deltaMS / 1000, 0.033);
        if (resultRef.current) return;

        updatePlayer(dt);
        updateEnemies(dt);
        resolveShipCollisions(player, ship.container, enemies);
        updateWeapons(dt);
        updateEnemyWeapons(dt);
        updateProjectiles(dt);
        updateParticles(dt);
        updateCamera();
        updateEnemyMarkers();
        updateDamageFlash(dt);

        if (screenShake > 0) screenShake = Math.max(0, screenShake - dt);
        if (player.hp <= 0) finish("defeat");
        if (enemies.every((enemy) => enemy.hp <= 0)) finish("victory");
      });

      function updatePlayer(dt: number) {
        const inputPower = Math.min(1, Math.hypot(joystick.value.x, joystick.value.y));
        updateEnergySystem(player.energy, dt, [
          { id: "engines", priority: "engines", amountPerSecond: getEngineEnergyLoad(stats, inputPower) },
          { id: "shields", priority: "shields", amountPerSecond: stats.shieldRegen * 0.2 }
        ]);
        const engineEfficiency = getEnergyEfficiency(player.energy, "engines");
        if (inputPower > 0.05) {
          applyShipPhysicsInput(player, { inputVector: joystick.value, powerEfficiency: engineEfficiency }, dt);
          spawnEngineGlows(layers.engineVfx, player.pos, player.rotation, ship.engineMounts, inputPower * engineEfficiency);
        } else {
          applyShipPhysicsInput(player, { inputVector: { x: 0, y: 0 } }, dt);
        }
        audio.setEnginePower(inputPower * engineEfficiency);
        applyShipDamageState(ship, textures, getShipDamageState(player.hp, player.maxHp));

        ship.container.position.set(player.pos.x, player.pos.y);
        ship.container.rotation = player.rotation + Math.PI / 2;
      }

      function updateWeapons(dt: number) {
        weapons.forEach((weaponState) => {
          weaponState.cooldown -= dt;
          const target = nearestEnemy(player.pos, enemies, weaponState.weapon.range);
          if (!target || weaponState.cooldown > 0) return;
          if (!trySpendEnergy(player.energy, "weapons", weaponState.weapon.energyPerShot)) {
            weaponState.cooldown = 0.18;
            return;
          }
          rotateTurretToTarget(weaponState, ship.container.rotation, player.pos, target.pos);
          weaponState.cooldown = Math.max(0.12, 1 / weaponState.weapon.fireRate);
          const origin = getWorldMount(player.pos, player.rotation, weaponState.mount);
          audio.play(getWeaponSoundKey(weaponState.weapon.damageType));

          if (weaponState.weapon.damageType === "energy") {
            target.hp -= weaponState.weapon.damage;
            spawnBeam(layers.impactVfx, particles, textures.battleVfx, origin, target.pos);
            audio.play("impactEnergy");
            screenShake = 0.08;
            return;
          }

          const dx = target.pos.x - origin.x;
          const dy = target.pos.y - origin.y;
          const dist = Math.max(1, Math.hypot(dx, dy));
          const speed = weaponState.weapon.projectileSpeed ?? 460;
          const projectile = makeProjectile(
            textures.battleVfx[getProjectileSpriteKey(weaponState.weapon.damageType)],
            "player",
            origin.x,
            origin.y,
            (dx / dist) * speed,
            (dy / dist) * speed,
            weaponState.weapon.damageType,
            weaponState.weapon.damage,
            weaponState.weapon.damageType === "explosive" ? 7 : 4,
            weaponState.weapon.damageType === "plasma" ? 0x8b5cff : 0x49d7ff,
            weaponState.weapon.damageType === "explosive"
          );
          if (weaponState.weapon.damageType === "kinetic") {
            spawnShellCasing(layers.debris, textures.battleVfx.shellCasing, origin, player.rotation);
          }
          projectiles.push(projectile);
          layers.projectiles.addChild(projectile.trail, projectile.body);
        });
      }

      function updateEnemies(dt: number) {
        enemies.forEach((enemy) => {
          if (enemy.hp <= 0) {
            applyShipDamageState(enemy.visual, textures, "debris");
            enemy.body.alpha = 0.46;
            return;
          }
          applyShipDamageState(enemy.visual, textures, getShipDamageState(enemy.hp, enemy.maxHp));
          const dx = player.pos.x - enemy.pos.x;
          const dy = player.pos.y - enemy.pos.y;
          const dist = Math.max(1, Math.hypot(dx, dy));
          const ideal = enemy.kind === "bomber" ? 360 : 210;
          const desired = Math.atan2(dy, dx) + (dist < ideal ? Math.PI : 0);
          const inputPower = dist > ideal ? 0.9 : 0.45;
          updateEnergySystem(enemy.energy, dt, [
            { id: "engines", priority: "engines", amountPerSecond: getEngineEnergyLoad(enemy.stats, inputPower) },
            { id: "shields", priority: "shields", amountPerSecond: enemy.stats.shieldRegen * 0.2 }
          ]);
          const engineEfficiency = getEnergyEfficiency(enemy.energy, "engines");
          applyShipPhysicsInput(
            enemy,
            {
              inputVector: { x: Math.cos(desired) * inputPower, y: Math.sin(desired) * inputPower },
              powerEfficiency: engineEfficiency
            },
            dt
          );
          spawnEngineGlows(layers.engineVfx, enemy.pos, enemy.rotation, enemy.engineMounts, inputPower * engineEfficiency);
          enemy.body.position.set(enemy.pos.x, enemy.pos.y);
          enemy.body.rotation = enemy.rotation + Math.PI / 2;
        });
      }

      function updateEnemyWeapons(dt: number) {
        enemies.forEach((enemy) => {
          if (enemy.hp <= 0) return;
          enemy.weapons.forEach((weaponState) => {
            weaponState.cooldown -= dt;
            const dx = player.pos.x - enemy.pos.x;
            const dy = player.pos.y - enemy.pos.y;
            const dist = Math.hypot(dx, dy);
            if (weaponState.cooldown > 0 || dist > weaponState.weapon.range) return;
            if (!trySpendEnergy(enemy.energy, "weapons", weaponState.weapon.energyPerShot)) {
              weaponState.cooldown = 0.22;
              return;
            }
            rotateTurretToTarget(weaponState, enemy.body.rotation, enemy.pos, player.pos);
            weaponState.cooldown = Math.max(0.12, 1 / weaponState.weapon.fireRate);
            const origin = getWorldMount(enemy.pos, enemy.rotation, weaponState.mount);
            audio.play(getWeaponSoundKey(weaponState.weapon.damageType), 0.58);

            if (weaponState.weapon.damageType === "energy") {
              player.hp -= weaponState.weapon.damage;
              spawnBeam(layers.impactVfx, particles, textures.battleVfx, origin, player.pos);
              audio.play("impactEnergy", 0.7);
              screenShake = 0.08;
              return;
            }

            const speed = weaponState.weapon.projectileSpeed ?? 360;
            const projectile = makeProjectile(
              textures.battleVfx[getProjectileSpriteKey(weaponState.weapon.damageType)],
              "enemy",
              origin.x,
              origin.y,
              (dx / dist) * speed,
              (dy / dist) * speed,
              weaponState.weapon.damageType,
              weaponState.weapon.damage,
              weaponState.weapon.damageType === "explosive" ? 6 : 4,
              0xff596a,
              weaponState.weapon.damageType === "explosive"
            );
            if (weaponState.weapon.damageType === "kinetic") {
              spawnShellCasing(layers.debris, textures.battleVfx.shellCasing, origin, enemy.rotation);
            }
            projectiles.push(projectile);
            layers.projectiles.addChild(projectile.trail, projectile.body);
          });
        });
      }

      function updateProjectiles(dt: number) {
        for (let i = projectiles.length - 1; i >= 0; i -= 1) {
          const projectile = projectiles[i];
          projectile.life -= dt;
          projectile.previous = { x: projectile.pos.x, y: projectile.pos.y };
          projectile.pos.x += projectile.vel.x * dt;
          projectile.pos.y += projectile.vel.y * dt;
          projectile.body.position.set(projectile.pos.x, projectile.pos.y);
          projectile.body.rotation = Math.atan2(projectile.vel.y, projectile.vel.x);
          drawProjectileTrail(projectile);
          if (projectile.smoke && Math.random() < 0.7) {
            spawnSmoke(particles, layers.debris, projectile.previous, 0.55);
          }

          let hit = false;
          enemies.forEach((enemy) => {
            if (hit || enemy.hp <= 0) return;
            if (
              projectile.owner === "player" &&
              projectileHitsShip(projectile, enemy.build, enemy.pos, enemy.rotation)
            ) {
              enemy.hp -= projectile.damage;
              spawnImpact(particles, layers.impactVfx, textures.battleVfx, projectile.pos, projectile.color);
              audio.play(getImpactSoundKey(projectile.damageType));
              hit = true;
            }
          });

          if (
            projectile.owner === "enemy" &&
            projectileHitsShip(projectile, player.build, player.pos, player.rotation)
          ) {
            player.hp -= projectile.damage;
            spawnImpact(particles, layers.impactVfx, textures.battleVfx, projectile.pos, 0xff596a);
            audio.play(getImpactSoundKey(projectile.damageType), 0.76);
            screenShake = 0.12;
            hit = true;
          }

          if (hit || projectile.life <= 0) {
            if (hit) {
              spawnExplosion(
                particles,
                layers.explosions,
                textures.battleVfx,
                textures.aiExplosionAnimations,
                getExplosionAnimationKey(projectile.damageType, projectile.smoke),
                projectile.pos,
                projectile.smoke ? 34 : 22
              );
            }
            projectile.body.destroy();
            projectile.trail.destroy();
            projectiles.splice(i, 1);
          }
        }
      }

      function updateParticles(dt: number) {
        for (let i = particles.length - 1; i >= 0; i -= 1) {
          const particle = particles[i];
          particle.life -= dt;
          particle.pos.x += particle.vel.x * dt;
          particle.pos.y += particle.vel.y * dt;
          const t = Math.max(0, particle.life / particle.maxLife);
          particle.body.position.set(particle.pos.x, particle.pos.y);
          particle.body.alpha = particle.alpha * t;
          particle.body.scale.set(particle.kind === "shockwave" ? 1 + (1 - t) * 2.2 : 1 + (1 - t) * 0.7);
          if (particle.life <= 0) {
            particle.body.destroy();
            particles.splice(i, 1);
          }
        }
      }

      function updateCamera() {
        const shakeX = screenShake > 0 ? (Math.random() - 0.5) * 10 : 0;
        const shakeY = screenShake > 0 ? (Math.random() - 0.5) * 10 : 0;
        const cx = app.screen.width / 2 - player.pos.x + shakeX;
        const cy = app.screen.height / 2 - player.pos.y + shakeY;
        layers.debris.position.set(cx, cy);
        layers.ships.position.set(cx, cy);
        layers.engineVfx.position.set(cx, cy);
        layers.projectiles.position.set(cx, cy);
        layers.impactVfx.position.set(cx, cy);
        layers.explosions.position.set(cx, cy);
        refreshBackgroundGradient();
        spaceTile.width = app.screen.width;
        spaceTile.height = app.screen.height;
        spaceTile.tilePosition.set(player.pos.x * -0.025, player.pos.y * -0.025);
        setParallax(backgroundLayers.nebula_layer_blue, cx, cy, 0.035);
        setParallax(backgroundLayers.nebula_layer_purple, cx, cy, 0.055);
        setParallax(backgroundLayers.battle_planets_layer, cx, cy, 0.032);
        setParallax(backgroundLayers.far_stars_layer, cx, cy, 0.08);
        setParallax(backgroundLayers.close_stars_layer, cx, cy, 0.16);
        setParallax(backgroundLayers.asteroid_debris_layer, cx, cy, 0.22);
        setParallax(backgroundLayers.dust_particles_layer, cx, cy, 0.28);
        setParallax(backgroundLayers.battlefield_grid_subtle, cx, cy, 0.38);
        setParallax(backgroundLayers.space_clouds_soft, cx, cy, 0.05);
      }

      function updateEnemyMarkers() {
        enemyMarkers.forEach((marker) => {
          const enemy = marker.enemy;
          marker.root.visible = enemy.hp > 0;
          if (!marker.root.visible) return;

          const distance = Math.hypot(enemy.pos.x - player.pos.x, enemy.pos.y - player.pos.y);
          const sx = layers.ships.position.x + enemy.pos.x;
          const sy = layers.ships.position.y + enemy.pos.y;
          const padding = 20;
          const isVisible = sx >= padding && sx <= app.screen.width - padding && sy >= padding && sy <= app.screen.height - padding;
          const hpPercent = Math.max(0, Math.ceil((enemy.hp / enemy.maxHp) * 100));

          marker.name.text = enemy.build.name;
          marker.hp.text = `${hpPercent}% hull`;
          marker.distance.text = `${Math.round(distance)}m`;

          if (isVisible) {
            marker.root.position.set(sx, sy - enemy.radius - 38);
            marker.root.alpha = 0.95;
            marker.name.visible = true;
            marker.hp.visible = true;
            marker.pointer.visible = false;
            drawMarkerPlate(marker.plate, 92, 44, 0x07111f, 0x49d7ff, 0.18);
            marker.name.position.set(0, -13);
            marker.hp.position.set(0, 0);
            marker.distance.position.set(0, 14);
            return;
          }

          const centerX = app.screen.width / 2;
          const centerY = app.screen.height / 2;
          const angle = Math.atan2(sy - centerY, sx - centerX);
          const edge = clampToScreenEdge(sx, sy, app.screen.width, app.screen.height, 24);
          marker.root.position.set(edge.x, edge.y);
          marker.root.alpha = 1;
          marker.name.visible = false;
          marker.hp.visible = false;
          marker.pointer.visible = true;
          marker.pointer.rotation = angle + Math.PI / 2;
          drawMarkerPlate(marker.plate, 58, 34, 0x12070b, 0xff596a, 0.32);
          marker.distance.position.set(0, 6);
        });
      }

      function updateDamageFlash(dt: number) {
        if (player.hp < previousPlayerHp) {
          const healthRatio = Math.max(0, player.hp / player.maxHp);
          damagePulse = Math.max(damagePulse, 0.35 + (1 - healthRatio) * 0.55);
        }
        previousPlayerHp = player.hp;
        damagePulse = Math.max(0, damagePulse - dt * 1.9);
        drawDamageFlash(damageFlash, app.screen.width, app.screen.height, damagePulse);
      }

      function finish(result: "victory" | "defeat") {
        if (resultRef.current) return;
        resultRef.current = true;
        audio.setEnginePower(0);
        audio.play("impactExplosive");
        spawnExplosion(
          particles,
          layers.explosions,
          textures.battleVfx,
          textures.aiExplosionAnimations,
          result === "defeat" ? "reactor" : "large",
          player.pos,
          result === "defeat" ? 70 : 30
        );
        onResult(result);
      }
    }

    boot();

    return () => {
      destroyed = true;
      resultRef.current = false;
      window.removeEventListener("resize", resize);
      battleAudio?.destroy();
      if (initialized) app.destroy();
    };
  }, [build, onResult]);

  return <div ref={hostRef} className="battle-canvas" />;
}

async function loadAtlasTextures(): Promise<AtlasTextures> {
  const backgroundSrc = SPACE_TILE_SRCS[Math.floor(Math.random() * SPACE_TILE_SRCS.length)];
  const planetSrcs = pickBattlePlanetSources();
  const [background, planetImages, moduleStateBase, weaponStateBase, hoverBase, battleVfxBase, explosionBase] = await Promise.all([
    Assets.load<Texture>(backgroundSrc),
    Promise.all(planetSrcs.map((src) => Assets.load<Texture>(src))),
    Assets.load<Texture>(moduleStateAtlas.src),
    Assets.load<Texture>(weaponStateAtlas.src),
    Assets.load<Texture>(hoverAtlas.src),
    Assets.load<Texture>(battleVfxAtlas.src),
    Assets.load<Texture>("/assets/generated/ai/explosion-ai-effects-atlas.png")
  ]);

  return {
    background,
    planetImages,
    modules: sliceStateAtlas(moduleStateBase, moduleAtlas),
    weapons: sliceStateAtlas(weaponStateBase, weaponAtlas),
    hover: sliceAtlas(hoverBase, hoverAtlas),
    battleVfx: sliceAtlas(battleVfxBase, battleVfxAtlas, 18),
    aiExplosionAnimations: sliceExplosionAnimations(explosionBase)
  };
}

function pickBattlePlanetSources() {
  const shuffled = [...PLANET_SRCS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 2 + Math.floor(Math.random() * 3));
}

function sliceExplosionAnimations(base: Texture): Record<ExplosionAnimationKey, Texture[]> {
  const frameWidth = 256;
  const frameHeight = 256;
  return Object.fromEntries(
    Object.entries(EXPLOSION_ANIMATION_ROWS).map(([key, animation]) => [
      key,
      Array.from({ length: animation.frames }, (_, col) =>
        new Texture({
          source: base.source,
          frame: new Rectangle(col * frameWidth, animation.row * frameHeight, frameWidth, frameHeight)
        })
      )
    ])
  ) as Record<ExplosionAnimationKey, Texture[]>;
}

function sliceStateAtlas<T extends string>(
  base: Texture,
  atlas: {
    rows: number;
    frameWidth: number;
    frameHeight: number;
    cells: Record<T, { col: number; row: number }>;
  }
): StateTextureMap<T> {
  return {
    ideal: sliceAtlas(base, atlas, 0, 0),
    lightDamage: sliceAtlas(base, atlas, 0, 1),
    heavyDamage: sliceAtlas(base, atlas, 0, 2),
    debris: sliceAtlas(base, atlas, 0, 3)
  };
}

function sliceAtlas<T extends string>(
  base: Texture,
  atlas: {
    rows: number;
    frameWidth: number;
    frameHeight: number;
    cells: Record<T, { col: number; row: number }>;
  },
  inset = 0,
  stateRowOffset = 0
) {
  const textures = {} as Record<T, Texture>;
  (Object.keys(atlas.cells) as T[]).forEach((key) => {
    const cell = atlas.cells[key];
    textures[key] = new Texture({
      source: base.source,
      frame: new Rectangle(
        cell.col * atlas.frameWidth + inset,
        (cell.row + stateRowOffset * atlas.rows) * atlas.frameHeight + inset,
        atlas.frameWidth - inset * 2,
        atlas.frameHeight - inset * 2
      )
    });
  });
  return textures;
}

function buildShipGraphic(build: ShipBuild, textures: AtlasTextures): ShipVisual {
  const container = new Container();
  const turrets = new Map<string, Sprite>();
  const engineMounts: Vec[] = [];
  const parts: ShipVisualPart[] = [];
  const frame = getFrame(build.frameId);
  const cell = 26;
  const centerX = (frame.size.width - 1) / 2;
  const centerY = (frame.size.height - 1) / 2;
  build.modules.forEach((installed) => {
    const module = getModule(installed.moduleId);
    getTransformedCells(module, installed.position, installed.rotation).forEach((shipCell) => {
      const x = (shipCell.x - centerX) * cell;
      const y = (shipCell.y - centerY) * cell;
      const hover = new Sprite(textures.hover.ring);
      hover.anchor.set(0.5);
      hover.width = cell * 1.82;
      hover.height = cell * 1.82;
      hover.alpha = 0.16;
      hover.position.set(x, y + 2);
      container.addChild(hover);

      const weaponBaseKey = module.type === "weapon" ? getWeaponBaseKey(module.id) : undefined;
      const sprite = new Sprite(
        weaponBaseKey ? textures.weapons.ideal[weaponBaseKey] : textures.modules.ideal[getModuleSpriteKey(module)]
      );
      sprite.anchor.set(0.5);
      sprite.width = module.type === "weapon" ? cell * 1.72 : cell * 1.82;
      sprite.height = module.type === "weapon" ? cell * 1.72 : cell * 1.82;
      sprite.position.set(x, y);
      if (module.id === "plasma_thruster") sprite.tint = 0xd8a0ff;
      if (module.id === "side_thruster") sprite.tint = 0xffc078;
      container.addChild(sprite);
      if (module.type === "engine") engineMounts.push({ x, y });

      if (module.type === "weapon") {
        const weaponTurretKey = getWeaponTurretKey(module.id);
        const turret = new Sprite(textures.weapons.ideal[weaponTurretKey]);
        turret.anchor.set(0.5);
        turret.width = cell * 1.52;
        turret.height = cell * 1.52;
        turret.position.set(x, y);
        if (module.id === "laser_turret") turret.tint = 0x8befff;
        if (module.id === "plasma_cannon") turret.tint = 0xc98cff;
        if (module.id === "missile_pod") turret.tint = 0xffd080;
        container.addChild(turret);
        turrets.set(installed.instanceId, turret);
        parts.push({ module, sprite, weaponBaseKey, turret, weaponTurretKey });
      } else {
        parts.push({ module, sprite });
      }
    });
  });
  return { container, turrets, engineMounts, parts, damageState: "ideal" };
}

function getShipDamageState(hp: number, maxHp: number): ModuleDamageState {
  const ratio = maxHp > 0 ? hp / maxHp : 0;
  if (ratio <= 0) return "debris";
  if (ratio < 0.34) return "heavyDamage";
  if (ratio < 0.68) return "lightDamage";
  return "ideal";
}

function applyShipDamageState(visual: ShipVisual, textures: AtlasTextures, state: ModuleDamageState) {
  if (visual.damageState === state) return;
  visual.parts.forEach((part) => {
    if (part.weaponBaseKey) {
      part.sprite.texture = textures.weapons[state][part.weaponBaseKey];
      if (part.turret && part.weaponTurretKey) {
        part.turret.texture = textures.weapons[state][part.weaponTurretKey];
      }
      return;
    }
    part.sprite.texture = textures.modules[state][getModuleSpriteKey(part.module)];
  });
  visual.damageState = state;
}

function getWeaponBaseKey(moduleId: string): WeaponSpriteKey {
  if (moduleId === "laser_turret") return "laserBase";
  if (moduleId === "plasma_cannon") return "plasmaBase";
  if (moduleId === "missile_pod") return "missileBase";
  return "autocannonBase";
}

function getWeaponTurretKey(moduleId: string): WeaponSpriteKey {
  if (moduleId === "laser_turret") return "laserTurret";
  if (moduleId === "plasma_cannon") return "plasmaTurret";
  if (moduleId === "missile_pod") return "missileTurret";
  return "autocannonTurret";
}

function makeEnemy(
  kind: Enemy["kind"],
  x: number,
  y: number,
  textures: AtlasTextures
): Enemy {
  const build = makeEnemyBuild(kind);
  const stats = calculateShipStatsV2(build);
  const radius = kind === "drone" ? 28 : kind === "raider" ? 40 : 48;
  const visual = buildShipGraphic(build, textures);
  const body = visual.container;
  body.alpha = 0.92;
  body.position.set(x, y);
  return {
    kind,
    build,
    pos: { x, y },
    vel: { x: 0, y: 0 },
    rotation: Math.PI / 2,
    angularVelocity: 0,
    hp: stats.hp,
    maxHp: stats.hp,
    acceleration: Math.max(30, stats.acceleration * 70),
    maxSpeed: stats.maxSpeed,
    turnRate: Math.max(1.5, stats.turnRate),
    energy: createEnergySystem(stats),
    mass: stats.mass,
    momentOfInertia: stats.momentOfInertia,
    engineVectors: stats.engineVectors,
    brakingPower: stats.brakingPower,
    driftFactor: stats.driftFactor,
    radius,
    body,
    visual,
    weapons: collectWeapons(build, visual.turrets),
    engineMounts: visual.engineMounts,
    stats
  };
}

function makeEnemyMarker(enemy: Enemy): EnemyMarker {
  const root = new Container();
  const plate = new Graphics();
  const pointer = new Graphics()
    .moveTo(0, -9)
    .lineTo(8, 7)
    .lineTo(0, 4)
    .lineTo(-8, 7)
    .closePath()
    .fill({ color: 0xff596a, alpha: 0.96 })
    .stroke({ color: 0xffffff, alpha: 0.42, width: 1 });
  pointer.position.set(0, -12);

  const name = makeMarkerText(enemy.build.name, 11, 0xedf7ff, "700");
  const hp = makeMarkerText("", 9, 0x8fa4b8, "500");
  const distance = makeMarkerText("", 10, 0xffffff, "700");

  root.addChild(plate, pointer, name, hp, distance);
  return { enemy, root, plate, pointer, name, hp, distance };
}

function makeMarkerText(text: string, fontSize: number, fill: number, fontWeight: TextStyleFontWeight) {
  const label = new Text({
    text,
    style: {
      fill,
      fontFamily: "Arial, Helvetica, sans-serif",
      fontSize,
      fontWeight,
      letterSpacing: 0
    }
  });
  label.anchor.set(0.5);
  return label;
}

function drawMarkerPlate(
  plate: Graphics,
  width: number,
  height: number,
  fill: number,
  stroke: number,
  strokeAlpha: number
) {
  plate
    .clear()
    .roundRect(-width / 2, -height / 2, width, height, 9)
    .fill({ color: fill, alpha: 0.78 })
    .stroke({ color: stroke, alpha: strokeAlpha, width: 1 });
}

function drawDamageFlash(graphics: Graphics, width: number, height: number, pulse: number) {
  graphics.clear();
  if (pulse <= 0.01) return;

  const intensity = Math.min(1, pulse);
  const edge = 28 + intensity * 52;
  const steps = 10;
  const stepSize = edge / steps;

  for (let i = 0; i < steps; i += 1) {
    const inset = i * stepSize;
    const band = Math.ceil(stepSize) + 1;
    const fade = 1 - i / steps;
    const alpha = (0.03 + intensity * 0.18) * fade * fade;

    graphics
      .rect(inset, inset, width - inset * 2, band)
      .fill({ color: 0xff1028, alpha })
      .rect(inset, height - inset - band, width - inset * 2, band)
      .fill({ color: 0xff1028, alpha })
      .rect(inset, inset, band, height - inset * 2)
      .fill({ color: 0xff1028, alpha })
      .rect(width - inset - band, inset, band, height - inset * 2)
      .fill({ color: 0xff1028, alpha });
  }

  graphics
    .rect(0, 0, width, height)
    .stroke({ color: 0xff596a, alpha: 0.2 + intensity * 0.38, width: 2 + intensity * 4 });
}

function makeEnemyBuild(kind: Enemy["kind"]): ShipBuild {
  if (kind === "drone") {
    return {
      schemaVersion: 3,
      id: "enemy-drone",
      name: "Drone",
      frameId: "enemy_drone_frame",
      panels: [],
      modules: [
        { instanceId: "d-core", moduleId: "core_mk1", position: { x: 1, y: 1 }, rotation: 0 },
        { instanceId: "d-reactor", moduleId: "small_reactor", position: { x: 0, y: 1 }, rotation: 0 },
        { instanceId: "d-engine", moduleId: "ion_engine", position: { x: 1, y: 2 }, rotation: 0 },
        { instanceId: "d-gun", moduleId: "autocannon", position: { x: 1, y: 0 }, rotation: 0 },
        { instanceId: "d-hull", moduleId: "hull_block", position: { x: 2, y: 1 }, rotation: 0 }
      ]
    };
  }

  if (kind === "raider") {
    return {
      schemaVersion: 3,
      id: "enemy-raider",
      name: "Raider",
      frameId: "enemy_raider_frame",
      panels: [],
      modules: [
        { instanceId: "r-core", moduleId: "core_mk1", position: { x: 1, y: 2 }, rotation: 0 },
        { instanceId: "r-reactor", moduleId: "small_reactor", position: { x: 2, y: 2 }, rotation: 0 },
        { instanceId: "r-engine-l", moduleId: "ion_engine", position: { x: 1, y: 4 }, rotation: 0 },
        { instanceId: "r-engine-r", moduleId: "ion_engine", position: { x: 2, y: 4 }, rotation: 0 },
        { instanceId: "r-gun", moduleId: "autocannon", position: { x: 1, y: 1 }, rotation: 0 },
        { instanceId: "r-laser", moduleId: "laser_turret", position: { x: 2, y: 1 }, rotation: 0 },
        { instanceId: "r-shield", moduleId: "shield_generator", position: { x: 1, y: 3 }, rotation: 0 }
      ]
    };
  }

  return {
    schemaVersion: 3,
    id: "enemy-bomber",
    name: "Bomber",
    frameId: "enemy_bomber_frame",
    panels: [],
    modules: [
      { instanceId: "b-core", moduleId: "core_mk1", position: { x: 2, y: 2 }, rotation: 0 },
      { instanceId: "b-reactor", moduleId: "small_reactor", position: { x: 2, y: 3 }, rotation: 0 },
      { instanceId: "b-engine", moduleId: "plasma_thruster", position: { x: 1, y: 3 }, rotation: 0 },
      { instanceId: "b-missile-l", moduleId: "missile_pod", position: { x: 1, y: 1 }, rotation: 0 },
      { instanceId: "b-missile-r", moduleId: "missile_pod", position: { x: 3, y: 1 }, rotation: 0 },
      { instanceId: "b-armor", moduleId: "light_armor", position: { x: 2, y: 1 }, rotation: 0 },
      { instanceId: "b-hull-l", moduleId: "hull_block", position: { x: 1, y: 2 }, rotation: 0 },
      { instanceId: "b-hull-r", moduleId: "hull_block", position: { x: 3, y: 2 }, rotation: 0 }
    ]
  };
}

function makeProjectile(
  texture: Texture,
  owner: "player" | "enemy",
  x: number,
  y: number,
  vx: number,
  vy: number,
  damageType: WeaponDef["damageType"],
  damage: number,
  radius: number,
  color = 0x49d7ff,
  smoke = false
): Projectile {
  const body = new Sprite(texture);
  body.anchor.set(0.5);
  body.width = smoke ? 34 : 28;
  body.height = smoke ? 18 : 16;
  body.rotation = Math.atan2(vy, vx);
  if (owner === "enemy") body.tint = 0xff7884;
  const trail = new Graphics();
  body.position.set(x, y);
  return {
    pos: { x, y },
    vel: { x: vx, y: vy },
    owner,
    damageType,
    damage,
    radius,
    life: 2.6,
    body,
    color,
    smoke,
    previous: { x, y },
    trail
  };
}

function getProjectileSpriteKey(damageType: WeaponDef["damageType"]): BattleVfxSpriteKey {
  if (damageType === "explosive") return "missileProjectile";
  if (damageType === "plasma" || damageType === "energy" || damageType === "emp") {
    return "plasmaProjectile";
  }
  return "kineticProjectile";
}

function getExplosionAnimationKey(damageType: WeaponDef["damageType"], smoke: boolean): ExplosionAnimationKey {
  if (smoke || damageType === "explosive") return "medium";
  if (damageType === "plasma" || damageType === "emp" || damageType === "thermal") return "plasma";
  if (damageType === "kinetic") return "small";
  return "small";
}

function spawnShellCasing(layer: Container, texture: Texture, origin: Vec, rotation: number) {
  const casing = new Sprite(texture);
  casing.anchor.set(0.5);
  casing.width = 14;
  casing.height = 18;
  casing.rotation = rotation + Math.PI / 2 + (Math.random() - 0.5) * 0.8;
  casing.position.set(origin.x + Math.random() * 8 - 4, origin.y + Math.random() * 8 - 4);
  layer.addChild(casing);
  setTimeout(() => casing.destroy(), 420);
}

function setParallax(layer: Container, cx: number, cy: number, amount: number) {
  layer.position.set(cx * amount, cy * amount);
}

function drawBattleBackgroundGradient(graphics: Graphics, width: number, height: number) {
  graphics.clear();
  const steps = 24;
  for (let i = 0; i < steps; i += 1) {
    const t = i / (steps - 1);
    const y = (height / steps) * i;
    const bandHeight = Math.ceil(height / steps) + 1;
    graphics.rect(0, y, width, bandHeight).fill({ color: mixColor(0x000000, 0x04142b, t), alpha: 1 });
  }
}

function mixColor(from: number, to: number, t: number) {
  const r = Math.round(((from >> 16) & 0xff) * (1 - t) + ((to >> 16) & 0xff) * t);
  const g = Math.round(((from >> 8) & 0xff) * (1 - t) + ((to >> 8) & 0xff) * t);
  const b = Math.round((from & 0xff) * (1 - t) + (to & 0xff) * t);
  return (r << 16) | (g << 8) | b;
}

function seedBattlePlanets(layer: Container, textures: Texture[], width: number, height: number) {
  const slots = [
    { x: width * 0.76, y: height * 0.18, size: Math.max(width, height) * 0.34 },
    { x: width * 0.14, y: height * 0.72, size: Math.max(width, height) * 0.24 },
    { x: width * 0.9, y: height * 0.82, size: Math.max(width, height) * 0.2 },
    { x: width * 0.22, y: height * 0.14, size: Math.max(width, height) * 0.16 }
  ];

  textures.slice(0, slots.length).forEach((texture, index) => {
    const slot = slots[index];
    const sprite = new Sprite(texture);
    const ratio = texture.height > 0 ? texture.width / texture.height : 1;
    const size = slot.size * (0.84 + Math.random() * 0.28);
    sprite.anchor.set(0.5);
    sprite.width = size * ratio;
    sprite.height = size;
    sprite.alpha = 0.48 + Math.random() * 0.2;
    sprite.rotation = (Math.random() - 0.5) * 0.24;
    sprite.position.set(slot.x + (Math.random() - 0.5) * width * 0.14, slot.y + (Math.random() - 0.5) * height * 0.12);
    layer.addChild(sprite);
  });
}

function seedNebulaLayer(layer: Container, color: number, alpha: number) {
  for (let i = 0; i < 6; i += 1) {
    const cloud = new Graphics()
      .ellipse(0, 0, 280 + Math.random() * 360, 120 + Math.random() * 190)
      .fill({ color, alpha: alpha * (0.55 + Math.random() * 0.45) });
    cloud.position.set(
      Math.random() * BACKGROUND_SCENE.width - BACKGROUND_SCENE.width / 2,
      Math.random() * BACKGROUND_SCENE.height - BACKGROUND_SCENE.height / 2
    );
    cloud.rotation = Math.random() * Math.PI;
    layer.addChild(cloud);
  }
}

function seedStarLayer(layer: Container, count: number, alpha: number, maxSize: number) {
  for (let i = 0; i < count; i += 1) {
    const star = new Graphics()
      .circle(0, 0, 0.35 + Math.random() * maxSize)
      .fill({ color: 0xc9d7e8, alpha: alpha * (0.35 + Math.random() * 0.65) });
    star.position.set(
      Math.random() * BACKGROUND_SCENE.width - BACKGROUND_SCENE.width / 2,
      Math.random() * BACKGROUND_SCENE.height - BACKGROUND_SCENE.height / 2
    );
    layer.addChild(star);
  }
}

function seedAsteroidDebris(layer: Container) {
  for (let i = 0; i < 22; i += 1) {
    const size = 1.5 + Math.random() * 4;
    const rock = new Graphics()
      .poly([0, -size, size * 0.8, -size * 0.2, size * 0.35, size, -size * 0.9, size * 0.45])
      .fill({ color: 0x6f7885, alpha: 0.11 + Math.random() * 0.08 });
    rock.position.set(
      Math.random() * BACKGROUND_SCENE.width - BACKGROUND_SCENE.width / 2,
      Math.random() * BACKGROUND_SCENE.height - BACKGROUND_SCENE.height / 2
    );
    rock.rotation = Math.random() * Math.PI * 2;
    layer.addChild(rock);
  }
}

function seedDustParticles(layer: Container) {
  for (let i = 0; i < 95; i += 1) {
    const dot = new Graphics()
      .circle(0, 0, Math.random() * 1.8 + 0.35)
      .fill({ color: 0x8fa4b8, alpha: Math.random() * 0.08 + 0.025 });
    dot.position.set(
      Math.random() * BACKGROUND_SCENE.width - BACKGROUND_SCENE.width / 2,
      Math.random() * BACKGROUND_SCENE.height - BACKGROUND_SCENE.height / 2
    );
    layer.addChild(dot);
  }
}

function seedBattlefieldGrid(layer: Container) {
  const grid = new Graphics();
  const step = 96;
  const width = BACKGROUND_SCENE.width;
  const height = BACKGROUND_SCENE.height;
  for (let x = -width / 2; x <= width / 2; x += step) {
    grid.moveTo(x, -height / 2).lineTo(x, height / 2);
  }
  for (let y = -height / 2; y <= height / 2; y += step) {
    grid.moveTo(-width / 2, y).lineTo(width / 2, y);
  }
  grid.stroke({ color: 0x5d7fa8, alpha: 0.035, width: 1 });
  layer.addChild(grid);
}

function seedSpaceClouds(layer: Container) {
  for (let i = 0; i < 5; i += 1) {
    const cloud = new Graphics()
      .ellipse(0, 0, 360 + Math.random() * 420, 70 + Math.random() * 130)
      .fill({ color: 0x9ab6d5, alpha: 0.025 + Math.random() * 0.02 });
    cloud.position.set(
      Math.random() * BACKGROUND_SCENE.width - BACKGROUND_SCENE.width / 2,
      Math.random() * BACKGROUND_SCENE.height - BACKGROUND_SCENE.height / 2
    );
    cloud.rotation = Math.random() * Math.PI;
    layer.addChild(cloud);
  }
}

function drawProjectileTrail(projectile: Projectile) {
  const speed = Math.max(1, Math.hypot(projectile.vel.x, projectile.vel.y));
  const tailLength = projectile.smoke ? 42 : 28;
  const nx = projectile.vel.x / speed;
  const ny = projectile.vel.y / speed;
  projectile.trail.clear();
  for (let i = 0; i < 3; i += 1) {
    const start = 8 + i * (tailLength / 3);
    const end = start + tailLength / 5;
    projectile.trail
      .moveTo(projectile.pos.x - nx * end, projectile.pos.y - ny * end)
      .lineTo(projectile.pos.x - nx * start, projectile.pos.y - ny * start)
      .stroke({ color: projectile.color, alpha: 0.18 - i * 0.04, width: projectile.smoke ? 2 : 1.3 });
  }
}

function nearestEnemy(origin: Vec, enemies: Enemy[], range: number): Enemy | null {
  let best: Enemy | null = null;
  let bestDist = range;
  for (const enemy of enemies) {
    if (enemy.hp <= 0) continue;
    const dist = Math.hypot(enemy.pos.x - origin.x, enemy.pos.y - origin.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = enemy;
    }
  }
  return best;
}

function spawnEngineGlows(
  layer: Container,
  pos: Vec,
  rotation: number,
  engineMounts: Vec[],
  power: number
) {
  const visualRotation = rotation + Math.PI / 2;
  const mounts = engineMounts.length > 0 ? engineMounts : [{ x: 0, y: 28 }];
  mounts.forEach((mount) => {
    const world = getWorldMount(pos, visualRotation, mount);
    const g = new Graphics()
      .ellipse(0, 0, 5 + power * 5, 14 + power * 18)
      .fill({ color: 0xff9b42, alpha: 0.2 + power * 0.16 })
      .ellipse(0, 0, 2 + power * 2, 8 + power * 12)
      .fill({ color: 0x49d7ff, alpha: 0.18 + power * 0.18 });
    g.position.set(world.x - Math.cos(rotation) * 18, world.y - Math.sin(rotation) * 18);
    g.rotation = rotation;
    layer.addChild(g);
    setTimeout(() => g.destroy(), 140);
  });
}

function spawnImpact(
  particles: Particle[],
  layer: Container,
  textures: Record<BattleVfxSpriteKey, Texture>,
  pos: Vec,
  color = 0xffd27a
) {
  spawnVfxSprite(layer, textures.kineticImpact, pos, 46, 0.18, color === 0xff596a ? 0xff8a8f : 0xffffff);
  spawnVfxSprite(layer, textures.smokePuff, pos, 34, 0.28, 0xb9c0c9, 0.34);
  for (let i = 0; i < 6; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 60 + Math.random() * 140;
    addParticle(particles, layer, {
      pos: { ...pos },
      vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
      life: 0.22 + Math.random() * 0.24,
      size: 1.2 + Math.random() * 1.5,
      color: i % 3 === 0 ? 0xffffff : color,
      alpha: 0.62,
      kind: "spark"
    });
  }
}

function spawnBeam(
  layer: Container,
  particles: Particle[],
  textures: Record<BattleVfxSpriteKey, Texture>,
  from: Vec,
  to: Vec
) {
  const g = new Graphics()
    .moveTo(from.x, from.y)
    .lineTo(to.x, to.y)
    .stroke({ color: 0x66e6ff, alpha: 0.82, width: 4 })
    .moveTo(from.x, from.y)
    .lineTo(to.x, to.y)
    .stroke({ color: 0xffffff, alpha: 0.8, width: 1 });
  layer.addChild(g);
  spawnVfxSprite(layer, textures.shieldImpact, to, 62, 0.18);
  spawnImpact(particles, layer, textures, to, 0x66e6ff);
  setTimeout(() => g.destroy(), 90);
}

function spawnExplosion(
  particles: Particle[],
  layer: Container,
  textures: Record<BattleVfxSpriteKey, Texture>,
  animations: Record<ExplosionAnimationKey, Texture[]>,
  animationKey: ExplosionAnimationKey,
  pos: Vec,
  size: number
) {
  const explosionTexture =
    size > 52 ? textures.largeExplosion : size > 28 ? textures.mediumExplosion : textures.smallExplosion;
  const animatedFrames = animations[animationKey] ?? animations.medium;
  if (animatedFrames.length > 0) {
    spawnAnimatedVfxSprite(layer, animatedFrames, pos, size * 2.7, 0.48);
    if (animationKey === "medium" && animations.smoke.length > 0) {
      spawnAnimatedVfxSprite(layer, animations.smoke, pos, size * 2.2, 0.62);
    }
  } else {
    spawnVfxSprite(layer, explosionTexture, pos, size * 2.2, 0.34);
  }
  spawnVfxSprite(layer, textures.debrisCluster, pos, size * 1.45, 0.32, 0xffffff, 0.7);
  addParticle(particles, layer, {
    pos: { ...pos },
    vel: { x: 0, y: 0 },
    life: 0.42,
    size,
    color: 0xff9b42,
    alpha: 0.16,
    kind: "shockwave"
  });
  for (let i = 0; i < 8; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 45 + Math.random() * 180;
    addParticle(particles, layer, {
      pos: { ...pos },
      vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
      life: 0.35 + Math.random() * 0.45,
      size: 1 + Math.random() * 2,
      color: i % 4 === 0 ? 0xffffff : 0xff9b42,
      alpha: 0.48,
      kind: "debris"
    });
  }
  for (let i = 0; i < 5; i += 1) {
    spawnVfxSprite(
      layer,
      textures.smokePuff,
      { x: pos.x + Math.random() * size - size / 2, y: pos.y + Math.random() * size - size / 2 },
      size * (0.58 + Math.random() * 0.34),
      0.42,
      0x9aa3ae,
      0.28
    );
  }
}

function spawnAnimatedVfxSprite(
  layer: Container,
  frames: Texture[],
  pos: Vec,
  size: number,
  lifetime: number
) {
  const sprite = new Sprite(frames[0]);
  sprite.anchor.set(0.5);
  sprite.width = size;
  sprite.height = size;
  sprite.position.set(pos.x, pos.y);
  sprite.rotation = Math.random() * Math.PI * 2;
  layer.addChild(sprite);

  let frameIndex = 0;
  const intervalMs = Math.max(34, (lifetime * 1000) / frames.length);
  const timer = window.setInterval(() => {
    frameIndex += 1;
    if (frameIndex >= frames.length) {
      window.clearInterval(timer);
      sprite.destroy();
      return;
    }
    sprite.texture = frames[frameIndex];
    sprite.width = size;
    sprite.height = size;
  }, intervalMs);
}

function spawnVfxSprite(
  layer: Container,
  texture: Texture,
  pos: Vec,
  size: number,
  lifetime: number,
  tint = 0xffffff,
  alpha = 1
) {
  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5);
  sprite.width = size;
  sprite.height = size;
  sprite.tint = tint;
  sprite.alpha = alpha;
  sprite.position.set(pos.x, pos.y);
  sprite.rotation = Math.random() * Math.PI * 2;
  layer.addChild(sprite);
  setTimeout(() => sprite.destroy(), lifetime * 1000);
}

function spawnSmoke(particles: Particle[], layer: Container, pos: Vec, scale: number) {
  addParticle(particles, layer, {
    pos: { x: pos.x + Math.random() * 10 - 5, y: pos.y + Math.random() * 10 - 5 },
    vel: { x: Math.random() * 22 - 11, y: Math.random() * 22 - 11 },
    life: 0.55 + Math.random() * 0.42,
    size: 5 * scale + Math.random() * 7 * scale,
    color: 0x5e6874,
    alpha: 0.14,
    kind: "smoke"
  });
}

function addParticle(
  particles: Particle[],
  layer: Container,
  input: Omit<Particle, "body" | "maxLife">
) {
  const body = new Graphics();
  if (input.kind === "shockwave") {
    body.circle(0, 0, input.size).stroke({ color: input.color, alpha: input.alpha, width: 3 });
  } else {
    body.circle(0, 0, input.size).fill({ color: input.color, alpha: input.alpha });
  }
  body.position.set(input.pos.x, input.pos.y);
  layer.addChild(body);
  particles.push({ ...input, maxLife: input.life, body });
}

function getWeaponSoundKey(damageType: WeaponDef["damageType"]): BattleSoundKey {
  if (damageType === "energy") return "laser";
  if (damageType === "plasma" || damageType === "emp") return "plasma";
  if (damageType === "explosive") return "missile";
  return "autocannon";
}

function getImpactSoundKey(damageType: WeaponDef["damageType"]): BattleSoundKey {
  if (damageType === "energy" || damageType === "emp") return "impactEnergy";
  if (damageType === "plasma" || damageType === "thermal") return "impactPlasma";
  if (damageType === "explosive") return "impactExplosive";
  return "impactKinetic";
}

function createBattleAudio() {
  const emptyAudio = {
    unlock: () => {},
    play: (_key: BattleSoundKey, _volume = 1) => {},
    setEnginePower: (_power: number) => {},
    destroy: () => {}
  };
  if (typeof Audio === "undefined") return emptyAudio;

  let unlocked = false;
  const lastPlayed = new Map<BattleSoundKey, number>();
  const oneShots = new Map<BattleSoundKey, HTMLAudioElement[]>();
  const idle = new Audio(BATTLE_AUDIO.engineIdle);
  const thrust = new Audio(BATTLE_AUDIO.engineThrust);

  idle.loop = true;
  thrust.loop = true;
  idle.volume = 0;
  thrust.volume = 0;
  idle.preload = "auto";
  thrust.preload = "auto";

  const makeOneShot = (src: string) => {
    const audio = new Audio(src);
    audio.preload = "auto";
    return audio;
  };

  const sources: Record<BattleSoundKey, string> = {
    autocannon: BATTLE_AUDIO.autocannon,
    laser: BATTLE_AUDIO.laser,
    plasma: BATTLE_AUDIO.plasma,
    missile: BATTLE_AUDIO.missile,
    thruster: BATTLE_AUDIO.thruster,
    impactKinetic: BATTLE_AUDIO.impactKinetic,
    impactEnergy: BATTLE_AUDIO.impactEnergy,
    impactPlasma: BATTLE_AUDIO.impactPlasma,
    impactExplosive: BATTLE_AUDIO.impactExplosive
  };

  (Object.keys(sources) as BattleSoundKey[]).forEach((key) => {
    oneShots.set(key, [makeOneShot(sources[key]), makeOneShot(sources[key])]);
  });

  function startLoop(audio: HTMLAudioElement) {
    audio.play().catch(() => {});
  }

  return {
    unlock: () => {
      if (unlocked) return;
      unlocked = true;
      startLoop(idle);
      startLoop(thrust);
    },
    play: (key: BattleSoundKey, volume = 1) => {
      if (!unlocked) return;
      const now = performance.now();
      const minGap = key === "autocannon" || key === "laser" ? 70 : 120;
      if (now - (lastPlayed.get(key) ?? 0) < minGap) return;
      lastPlayed.set(key, now);

      const pool = oneShots.get(key);
      const audio = pool?.find((item) => item.paused || item.ended) ?? pool?.[0];
      if (!audio) return;
      audio.pause();
      audio.currentTime = 0;
      audio.volume = Math.min(1, volume);
      audio.play().catch(() => {});
    },
    setEnginePower: (power: number) => {
      if (!unlocked) return;
      const amount = Math.max(0, Math.min(1, power));
      idle.volume = 0.16 * (1 - amount * 0.35);
      thrust.volume = 0.42 * amount;
    },
    destroy: () => {
      [idle, thrust, ...Array.from(oneShots.values()).flat()].forEach((audio) => {
        audio.pause();
        audio.currentTime = 0;
      });
    }
  };
}
