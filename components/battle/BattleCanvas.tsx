"use client";

import { useEffect, useRef } from "react";
import { Application, Assets, Container, Graphics, Rectangle, Sprite, Text, Texture, TilingSprite } from "pixi.js";
import type { TextStyleFontWeight } from "pixi.js";
import { getFrame, getModule } from "@/game/ship/build";
import { calculateShipStats } from "@/game/ship/stats";
import {
  battleVfxAtlas,
  getModuleSpriteKey,
  hoverAtlas,
  moduleAtlas,
  weaponAtlas,
  type BattleVfxSpriteKey,
  type HoverSpriteKey,
  type ModuleSpriteKey,
  type WeaponSpriteKey
} from "@/game/assets/moduleSprites";
import type { ShipBuild, WeaponDef } from "@/game/types";

const BACKGROUND_SCENE = { width: 2400, height: 3600 };

type BattleCanvasProps = {
  build: ShipBuild;
  onResult: (result: "victory" | "defeat") => void;
};

type Vec = { x: number; y: number };
type Enemy = {
  kind: "drone" | "raider" | "bomber";
  build: ShipBuild;
  pos: Vec;
  vel: Vec;
  rotation: number;
  hp: number;
  maxHp: number;
  acceleration: number;
  maxSpeed: number;
  turnRate: number;
  radius: number;
  body: Container;
  weapons: WeaponState[];
  engineMounts: Vec[];
};
type Projectile = {
  pos: Vec;
  vel: Vec;
  owner: "player" | "enemy";
  damage: number;
  radius: number;
  life: number;
  body: Sprite;
  color: number;
  smoke: boolean;
  previous: Vec;
  trail: Graphics;
};
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
type WeaponState = {
  weapon: WeaponDef;
  cooldown: number;
  mount: Vec;
  turret?: Sprite;
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
  planets: Texture;
  modules: Record<ModuleSpriteKey, Texture>;
  weapons: Record<WeaponSpriteKey, Texture>;
  hover: Record<HoverSpriteKey, Texture>;
  battleVfx: Record<BattleVfxSpriteKey, Texture>;
};

type ShipVisual = {
  container: Container;
  turrets: Map<string, Sprite>;
  engineMounts: Vec[];
};

export default function BattleCanvas({ build, onResult }: BattleCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const resultRef = useRef(false);

  useEffect(() => {
    if (!hostRef.current) return;

    let destroyed = false;
    let initialized = false;
    const app = new Application();
    const host = hostRef.current;
    const stats = calculateShipStats(build);
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
      const planetsLayer = new Container();
      const dustLayer = new Container();
      const engineLayer = new Container();
      const world = new Container();
      const projectilesLayer = new Container();
      const enemiesLayer = new Container();
      const effectsLayer = new Container();
      const markerLayer = new Container();
      const damageFlash = new Graphics();
      app.stage.addChild(spaceTile, planetsLayer, dustLayer, engineLayer, world, enemiesLayer, projectilesLayer, effectsLayer);
      seedPlanets(planetsLayer, textures.planets);
      seedParallax(dustLayer);

      const ship = buildShipGraphic(build, textures);
      world.addChild(ship.container);

      const player = {
        build,
        pos: { x: 0, y: 0 },
        vel: { x: 0, y: 0 },
        hp: stats.hp,
        maxHp: stats.hp,
        rotation: -Math.PI / 2,
        maxSpeed: stats.maxSpeed,
        acceleration: Math.max(35, stats.acceleration * 70),
        turnRate: Math.max(1.8, stats.turnRate)
      };
      const joystick = { active: false, origin: { x: 0, y: 0 }, value: { x: 0, y: 0 } };
      const enemies: Enemy[] = [
        makeEnemy("drone", -210, -260, textures),
        makeEnemy("drone", 190, -310, textures),
        makeEnemy("raider", 250, -460, textures),
        makeEnemy("bomber", -260, -540, textures)
      ];
      enemies.forEach((enemy) => enemiesLayer.addChild(enemy.body));
      app.stage.addChild(markerLayer);
      const enemyMarkers = enemies.map((enemy) => makeEnemyMarker(enemy));
      enemyMarkers.forEach((marker) => markerLayer.addChild(marker.root));
      app.stage.addChild(damageFlash);

      const projectiles: Projectile[] = [];
      const particles: Particle[] = [];
      const weapons = collectWeapons(build, ship.turrets);
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
      app.stage.addChild(joystickBase, joystickKnob);

      app.stage.eventMode = "static";
      app.stage.hitArea = app.screen;
      app.stage.on("pointerdown", (event) => {
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
        if (inputPower > 0.05) {
          applyShipPhysics(player, Math.atan2(joystick.value.y, joystick.value.x), inputPower, dt);
          spawnEngineGlows(engineLayer, player.pos, player.rotation, ship.engineMounts, inputPower);
        } else {
          applyShipPhysics(player, player.rotation, 0, dt);
        }

        ship.container.position.set(player.pos.x, player.pos.y);
        ship.container.rotation = player.rotation + Math.PI / 2;
      }

      function updateWeapons(dt: number) {
        weapons.forEach((weaponState) => {
          weaponState.cooldown -= dt;
          const target = nearestEnemy(player.pos, enemies, weaponState.weapon.range);
          if (!target || weaponState.cooldown > 0) return;
          rotateTurretToTarget(weaponState, ship.container.rotation, player.pos, target.pos);
          weaponState.cooldown = Math.max(0.12, 1 / weaponState.weapon.fireRate);
          const origin = getWorldMount(player.pos, player.rotation, weaponState.mount);

          if (weaponState.weapon.damageType === "energy") {
            target.hp -= weaponState.weapon.damage;
            spawnBeam(effectsLayer, particles, textures.battleVfx, origin, target.pos);
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
            weaponState.weapon.damage,
            weaponState.weapon.damageType === "explosive" ? 7 : 4,
            weaponState.weapon.damageType === "plasma" ? 0x8b5cff : 0x49d7ff,
            weaponState.weapon.damageType === "explosive"
          );
          if (weaponState.weapon.damageType === "kinetic") {
            spawnShellCasing(effectsLayer, textures.battleVfx.shellCasing, origin, player.rotation);
          }
          projectiles.push(projectile);
          projectilesLayer.addChild(projectile.trail, projectile.body);
        });
      }

      function updateEnemies(dt: number) {
        enemies.forEach((enemy) => {
          if (enemy.hp <= 0) {
            enemy.body.visible = false;
            return;
          }
          const dx = player.pos.x - enemy.pos.x;
          const dy = player.pos.y - enemy.pos.y;
          const dist = Math.max(1, Math.hypot(dx, dy));
          const ideal = enemy.kind === "bomber" ? 360 : 210;
          const desired = Math.atan2(dy, dx) + (dist < ideal ? Math.PI : 0);
          const inputPower = dist > ideal ? 0.9 : 0.45;
          applyShipPhysics(enemy, desired, inputPower, dt);
          spawnEngineGlows(engineLayer, enemy.pos, enemy.rotation, enemy.engineMounts, inputPower);
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
            rotateTurretToTarget(weaponState, enemy.body.rotation, enemy.pos, player.pos);
            weaponState.cooldown = Math.max(0.12, 1 / weaponState.weapon.fireRate);
            const origin = getWorldMount(enemy.pos, enemy.rotation, weaponState.mount);

          if (weaponState.weapon.damageType === "energy") {
            player.hp -= weaponState.weapon.damage;
              spawnBeam(effectsLayer, particles, textures.battleVfx, origin, player.pos);
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
              weaponState.weapon.damage,
              weaponState.weapon.damageType === "explosive" ? 6 : 4,
              0xff596a,
              weaponState.weapon.damageType === "explosive"
            );
            if (weaponState.weapon.damageType === "kinetic") {
              spawnShellCasing(effectsLayer, textures.battleVfx.shellCasing, origin, enemy.rotation);
            }
            projectiles.push(projectile);
            projectilesLayer.addChild(projectile.trail, projectile.body);
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
            spawnSmoke(particles, effectsLayer, projectile.previous, 0.55);
          }

          let hit = false;
          enemies.forEach((enemy) => {
            if (hit || enemy.hp <= 0) return;
            if (
              projectile.owner === "player" &&
              projectileHitsShip(projectile, enemy.build, enemy.pos, enemy.rotation)
            ) {
              enemy.hp -= projectile.damage;
              spawnImpact(particles, effectsLayer, textures.battleVfx, projectile.pos, projectile.color);
              hit = true;
            }
          });

          if (
            projectile.owner === "enemy" &&
            projectileHitsShip(projectile, player.build, player.pos, player.rotation)
          ) {
            player.hp -= projectile.damage;
            spawnImpact(particles, effectsLayer, textures.battleVfx, projectile.pos, 0xff596a);
            screenShake = 0.12;
            hit = true;
          }

          if (hit || projectile.life <= 0) {
            if (hit) {
              spawnExplosion(
                particles,
                effectsLayer,
                textures.battleVfx,
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
        world.position.set(cx, cy);
        engineLayer.position.set(cx, cy);
        enemiesLayer.position.set(cx, cy);
        projectilesLayer.position.set(cx, cy);
        effectsLayer.position.set(cx, cy);
        spaceTile.width = app.screen.width;
        spaceTile.height = app.screen.height;
        spaceTile.tilePosition.set(player.pos.x * -0.025, player.pos.y * -0.025);
        planetsLayer.position.set(cx * 0.09, cy * 0.09);
        dustLayer.position.set(cx * 0.26, cy * 0.26);
      }

      function updateEnemyMarkers() {
        enemyMarkers.forEach((marker) => {
          const enemy = marker.enemy;
          marker.root.visible = enemy.hp > 0;
          if (!marker.root.visible) return;

          const distance = Math.hypot(enemy.pos.x - player.pos.x, enemy.pos.y - player.pos.y);
          const sx = enemiesLayer.position.x + enemy.pos.x;
          const sy = enemiesLayer.position.y + enemy.pos.y;
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
        spawnExplosion(particles, effectsLayer, textures.battleVfx, player.pos, result === "defeat" ? 70 : 30);
        onResult(result);
      }
    }

    boot();

    return () => {
      destroyed = true;
      resultRef.current = false;
      window.removeEventListener("resize", resize);
      if (initialized) app.destroy();
    };
  }, [build, onResult]);

  return <div ref={hostRef} className="battle-canvas" />;
}

async function loadAtlasTextures(): Promise<AtlasTextures> {
  const [background, planets, moduleBase, weaponBase, hoverBase, battleVfxBase] = await Promise.all([
    Assets.load<Texture>("/assets/backgrounds/space-tile.png"),
    Assets.load<Texture>("/assets/backgrounds/planet-atlas.png"),
    Assets.load<Texture>(moduleAtlas.src),
    Assets.load<Texture>(weaponAtlas.src),
    Assets.load<Texture>(hoverAtlas.src),
    Assets.load<Texture>(battleVfxAtlas.src)
  ]);

  return {
    background,
    planets,
    modules: sliceAtlas(moduleBase, moduleAtlas),
    weapons: sliceAtlas(weaponBase, weaponAtlas),
    hover: sliceAtlas(hoverBase, hoverAtlas),
    battleVfx: sliceAtlas(battleVfxBase, battleVfxAtlas, 18)
  };
}

function sliceAtlas<T extends string>(
  base: Texture,
  atlas: {
    frameWidth: number;
    frameHeight: number;
    cells: Record<T, { col: number; row: number }>;
  },
  inset = 0
) {
  const textures = {} as Record<T, Texture>;
  (Object.keys(atlas.cells) as T[]).forEach((key) => {
    const cell = atlas.cells[key];
    textures[key] = new Texture({
      source: base.source,
      frame: new Rectangle(
        cell.col * atlas.frameWidth + inset,
        cell.row * atlas.frameHeight + inset,
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
  const frame = getFrame(build.frameId);
  const cell = 26;
  const centerX = (frame.size.width - 1) / 2;
  const centerY = (frame.size.height - 1) / 2;
  build.modules.forEach((installed) => {
    const module = getModule(installed.moduleId);
    module.shape.cells.forEach((shapeCell) => {
      const x = (installed.position.x + shapeCell.x - centerX) * cell;
      const y = (installed.position.y + shapeCell.y - centerY) * cell;
      const hover = new Sprite(textures.hover.ring);
      hover.anchor.set(0.5);
      hover.width = cell * 1.82;
      hover.height = cell * 1.82;
      hover.alpha = 0.16;
      hover.position.set(x, y + 2);
      container.addChild(hover);

      const sprite = new Sprite(
        module.type === "weapon"
          ? textures.weapons[getWeaponBaseKey(module.id)]
          : textures.modules[getModuleSpriteKey(module)]
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
        const turret = new Sprite(textures.weapons[getWeaponTurretKey(module.id)]);
        turret.anchor.set(0.5);
        turret.width = cell * 1.52;
        turret.height = cell * 1.52;
        turret.position.set(x, y);
        if (module.id === "laser_turret") turret.tint = 0x8befff;
        if (module.id === "plasma_cannon") turret.tint = 0xc98cff;
        if (module.id === "missile_pod") turret.tint = 0xffd080;
        container.addChild(turret);
        turrets.set(installed.instanceId, turret);
      }
    });
  });
  return { container, turrets, engineMounts };
}

function collectWeapons(build: ShipBuild, turrets: Map<string, Sprite>): WeaponState[] {
  const frame = getFrame(build.frameId);
  const centerX = (frame.size.width - 1) / 2;
  const centerY = (frame.size.height - 1) / 2;
  const weapons: WeaponState[] = [];

  build.modules.forEach((installed) => {
    const module = getModule(installed.moduleId);
    if (!module.weapon) return;
    weapons.push({
      weapon: module.weapon,
      cooldown: Math.random() * 0.8,
      mount: {
        x: (installed.position.x - centerX) * 20,
        y: (installed.position.y - centerY) * 20
      },
      turret: turrets.get(installed.instanceId)
    });
  });

  return weapons;
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

function rotateTurretToTarget(weaponState: WeaponState, ownerRotation: number, ownerPos: Vec, targetPos: Vec) {
  if (!weaponState.turret) return;
  const targetAngle = Math.atan2(targetPos.y - ownerPos.y, targetPos.x - ownerPos.x);
  weaponState.turret.rotation = targetAngle - ownerRotation + Math.PI / 2;
}

function makeEnemy(
  kind: Enemy["kind"],
  x: number,
  y: number,
  textures: AtlasTextures
): Enemy {
  const build = makeEnemyBuild(kind);
  const stats = calculateShipStats(build);
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
    hp: stats.hp,
    maxHp: stats.hp,
    acceleration: Math.max(30, stats.acceleration * 70),
    maxSpeed: stats.maxSpeed,
    turnRate: Math.max(1.5, stats.turnRate),
    radius,
    body,
    weapons: collectWeapons(build, visual.turrets),
    engineMounts: visual.engineMounts
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

function clampToScreenEdge(x: number, y: number, width: number, height: number, padding: number) {
  const centerX = width / 2;
  const centerY = height / 2;
  const dx = x - centerX;
  const dy = y - centerY;
  const safeHalfWidth = width / 2 - padding;
  const safeHalfHeight = height / 2 - padding;
  const scale = Math.min(
    Math.abs(dx) > 0.001 ? safeHalfWidth / Math.abs(dx) : Number.POSITIVE_INFINITY,
    Math.abs(dy) > 0.001 ? safeHalfHeight / Math.abs(dy) : Number.POSITIVE_INFINITY
  );

  return {
    x: centerX + dx * scale,
    y: centerY + dy * scale
  };
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
      id: "enemy-drone",
      name: "Drone",
      frameId: "enemy_drone_frame",
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
      id: "enemy-raider",
      name: "Raider",
      frameId: "enemy_raider_frame",
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
    id: "enemy-bomber",
    name: "Bomber",
    frameId: "enemy_bomber_frame",
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

function seedPlanets(layer: Container, atlas: Texture) {
  const frameWidth = atlas.width / 2;
  const frameHeight = atlas.height / 2;
  const planetCells = [
    { col: 0, row: 0 },
    { col: 1, row: 0 },
    { col: 0, row: 1 },
    { col: 1, row: 1 }
  ].sort(() => Math.random() - 0.5);
  const anchors = [
    { x: -560, y: -180 },
    { x: 560, y: 220 },
    { x: -520, y: 980 },
    { x: 520, y: 1220 }
  ].sort(() => Math.random() - 0.5);
  const count = 2 + Math.floor(Math.random() * 2);

  for (let i = 0; i < count; i += 1) {
    const cell = planetCells[i];
    const anchor = anchors[i];
    const size = 440 + Math.random() * 360;
    const texture = new Texture({
      source: atlas.source,
      frame: new Rectangle(
        cell.col * frameWidth + 10,
        cell.row * frameHeight + 10,
        frameWidth - 20,
        frameHeight - 20
      )
    });
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.width = size;
    sprite.height = size;
    sprite.alpha = 0.62 + Math.random() * 0.22;
    sprite.rotation = Math.random() * Math.PI * 2;
    sprite.position.set(anchor.x + Math.random() * 220 - 110, anchor.y + Math.random() * 300 - 150);
    layer.addChild(sprite);
  }
}

function seedParallax(dustLayer: Container) {
  for (let i = 0; i < 90; i += 1) {
    const dot = new Graphics()
      .circle(0, 0, Math.random() * 2 + 0.45)
      .fill({ color: 0x8fa4b8, alpha: Math.random() * 0.12 + 0.035 });
    dot.position.set(
      Math.random() * BACKGROUND_SCENE.width - BACKGROUND_SCENE.width / 2,
      Math.random() * BACKGROUND_SCENE.height - BACKGROUND_SCENE.height / 2
    );
    dustLayer.addChild(dot);
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

function rotateTowards(current: number, target: number, maxDelta: number) {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}

function applyShipPhysics(
  ship: {
    pos: Vec;
    vel: Vec;
    rotation: number;
    acceleration: number;
    maxSpeed: number;
    turnRate: number;
  },
  desiredDirection: number,
  inputPower: number,
  dt: number
) {
  const power = Math.min(1, Math.max(0, inputPower));
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

function getWorldMount(pos: Vec, rotation: number, mount: Vec) {
  return {
    x: pos.x + Math.cos(rotation) * mount.x - Math.sin(rotation) * mount.y,
    y: pos.y + Math.sin(rotation) * mount.x + Math.cos(rotation) * mount.y
  };
}

function resolveShipCollisions(
  player: { build: ShipBuild; pos: Vec; vel: Vec; rotation: number },
  playerBody: Container,
  enemies: Enemy[]
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

function resolveModuleCollision(
  a: { build: ShipBuild; pos: Vec; vel: Vec; rotation: number },
  b: { build: ShipBuild; pos: Vec; vel: Vec; rotation: number }
) {
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

function getCollisionPoints(build: ShipBuild, pos: Vec, rotation: number) {
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
    module.shape.cells.forEach((shapeCell) => {
      const lx = (installed.position.x + shapeCell.x - centerX) * cell;
      const ly = (installed.position.y + shapeCell.y - centerY) * cell;
      points.push({
        x: pos.x + lx * cos - ly * sin,
        y: pos.y + lx * sin + ly * cos
      });
    });
  });

  return points;
}

function projectileHitsShip(
  projectile: Projectile,
  build: ShipBuild,
  pos: Vec,
  rotation: number
) {
  return getCollisionPoints(build, pos, rotation).some((point) => {
    return Math.hypot(point.x - projectile.pos.x, point.y - projectile.pos.y) < 18 + projectile.radius;
  });
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
  pos: Vec,
  size: number
) {
  const explosionTexture =
    size > 52 ? textures.largeExplosion : size > 28 ? textures.mediumExplosion : textures.smallExplosion;
  spawnVfxSprite(layer, explosionTexture, pos, size * 2.2, 0.34);
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
