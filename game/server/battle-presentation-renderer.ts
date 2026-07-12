import type { BattleEntitySnapshot } from "@spacey/protocol";
import {
  battleVfxAtlas,
  moduleAtlas,
  moduleStateAtlas,
  type BattleVfxSpriteKey,
  type ModuleSpriteKey,
} from "@/game/assets/moduleSprites";
import {
  createGameAudioLoop,
  createGameAudioScope,
  preloadGameAudio,
} from "@/game/audio/gameAudio";
import {
  Application,
  Assets,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Texture,
  TilingSprite,
} from "@/game/render/three/three2d";
import type { BattleSnapshotBuffer } from "./battle-snapshot-buffer";
import {
  drawBattleFrame,
  type ReceivedBattlePresentationEvent,
} from "./battle-canvas-renderer";

const BACKGROUND_SRC = "/assets/backgrounds/deep-space-tile-01.webp";
const MODULE_CELL_SIZE = 18;
const ENTITY_MARGIN = 28;
const VFX_LIFETIME_MS = 720;

const BATTLE_AUDIO = {
  engineIdle: "/assets/audio/engine-idle-loop.mp3",
  engineThrust: "/assets/audio/engine-thrust-loop.mp3",
  autocannon: "/assets/audio/weapon-autocannon-shot.mp3",
  laser: "/assets/audio/weapon-laser-shot.mp3",
  plasma: "/assets/audio/weapon-plasma-shot.mp3",
  missile: "/assets/audio/weapon-missile-launch.mp3",
  impactHull: "/assets/audio/impact-kinetic-hull.mp3",
  impactShield: "/assets/audio/impact-energy-shield.mp3",
  explosion: "/assets/audio/impact-missile-explosion.mp3",
} as const;

type ModuleDamageState = "ideal" | "lightDamage" | "heavyDamage" | "debris";

type PresentationAssets = {
  background: Texture;
  modules: Record<ModuleDamageState, Record<ModuleSpriteKey, Texture>>;
  vfx: Record<BattleVfxSpriteKey, Texture>;
};

type ModuleVisual = {
  sprite: Sprite;
  state: ModuleDamageState;
};

type EntityVisual = {
  root: Container;
  fallbackBody: Graphics;
  shieldRing: Graphics;
  modules: Map<string, ModuleVisual>;
  projectile: Sprite | null;
};

type ActiveVfx = {
  sprite: Sprite;
  bornAt: number;
  duration: number;
  startSize: number;
  endSize: number;
  originX: number;
  originY: number;
  originRotation: number;
  driftX: number;
  driftY: number;
  rotationSpeed: number;
};

export type BattlePresentationRenderer = {
  draw: (
    snapshots: BattleSnapshotBuffer,
    events: readonly ReceivedBattlePresentationEvent[],
    now: number,
  ) => void;
  destroy: () => void;
};

/**
 * WebGL presentation adapter. It consumes interpolated server snapshots and
 * server events only; it never advances simulation state or derives outcomes.
 */
export async function createBattlePresentationRenderer(
  host: HTMLElement,
): Promise<BattlePresentationRenderer> {
  const size = measureHost(host);
  const app = new Application();
  try {
    await app.init({
      width: size.width,
      height: size.height,
      background: "#02050c",
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
  } catch {
    return createCanvasFallback(host);
  }
  app.canvas.className = "authoritative-battle__webgl";
  app.canvas.setAttribute("aria-hidden", "true");
  host.dataset.renderer = "three2d";
  host.appendChild(app.canvas);

  let assets: PresentationAssets;
  try {
    assets = await loadPresentationAssets();
  } catch {
    app.destroy();
    return createCanvasFallback(host);
  }
  const background = new TilingSprite({
    texture: assets.background,
    width: size.width,
    height: size.height,
  });
  background.alpha = 0.52;
  const arenaFrame = new Graphics();
  const entityLayer = new Container();
  const vfxLayer = new Container();
  app.stage.addChild(background, arenaFrame, entityLayer, vfxLayer);

  const entities = new Map<string, EntityVisual>();
  const activeVfx: ActiveVfx[] = [];
  const processedEvents = new Map<number, number>();
  const audio = createPresentationAudio();
  let width = size.width;
  let height = size.height;
  let destroyed = false;

  const resize = () => {
    const next = measureHost(host);
    if (next.width === width && next.height === height) return;
    width = next.width;
    height = next.height;
    app.renderer.resize(width, height);
    background.width = width;
    background.height = height;
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);

  return {
    draw: (snapshots, events, now) => {
      if (destroyed) return;
      resize();
      background.tilePosition.set(now * 0.004, now * 0.0015);
      const snapshot = snapshots.latestSnapshot();
      if (!snapshot) return;
      const renderedEntities = snapshots.interpolatedEntities(now);
      const transform = makeArenaTransform(
        width,
        height,
        snapshot.arenaWidthMilli,
        snapshot.arenaHeightMilli,
      );
      drawArenaFrame(arenaFrame, transform);

      const visibleIds = new Set<string>();
      for (const entity of renderedEntities) {
        visibleIds.add(entity.id);
        const visual = entities.get(entity.id)
          ?? createEntityVisual(entity, assets, entityLayer);
        entities.set(entity.id, visual);
        updateEntityVisual(visual, entity, assets, transform);
      }
      for (const [id, visual] of entities) {
        if (visibleIds.has(id)) continue;
        visual.root.destroy();
        entities.delete(id);
      }

      acceptPresentationEvents(
        events,
        now,
        entities,
        assets,
        vfxLayer,
        activeVfx,
        processedEvents,
        audio,
      );
      updateVfx(activeVfx, now);
      audio.update(renderedEntities, now);
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      resizeObserver.disconnect();
      audio.destroy();
      app.destroy();
      delete host.dataset.renderer;
    },
  };
}

function createCanvasFallback(host: HTMLElement): BattlePresentationRenderer {
  const canvas = document.createElement("canvas");
  canvas.className = "authoritative-battle__webgl";
  canvas.setAttribute("aria-hidden", "true");
  host.dataset.renderer = "canvas-fallback";
  host.appendChild(canvas);
  return {
    draw: (snapshots, events, now) => drawBattleFrame(canvas, snapshots, events, now),
    destroy: () => {
      canvas.remove();
      delete host.dataset.renderer;
    },
  };
}

async function loadPresentationAssets(): Promise<PresentationAssets> {
  const [background, moduleStates, battleVfx] = await Promise.all([
    Assets.load<Texture>(BACKGROUND_SRC),
    Assets.load<Texture>(moduleStateAtlas.src),
    Assets.load<Texture>(battleVfxAtlas.src),
  ]);
  return {
    background,
    modules: {
      ideal: sliceModuleState(moduleStates, 0),
      lightDamage: sliceModuleState(moduleStates, 1),
      heavyDamage: sliceModuleState(moduleStates, 2),
      debris: sliceModuleState(moduleStates, 3),
    },
    vfx: sliceAtlas(battleVfx, battleVfxAtlas, 18),
  };
}

function sliceModuleState(base: Texture, state: number) {
  return sliceAtlas(base, moduleAtlas, 0, state);
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
  stateOffset = 0,
) {
  const textures = {} as Record<T, Texture>;
  for (const key of Object.keys(atlas.cells) as T[]) {
    const cell = atlas.cells[key];
    textures[key] = new Texture({
      source: base.source,
      frame: new Rectangle(
        cell.col * atlas.frameWidth + inset,
        (cell.row + stateOffset * atlas.rows) * atlas.frameHeight + inset,
        atlas.frameWidth - inset * 2,
        atlas.frameHeight - inset * 2,
      ),
    });
  }
  return textures;
}

function createEntityVisual(
  entity: BattleEntitySnapshot,
  assets: PresentationAssets,
  layer: Container,
): EntityVisual {
  const root = new Container();
  const fallbackBody = createFallbackBody(entity.kind);
  const shieldRing = new Graphics()
    .circle(0, 0, entity.kind === "player" ? 25 : 22)
    .stroke({ color: 0x49d7ff, alpha: 0.7, width: 1.5 });
  shieldRing.visible = false;
  root.addChild(fallbackBody, shieldRing);
  const projectile = entity.kind === "projectile"
    ? createProjectileSprite(entity, assets)
    : null;
  if (projectile) root.addChild(projectile);
  layer.addChild(root);
  return {
    root,
    fallbackBody,
    shieldRing,
    modules: new Map(),
    projectile,
  };
}

function updateEntityVisual(
  visual: EntityVisual,
  entity: BattleEntitySnapshot,
  assets: PresentationAssets,
  transform: ReturnType<typeof makeArenaTransform>,
) {
  visual.root.position.set(
    transform.centerX + (entity.xMilli - transform.cameraX) * transform.scale,
    transform.centerY + (entity.yMilli - transform.cameraY) * transform.scale,
  );
  visual.root.rotation = entity.rotationMilliRadians / 1_000;
  visual.root.alpha = entity.hullMax > 0 && entity.hull <= 0 ? 0.42 : 1;

  const systems = entity.shipSystems;
  visual.fallbackBody.visible = !visual.projectile && (!systems || systems.modules.length === 0);
  visual.shieldRing.visible = Boolean(systems && systems.shieldMax > 0 && systems.shield > 0);
  if (systems?.shieldMax) {
    visual.shieldRing.alpha = 0.22 + 0.42 * clamp(systems.shield / systems.shieldMax, 0, 1);
  }
  if (!systems) return;

  const moduleIds = new Set(systems.modules.map((module) => module.id));
  const moduleCenter = systems.modules.reduce(
    (bounds, module) => ({
      minX: Math.min(bounds.minX, module.gridX),
      maxX: Math.max(bounds.maxX, module.gridX),
      minY: Math.min(bounds.minY, module.gridY),
      maxY: Math.max(bounds.maxY, module.gridY),
    }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
  );
  const centerGridX = Number.isFinite(moduleCenter.minX)
    ? (moduleCenter.minX + moduleCenter.maxX) / 2
    : 0;
  const centerGridY = Number.isFinite(moduleCenter.minY)
    ? (moduleCenter.minY + moduleCenter.maxY) / 2
    : 0;
  for (const module of systems.modules) {
    const state = moduleDamageState(module.hp, module.hpMax, module.detached);
    const existing = visual.modules.get(module.id);
    const moduleVisual = existing ?? createModuleVisual(
      module.category,
      module.visualKey,
      state,
      assets,
      visual.root,
    );
    if (moduleVisual.state !== state) {
      moduleVisual.sprite.texture = assets.modules[state][moduleSpriteKey(module.category, module.visualKey)];
      moduleVisual.state = state;
    }
    const moduleX = (module.gridX - centerGridX) * MODULE_CELL_SIZE;
    const moduleY = (module.gridY - centerGridY) * MODULE_CELL_SIZE;
    moduleVisual.sprite.position.set(moduleX, moduleY);
    moduleVisual.sprite.alpha = module.powered && module.enabled && !module.detached ? 1 : 0.34;
    if (module.detached) {
      const phase = seededUnit(module.id);
      moduleVisual.sprite.position.set(
        moduleX + (phase - 0.5) * 15,
        moduleY + (0.5 - seededUnit(`${module.id}:y`)) * 15,
      );
      moduleVisual.sprite.rotation = (phase - 0.5) * 0.5;
    } else {
      moduleVisual.sprite.rotation = 0;
    }
    visual.modules.set(module.id, moduleVisual);
  }
  for (const [id, moduleVisual] of visual.modules) {
    if (moduleIds.has(id)) continue;
    moduleVisual.sprite.destroy();
    visual.modules.delete(id);
  }
}

function createModuleVisual(
  category: NonNullable<BattleEntitySnapshot["shipSystems"]>["modules"][number]["category"],
  visualKey: string,
  state: ModuleDamageState,
  assets: PresentationAssets,
  root: Container,
): ModuleVisual {
  const sprite = new Sprite(assets.modules[state][moduleSpriteKey(category, visualKey)]);
  sprite.anchor.set(0.5);
  sprite.width = MODULE_CELL_SIZE * 1.7;
  sprite.height = MODULE_CELL_SIZE * 1.7;
  root.addChild(sprite);
  return { sprite, state };
}

function createProjectileSprite(entity: BattleEntitySnapshot, assets: PresentationAssets) {
  const sprite = new Sprite(assets.vfx[projectileTextureKey(entity.weaponId)]);
  sprite.anchor.set(0.5);
  sprite.width = entity.weaponId?.toLowerCase().includes("missile") ? 16 : 10;
  sprite.height = sprite.width;
  return sprite;
}

function createFallbackBody(kind: BattleEntitySnapshot["kind"]) {
  const body = new Graphics();
  if (kind === "player") {
    return body
      .poly([18, 0, -13, 11, -7, 0, -13, -11])
      .fill({ color: 0x49d7ff, alpha: 0.94 });
  }
  if (kind === "enemy") {
    return body
      .poly([15, 0, 0, 13, -15, 0, 0, -13])
      .fill({ color: 0xff557e, alpha: 0.92 });
  }
  if (kind === "objective") {
    return body
      .circle(0, 0, 10)
      .stroke({ color: 0x53e7a4, alpha: 0.9, width: 2 });
  }
  return body.circle(0, 0, 3).fill({ color: 0xffc857, alpha: 1 });
}

function acceptPresentationEvents(
  events: readonly ReceivedBattlePresentationEvent[],
  now: number,
  entities: ReadonlyMap<string, EntityVisual>,
  assets: PresentationAssets,
  layer: Container,
  active: ActiveVfx[],
  processed: Map<number, number>,
  audio: ReturnType<typeof createPresentationAudio>,
) {
  for (const item of events) {
    const event = item.event;
    if (processed.has(event.eventId)) continue;
    processed.set(event.eventId, now);
    const targets = event.entityIds
      .map((id) => entities.get(id))
      .filter((visual): visual is EntityVisual => Boolean(visual));
    for (const target of targets.length > 0 ? targets : []) {
      spawnEventVfx(event.eventType, event.eventId, target, assets, layer, active, now);
    }
    audio.accept(event.eventType, event.weaponId);
  }
  if (processed.size > 2_048) {
    const expired = [...processed.keys()].slice(0, 1_024);
    expired.forEach((eventId) => processed.delete(eventId));
  }
}

function spawnEventVfx(
  eventType: string,
  eventId: number,
  target: EntityVisual,
  assets: PresentationAssets,
  layer: Container,
  active: ActiveVfx[],
  now: number,
) {
  const key = eventVfxKey(eventType);
  const sprite = new Sprite(assets.vfx[key]);
  const phase = seededUnit(String(eventId));
  const startSize = eventType.includes("destroy") ? 44 : eventType.includes("shield") ? 34 : 24;
  sprite.anchor.set(0.5);
  sprite.width = startSize;
  sprite.height = startSize;
  sprite.position.copyFrom(target.root.position);
  sprite.rotation = phase * Math.PI * 2;
  if (eventType.includes("shield")) sprite.tint = 0x82e9ff;
  if (eventType.includes("detach")) sprite.tint = 0xffc857;
  layer.addChild(sprite);
  active.push({
    sprite,
    bornAt: now,
    duration: eventType.includes("destroy") ? 1_050 : VFX_LIFETIME_MS,
    startSize,
    endSize: startSize * (eventType.includes("detach") ? 0.75 : 2.1),
    originX: sprite.x,
    originY: sprite.y,
    originRotation: sprite.rotation,
    driftX: (phase - 0.5) * 22,
    driftY: (seededUnit(`${eventId}:y`) - 0.5) * 22,
    rotationSpeed: (phase - 0.5) * 0.006,
  });
}

function updateVfx(active: ActiveVfx[], now: number) {
  for (let index = active.length - 1; index >= 0; index -= 1) {
    const effect = active[index];
    const progress = clamp((now - effect.bornAt) / effect.duration, 0, 1);
    if (progress >= 1) {
      effect.sprite.destroy();
      active.splice(index, 1);
      continue;
    }
    const size = effect.startSize + (effect.endSize - effect.startSize) * progress;
    effect.sprite.width = size;
    effect.sprite.height = size;
    effect.sprite.alpha = 1 - progress;
    effect.sprite.position.set(
      effect.originX + effect.driftX * progress,
      effect.originY + effect.driftY * progress,
    );
    effect.sprite.rotation = effect.originRotation + effect.rotationSpeed * effect.duration * progress;
  }
}

function createPresentationAudio() {
  const oneShots = createGameAudioScope();
  const idle = createGameAudioLoop(BATTLE_AUDIO.engineIdle);
  const thrust = createGameAudioLoop(BATTLE_AUDIO.engineThrust);
  preloadGameAudio(Object.values(BATTLE_AUDIO));
  let lastStartAttempt = -Infinity;
  let loopsStarted = false;

  return {
    accept: (eventType: string, weaponId?: string) => {
      if (eventType.includes("weapon") || eventType.includes("fired")) {
        void oneShots.play(weaponAudioSource(weaponId), 0.4);
      } else if (eventType.includes("shield")) {
        void oneShots.play(BATTLE_AUDIO.impactShield, 0.5);
      } else if (eventType.includes("destroy") || eventType.includes("detach")) {
        void oneShots.play(BATTLE_AUDIO.explosion, 0.58);
      } else if (eventType.includes("damage") || eventType.includes("hit")) {
        void oneShots.play(BATTLE_AUDIO.impactHull, 0.44);
      }
    },
    update: (entities: readonly BattleEntitySnapshot[], now: number) => {
      if (!loopsStarted && now - lastStartAttempt > 1_500) {
        lastStartAttempt = now;
        void Promise.all([idle.start(), thrust.start()]).then(([idleStarted, thrustStarted]) => {
          loopsStarted = idleStarted && thrustStarted;
        });
      }
      const player = entities.find((entity) => entity.kind === "player");
      const speed = player
        ? Math.hypot(player.velocityXMilliPerTick, player.velocityYMilliPerTick)
        : 0;
      const normalized = clamp(speed / 22_000, 0, 1);
      idle.setVolume(player ? 0.045 + (1 - normalized) * 0.025 : 0);
      thrust.setVolume(player ? normalized * 0.16 : 0);
    },
    destroy: () => {
      oneShots.stop();
      idle.stop();
      thrust.stop();
    },
  };
}

function drawArenaFrame(frame: Graphics, transform: ReturnType<typeof makeArenaTransform>) {
  const arenaWidth = transform.arenaWidthMilli * transform.scale;
  const arenaHeight = transform.arenaHeightMilli * transform.scale;
  frame.clear()
    .rect(
      transform.centerX - arenaWidth / 2,
      transform.centerY - arenaHeight / 2,
      arenaWidth,
      arenaHeight,
    )
    .stroke({ color: 0x49d7ff, alpha: 0.16, width: 1 });
}

function makeArenaTransform(
  width: number,
  height: number,
  arenaWidthMilli: number,
  arenaHeightMilli: number,
) {
  const safeArenaWidth = Math.max(1, arenaWidthMilli);
  const safeArenaHeight = Math.max(1, arenaHeightMilli);
  return {
    centerX: width / 2,
    centerY: height / 2,
    cameraX: safeArenaWidth / 2,
    cameraY: safeArenaHeight / 2,
    scale: Math.max(0.000001, Math.min(
      (width - ENTITY_MARGIN * 2) / safeArenaWidth,
      (height - ENTITY_MARGIN * 2) / safeArenaHeight,
    )),
    arenaWidthMilli: safeArenaWidth,
    arenaHeightMilli: safeArenaHeight,
  };
}

function moduleDamageState(hp: number, hpMax: number, detached: boolean): ModuleDamageState {
  if (detached || hp <= 0) return "debris";
  const ratio = hpMax > 0 ? hp / hpMax : 0;
  if (ratio < 0.34) return "heavyDamage";
  if (ratio < 0.68) return "lightDamage";
  return "ideal";
}

function moduleSpriteKey(
  category: NonNullable<BattleEntitySnapshot["shipSystems"]>["modules"][number]["category"],
  visualKey: string,
): ModuleSpriteKey {
  if (visualKey in moduleAtlas.cells) return visualKey as ModuleSpriteKey;
  const normalized = visualKey.toLowerCase();
  if (normalized.includes("missile")) return "missileHousing";
  if (normalized.includes("rail") || normalized.includes("weapon")) return "railgunHousing";
  if (normalized.includes("plasma") && normalized.includes("thruster")) return "plasmaThruster";
  if (normalized.includes("side") && normalized.includes("thruster")) return "sideThruster";
  if (normalized.includes("battery")) return "battery";
  if (normalized.includes("armor")) return "armor";
  if (normalized.includes("hull")) return "hull";
  if (category === "core") return "core";
  if (category === "reactor") return "reactor";
  if (category === "engine") return "ionEngine";
  if (category === "weapon") return "railgunHousing";
  if (category === "shield") return "shield";
  return "utility";
}

function projectileTextureKey(weaponId?: string): BattleVfxSpriteKey {
  const normalized = weaponId?.toLowerCase() ?? "";
  if (normalized.includes("missile")) return "missileProjectile";
  if (normalized.includes("plasma") || normalized.includes("laser")) return "plasmaProjectile";
  return "kineticProjectile";
}

function eventVfxKey(eventType: string): BattleVfxSpriteKey {
  if (eventType.includes("shield")) return "shieldImpact";
  if (eventType.includes("detach")) return "debrisCluster";
  if (eventType.includes("destroy")) return "largeExplosion";
  if (eventType.includes("damage")) return "armorImpact";
  if (eventType.includes("hit")) return "kineticImpact";
  return "smallExplosion";
}

function weaponAudioSource(weaponId?: string) {
  const normalized = weaponId?.toLowerCase() ?? "";
  if (normalized.includes("missile")) return BATTLE_AUDIO.missile;
  if (normalized.includes("plasma")) return BATTLE_AUDIO.plasma;
  if (normalized.includes("laser")) return BATTLE_AUDIO.laser;
  return BATTLE_AUDIO.autocannon;
}

function seededUnit(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function measureHost(host: HTMLElement) {
  const rect = host.getBoundingClientRect();
  return {
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
