import {
  applyRichShipDamage,
  cloneRichShipState,
  cloneRichShipStats,
  consumeEnginePower,
  createAuthoritativeModuleDamage,
  createRichShipState,
  createShipSystemsSnapshot,
  prepareRichShipTick,
  richShipConfigTokens,
  richShipStateTokens,
  tryFireRichWeapon,
  validateRichShipConfig,
  type RichShipRuntimeState,
  type RichShipSystemsConfig,
  type AuthoritativeModuleDamage,
  type ShipSystemsSnapshot
} from "./rich.js";
import {
  ceilPositiveRatio,
  fixedRotationMilliRadians,
  isWithinFixedRadius,
  normalizeFixedAxis
} from "./fixed.js";

export const SIMULATION_VERSION = "2.0.0" as const;
export const SIMULATION_TICK_RATE = 30 as const;
export const SNAPSHOT_INTERVAL_TICKS = 3 as const;
export const CHECKPOINT_INTERVAL_TICKS = 60 as const;
export const INPUT_AXIS_SCALE = 1_000 as const;

const MAX_PENDING_INPUTS = 512;
const MAX_INPUT_LEAD_TICKS = 120;
const UINT32_MAX = 0xffff_ffff;

export type MissionSimulationMode = "pve" | "pvp";
export type MissionSimulationStatus = "active" | "victory" | "defeat";
export type MissionOutcomeReason =
  | "objective_complete"
  | "objective_failed"
  | "player_destroyed"
  | "time_expired"
  | "disconnect_forfeit";

export type SimulationObjectiveConfig =
  | { type: "destroy_all"; targetKills: number }
  | { type: "survive_seconds"; targetSeconds: number }
  | {
      type: "protect_target";
      targetSeconds: number;
      targetHull: number;
      collisionRadiusUnits: number;
    }
  | {
      type: "collect_scrap";
      targetScrap: number;
      scrapCount: number;
      collectionRadiusUnits: number;
    };

export type ShipSimulationStats = RichShipSystemsConfig & {
  hull: number;
  speedUnitsPerSecond: number;
  weaponDamage: number;
  weaponRangeUnits: number;
  weaponCooldownTicks: number;
  projectileSpeedUnitsPerSecond: number;
};

export type EnemySimulationStats = {
  hull: number;
  speedUnitsPerSecond: number;
  collisionRadiusUnits: number;
  attackDamage: number;
  attackRangeUnits: number;
  attackCooldownTicks: number;
};

export type EnemySimulationRosterEntry = {
  definitionKey: string;
  count: number;
  stats: EnemySimulationStats;
};

export type MissionSimulationConfig = {
  sessionId: string;
  attemptId: string;
  missionId: string;
  mode: MissionSimulationMode;
  seed: number;
  contentVersion: string;
  simulationVersion: typeof SIMULATION_VERSION;
  shipBuildRevisionId: string;
  durationSeconds: number;
  objective: SimulationObjectiveConfig;
  arenaWidthUnits: number;
  arenaHeightUnits: number;
  enemyRoster?: EnemySimulationRosterEntry[];
  /** @deprecated Checkpoint compatibility for pre-v2-rich fixtures. */
  enemyCount?: number;
  player: ShipSimulationStats;
  /** @deprecated Checkpoint compatibility for pre-v2-rich fixtures. */
  enemy?: EnemySimulationStats;
};

export type SimulationInputCommand = {
  seq: number;
  targetTick: number;
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  actionFlags: number;
};

export type InputRejectionReason =
  | "invalid"
  | "duplicate"
  | "already_processed"
  | "buffer_full";

export type InputAcceptance =
  | { accepted: true; scheduledTick: number }
  | { accepted: false; reason: InputRejectionReason };

export type SimulationEntitySnapshot = {
  id: string;
  kind: "player" | "enemy" | "projectile" | "objective";
  xMilli: number;
  yMilli: number;
  velocityXMilliPerTick: number;
  velocityYMilliPerTick: number;
  rotationMilliRadians: number;
  hull: number;
  hullMax: number;
  flags: number;
  weaponId?: string;
  shipSystems?: ShipSystemsSnapshot;
};

export type SimulationSnapshot = {
  sessionId: string;
  tick: number;
  stateHash: string;
  lastProcessedInputSequence: number;
  status: MissionSimulationStatus;
  objective: {
    type: SimulationObjectiveConfig["type"];
    progress: number;
    target: number;
  };
  entities: SimulationEntitySnapshot[];
};

export type SimulationEvent = {
  id: number;
  tick: number;
  type:
    | "weapon_fired"
    | "entity_damaged"
    | "entity_destroyed"
    | "battle_ended"
    | "shield_hit"
    | "part_damaged"
    | "module_detached"
    | "power_state_changed"
    | "overheated"
    | "objective_collected";
  entityIds: string[];
  moduleIds?: string[];
  weaponId?: string;
  value?: number;
};

export type MissionOutcome = {
  outcome: "victory" | "defeat" | "forfeit";
  reason: MissionOutcomeReason;
  finalTick: number;
  finalStateHash: string;
  moduleDamage: AuthoritativeModuleDamage[];
};

type KinematicBody = {
  xMilli: number;
  yMilli: number;
  velocityXMilliPerTick: number;
  velocityYMilliPerTick: number;
};

type PlayerState = KinematicBody & {
  id: "player";
  hull: number;
  hullMax: number;
  systems: RichShipRuntimeState;
};

type EnemyState = KinematicBody & {
  id: string;
  definitionKey: string;
  stats: EnemySimulationStats;
  hull: number;
  hullMax: number;
  attackCooldownRemaining: number;
};

type ObjectiveEntityState = KinematicBody & {
  id: string;
  objectiveKind: "protected_target" | "scrap";
  hull: number;
  hullMax: number;
  collisionRadiusUnits: number;
  collected: boolean;
};

type ProjectileState = KinematicBody & {
  id: string;
  weaponId: string;
  damage: number;
  ttlTicks: number;
};

type ActiveInputState = Omit<SimulationInputCommand, "seq" | "targetTick">;

export type MissionSimulationState = {
  tick: number;
  status: MissionSimulationStatus;
  outcomeReason: MissionOutcomeReason | null;
  rngState: number;
  lastProcessedInputSequence: number;
  nextProjectileId: number;
  nextEventId: number;
  enemiesDestroyed: number;
  scrapCollected: number;
  player: PlayerState;
  enemies: EnemyState[];
  objectiveEntities: ObjectiveEntityState[];
  projectiles: ProjectileState[];
};

export type SimulationCheckpoint = {
  formatVersion: 1;
  config: MissionSimulationConfig;
  state: MissionSimulationState;
  activeInput: ActiveInputState;
  pendingInputs: SimulationInputCommand[];
  stateHash: string;
  checkpointHash: string;
};

export type SimulationTickResult = {
  tick: number;
  stateHash: string;
  snapshot: SimulationSnapshot | null;
  events: SimulationEvent[];
  outcome: MissionOutcome | null;
};

export class SeededRng {
  private currentState: number;

  constructor(seed: number) {
    const normalized = toUint32(seed);
    this.currentState = normalized === 0 ? 0x6d2b79f5 : normalized;
  }

  static fromState(state: number): SeededRng {
    const rng = new SeededRng(1);
    rng.currentState = toUint32(state);
    return rng;
  }

  get state(): number {
    return this.currentState;
  }

  nextUint32(): number {
    let value = this.currentState;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.currentState = value >>> 0;
    return this.currentState;
  }

  nextInt(minInclusive: number, maxExclusive: number): number {
    if (!Number.isSafeInteger(minInclusive) || !Number.isSafeInteger(maxExclusive) || maxExclusive <= minInclusive) {
      throw new Error("Invalid deterministic integer range.");
    }
    return minInclusive + (this.nextUint32() % (maxExclusive - minInclusive));
  }
}

export class MissionSimulation {
  readonly config: MissionSimulationConfig;
  private state: MissionSimulationState;
  private activeInput: ActiveInputState;
  private readonly pendingInputs = new Map<number, SimulationInputCommand>();

  constructor(config: MissionSimulationConfig) {
    validateConfig(config);
    this.config = cloneConfig(config);
    const rng = new SeededRng(config.seed);
    this.state = createInitialState(this.config, rng);
    this.activeInput = neutralInput();
  }

  static fromCheckpoint(checkpoint: SimulationCheckpoint): MissionSimulation {
    if (checkpoint.formatVersion !== 1) throw new Error("Unsupported simulation checkpoint format.");
    validateConfig(checkpoint.config);
    const expectedStateHash = computeStateHash(checkpoint.config, checkpoint.state);
    if (expectedStateHash !== checkpoint.stateHash) throw new Error("Simulation checkpoint state hash mismatch.");
    const expectedCheckpointHash = computeCheckpointHash(
      checkpoint.stateHash,
      checkpoint.activeInput,
      checkpoint.pendingInputs
    );
    if (expectedCheckpointHash !== checkpoint.checkpointHash) {
      throw new Error("Simulation checkpoint input hash mismatch.");
    }

    const simulation = new MissionSimulation(checkpoint.config);
    simulation.state = cloneState(checkpoint.state);
    simulation.activeInput = { ...checkpoint.activeInput };
    for (const command of checkpoint.pendingInputs) {
      simulation.pendingInputs.set(command.seq, { ...command });
    }
    return simulation;
  }

  get tick(): number {
    return this.state.tick;
  }

  get status(): MissionSimulationStatus {
    return this.state.status;
  }

  get lastProcessedInputSequence(): number {
    return this.state.lastProcessedInputSequence;
  }

  enqueueInput(input: SimulationInputCommand): InputAcceptance {
    if (!isValidInput(input)) return { accepted: false, reason: "invalid" };
    if (input.targetTick > this.state.tick + MAX_INPUT_LEAD_TICKS) {
      return { accepted: false, reason: "invalid" };
    }
    if (input.seq <= this.state.lastProcessedInputSequence) {
      return { accepted: false, reason: "already_processed" };
    }
    if (this.pendingInputs.has(input.seq)) return { accepted: false, reason: "duplicate" };
    if (this.pendingInputs.size >= MAX_PENDING_INPUTS) return { accepted: false, reason: "buffer_full" };

    const scheduledTick = Math.max(this.state.tick + 1, input.targetTick);
    this.pendingInputs.set(input.seq, {
      ...input,
      targetTick: scheduledTick,
      moveX: clampInteger(input.moveX, -INPUT_AXIS_SCALE, INPUT_AXIS_SCALE),
      moveY: clampInteger(input.moveY, -INPUT_AXIS_SCALE, INPUT_AXIS_SCALE),
      aimX: clampInteger(input.aimX, -INPUT_AXIS_SCALE, INPUT_AXIS_SCALE),
      aimY: clampInteger(input.aimY, -INPUT_AXIS_SCALE, INPUT_AXIS_SCALE)
    });
    return { accepted: true, scheduledTick };
  }

  setNeutralInput(): void {
    this.activeInput = neutralInput();
  }

  advanceOneTick(): SimulationTickResult {
    if (this.state.status !== "active") {
      const stateHash = this.getStateHash();
      return { tick: this.state.tick, stateHash, snapshot: null, events: [], outcome: this.getOutcome() };
    }

    this.state.tick += 1;
    this.applyDueInputs();
    const events: SimulationEvent[] = [];
    this.updatePlayer(events);
    this.updateEnemies(events);
    this.updateProjectiles(events);
    this.updateObjectives(events);
    this.updateOutcome(events);
    const stateHash = this.getStateHash();

    return {
      tick: this.state.tick,
      stateHash,
      snapshot: this.state.tick % SNAPSHOT_INTERVAL_TICKS === 0 || this.state.status !== "active"
        ? this.createSnapshot(stateHash)
        : null,
      events,
      outcome: this.getOutcome(stateHash)
    };
  }

  advanceTicks(count: number): SimulationTickResult[] {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("Tick count must be a non-negative integer.");
    const results: SimulationTickResult[] = [];
    for (let index = 0; index < count; index += 1) {
      results.push(this.advanceOneTick());
      if (this.state.status !== "active") break;
    }
    return results;
  }

  forceForfeit(): MissionOutcome {
    if (this.state.status === "active") {
      this.state.status = "defeat";
      this.state.outcomeReason = "disconnect_forfeit";
    }
    return this.getOutcome() ?? fail("Unable to create forfeit outcome.");
  }

  createSnapshot(stateHash = this.getStateHash()): SimulationSnapshot {
    const objective = objectiveSnapshot(this.config, this.state);
    const entities: SimulationEntitySnapshot[] = [
      snapshotPlayer(this.state.player),
      ...this.state.enemies.map(snapshotEnemy),
      ...this.state.objectiveEntities.filter((entity) => !entity.collected).map(snapshotObjectiveEntity),
      ...this.state.projectiles.map(snapshotProjectile)
    ];
    return {
      sessionId: this.config.sessionId,
      tick: this.state.tick,
      stateHash,
      lastProcessedInputSequence: this.state.lastProcessedInputSequence,
      status: this.state.status,
      objective,
      entities
    };
  }

  createCheckpoint(): SimulationCheckpoint {
    const state = cloneState(this.state);
    const activeInput = { ...this.activeInput };
    const pendingInputs = [...this.pendingInputs.values()]
      .sort((left, right) => left.seq - right.seq)
      .map((input) => ({ ...input }));
    const stateHash = computeStateHash(this.config, state);
    return {
      formatVersion: 1,
      config: cloneConfig(this.config),
      state,
      activeInput,
      pendingInputs,
      stateHash,
      checkpointHash: computeCheckpointHash(stateHash, activeInput, pendingInputs)
    };
  }

  getStateHash(): string {
    return computeStateHash(this.config, this.state);
  }

  getOutcome(stateHash = this.getStateHash()): MissionOutcome | null {
    if (this.state.status === "active" || this.state.outcomeReason === null) return null;
    return {
      outcome: this.state.outcomeReason === "disconnect_forfeit"
        ? "forfeit"
        : this.state.status === "victory" ? "victory" : "defeat",
      reason: this.state.outcomeReason,
      finalTick: this.state.tick,
      finalStateHash: stateHash,
      moduleDamage: createAuthoritativeModuleDamage(this.config.player, this.state.player.systems)
    };
  }

  private applyDueInputs(): void {
    while (true) {
      const nextSequence = this.state.lastProcessedInputSequence + 1;
      const input = this.pendingInputs.get(nextSequence);
      if (!input || input.targetTick > this.state.tick) return;
      this.pendingInputs.delete(nextSequence);
      this.activeInput = {
        moveX: input.moveX,
        moveY: input.moveY,
        aimX: input.aimX,
        aimY: input.aimY,
        actionFlags: input.actionFlags
      };
      this.state.lastProcessedInputSequence = input.seq;
    }
  }

  private updatePlayer(events: SimulationEvent[]): void {
    const player = this.state.player;
    const brownoutBefore = player.systems.brownout;
    const systemsTransition = prepareRichShipTick(this.config.player, player.systems, true);
    if (systemsTransition.overheatedStarted) {
      events.push(this.createEvent("overheated", [player.id], { value: player.systems.heat }));
    }
    const moving = this.activeInput.moveX !== 0 || this.activeInput.moveY !== 0;
    const enginePowered = consumeEnginePower(this.config.player, player.systems, moving);
    const velocity = enginePowered
      ? velocityFromInput(
          this.activeInput.moveX,
          this.activeInput.moveY,
          this.config.player.speedUnitsPerSecond
        )
      : { x: 0, y: 0 };
    player.velocityXMilliPerTick = velocity.x;
    player.velocityYMilliPerTick = velocity.y;
    moveWithinArena(player, this.config);

    const aim = normalizedAxis(this.activeInput.aimX, this.activeInput.aimY, 0, -INPUT_AXIS_SCALE);
    for (let index = 0; index < player.systems.weapons.length; index += 1) {
      const wasOverheated = player.systems.overheated;
      const weapon = tryFireRichWeapon(
        this.config.player,
        player.systems,
        index,
        this.activeInput.actionFlags
      );
      if (!weapon) continue;
      if (!wasOverheated && player.systems.overheated) {
        events.push(this.createEvent("overheated", [player.id], { value: player.systems.heat }));
      }
      const projectileVelocity = velocityFromInput(
        aim.x,
        aim.y,
        weapon.projectileSpeedUnitsPerSecond
      );
      const id = `projectile-${this.state.nextProjectileId}`;
      this.state.nextProjectileId += 1;
      this.state.projectiles.push({
        id,
        weaponId: weapon.id,
        xMilli: player.xMilli,
        yMilli: player.yMilli,
        velocityXMilliPerTick: projectileVelocity.x,
        velocityYMilliPerTick: projectileVelocity.y,
        damage: weapon.damage,
        ttlTicks: Math.max(
          1,
          ceilPositiveRatio(
            weapon.rangeUnits * SIMULATION_TICK_RATE,
            weapon.projectileSpeedUnitsPerSecond
          )
        )
      });
      events.push(this.createEvent("weapon_fired", [player.id, id], { weaponId: weapon.id }));
    }
    if (brownoutBefore !== player.systems.brownout) {
      events.push(this.createEvent("power_state_changed", [player.id], {
        value: player.systems.brownout ? 1 : 0
      }));
    }
  }

  private updateEnemies(events: SimulationEvent[]): void {
    const player = this.state.player;
    const protectedTarget = this.state.objectiveEntities.find((entity) =>
      entity.objectiveKind === "protected_target" && entity.hull > 0
    );
    for (const enemy of this.state.enemies) {
      if (enemy.hull <= 0) continue;
      const target = protectedTarget && protectedTarget.hull > 0 ? protectedTarget : player;
      const direction = normalizedAxis(
        target.xMilli - enemy.xMilli,
        target.yMilli - enemy.yMilli,
        0,
        0
      );
      const velocity = velocityFromInput(direction.x, direction.y, enemy.stats.speedUnitsPerSecond);
      enemy.velocityXMilliPerTick = velocity.x;
      enemy.velocityYMilliPerTick = velocity.y;
      moveWithinArena(enemy, this.config);
      enemy.attackCooldownRemaining = Math.max(0, enemy.attackCooldownRemaining - 1);

      if (enemy.attackCooldownRemaining > 0
        || !isWithinFixedRadius(
          enemy.xMilli,
          enemy.yMilli,
          target.xMilli,
          target.yMilli,
          enemy.stats.attackRangeUnits * 1_000
        )) {
        continue;
      }
      if (target !== player) {
        const damage = Math.min(target.hull, enemy.stats.attackDamage);
        target.hull -= damage;
        enemy.attackCooldownRemaining = enemy.stats.attackCooldownTicks;
        events.push(this.createEvent("entity_damaged", [target.id, enemy.id], { value: damage }));
        if (target.hull === 0) events.push(this.createEvent("entity_destroyed", [target.id]));
        continue;
      }
      const damage = applyRichShipDamage(
        this.config.player,
        player.systems,
        enemy.stats.attackDamage,
        0,
        0
      );
      player.hull = damage.coreDestroyed
        ? 0
        : Math.max(0, player.hull - damage.hullDamage);
      enemy.attackCooldownRemaining = enemy.stats.attackCooldownTicks;
      if (damage.shieldDamage > 0) {
        events.push(this.createEvent("shield_hit", [player.id, enemy.id], { value: damage.shieldDamage }));
      }
      if (damage.moduleId) {
        events.push(this.createEvent("part_damaged", [player.id, enemy.id], {
          moduleIds: [damage.moduleId],
          value: damage.moduleDamage
        }));
      }
      if (damage.detachedModuleIds.length > 0) {
        events.push(this.createEvent("module_detached", [player.id], {
          moduleIds: damage.detachedModuleIds
        }));
      }
      if (damage.hullDamage > 0) {
        events.push(this.createEvent("entity_damaged", [player.id, enemy.id], { value: damage.hullDamage }));
      }
    }
  }

  private updateProjectiles(events: SimulationEvent[]): void {
    const survivingProjectiles: ProjectileState[] = [];
    for (const projectile of this.state.projectiles) {
      projectile.xMilli += projectile.velocityXMilliPerTick;
      projectile.yMilli += projectile.velocityYMilliPerTick;
      projectile.ttlTicks -= 1;
      let hit = false;
      for (const enemy of this.state.enemies) {
        if (enemy.hull <= 0
          || !isWithinFixedRadius(
            projectile.xMilli,
            projectile.yMilli,
            enemy.xMilli,
            enemy.yMilli,
            enemy.stats.collisionRadiusUnits * 1_000
          )) {
          continue;
        }
        enemy.hull = Math.max(0, enemy.hull - projectile.damage);
        events.push(this.createEvent("entity_damaged", [enemy.id, projectile.id]));
        if (enemy.hull === 0) {
          this.state.enemiesDestroyed += 1;
          enemy.velocityXMilliPerTick = 0;
          enemy.velocityYMilliPerTick = 0;
          events.push(this.createEvent("entity_destroyed", [enemy.id]));
        }
        hit = true;
        break;
      }
      if (!hit && projectile.ttlTicks > 0 && isInsideArena(projectile, this.config)) {
        survivingProjectiles.push(projectile);
      }
    }
    this.state.projectiles = survivingProjectiles;
  }

  private updateObjectives(events: SimulationEvent[]): void {
    if (this.config.objective.type !== "collect_scrap") return;
    for (const objectiveEntity of this.state.objectiveEntities) {
      if (objectiveEntity.objectiveKind !== "scrap" || objectiveEntity.collected) continue;
      const collectionRadiusMilli = this.config.objective.collectionRadiusUnits * 1_000;
      if (!isWithinFixedRadius(
        this.state.player.xMilli,
        this.state.player.yMilli,
        objectiveEntity.xMilli,
        objectiveEntity.yMilli,
        collectionRadiusMilli
      )) continue;
      objectiveEntity.collected = true;
      objectiveEntity.hull = 0;
      this.state.scrapCollected += 1;
      events.push(this.createEvent("objective_collected", [this.state.player.id, objectiveEntity.id], {
        value: this.state.scrapCollected
      }));
    }
  }

  private updateOutcome(events: SimulationEvent[]): void {
    if (this.state.player.hull <= 0) {
      this.state.status = "defeat";
      this.state.outcomeReason = "player_destroyed";
    } else if (protectedTargetDestroyed(this.config, this.state)) {
      this.state.status = "defeat";
      this.state.outcomeReason = "objective_failed";
    } else if (objectiveComplete(this.config, this.state)) {
      this.state.status = "victory";
      this.state.outcomeReason = "objective_complete";
    } else if (this.state.tick >= this.config.durationSeconds * SIMULATION_TICK_RATE) {
      this.state.status = "defeat";
      this.state.outcomeReason = "time_expired";
    }
    if (this.state.status !== "active") {
      events.push(this.createEvent("battle_ended", [this.state.player.id]));
    }
  }

  private createEvent(
    type: SimulationEvent["type"],
    entityIds: string[],
    details: Pick<SimulationEvent, "moduleIds" | "weaponId" | "value"> = {}
  ): SimulationEvent {
    const event = { id: this.state.nextEventId, tick: this.state.tick, type, entityIds, ...details };
    this.state.nextEventId += 1;
    return event;
  }
}

export function seedFromString(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function createInitialState(config: MissionSimulationConfig, rng: SeededRng): MissionSimulationState {
  const widthMilli = config.arenaWidthUnits * 1_000;
  const heightMilli = config.arenaHeightUnits * 1_000;
  const enemies: EnemyState[] = [];
  for (const rosterEntry of resolveEnemyRoster(config)) {
    for (let index = 0; index < rosterEntry.count; index += 1) {
      const margin = rosterEntry.stats.collisionRadiusUnits * 1_000;
      enemies.push({
        id: `enemy-${enemies.length + 1}`,
        definitionKey: rosterEntry.definitionKey,
        stats: { ...rosterEntry.stats },
        xMilli: rng.nextInt(margin, widthMilli - margin),
        yMilli: rng.nextInt(margin, heightMilli - margin),
        velocityXMilliPerTick: 0,
        velocityYMilliPerTick: 0,
        hull: rosterEntry.stats.hull,
        hullMax: rosterEntry.stats.hull,
        attackCooldownRemaining: rosterEntry.stats.attackCooldownTicks
      });
    }
  }
  const objectiveEntities = createObjectiveEntities(config, rng, widthMilli, heightMilli);
  return {
    tick: 0,
    status: "active",
    outcomeReason: null,
    rngState: rng.state,
    lastProcessedInputSequence: 0,
    nextProjectileId: 1,
    nextEventId: 1,
    enemiesDestroyed: 0,
    scrapCollected: 0,
    player: {
      id: "player",
      xMilli: Math.trunc(widthMilli / 2),
      yMilli: config.objective.type === "protect_target"
        ? Math.min(heightMilli, Math.trunc(heightMilli / 2) + 150_000)
        : Math.trunc(heightMilli / 2),
      velocityXMilliPerTick: 0,
      velocityYMilliPerTick: 0,
      hull: config.player.hull,
      hullMax: config.player.hull,
      systems: createRichShipState(config.player)
    },
    enemies,
    objectiveEntities,
    projectiles: []
  };
}

function createObjectiveEntities(
  config: MissionSimulationConfig,
  rng: SeededRng,
  widthMilli: number,
  heightMilli: number
): ObjectiveEntityState[] {
  if (config.objective.type === "protect_target") {
    return [{
      id: "objective-convoy",
      objectiveKind: "protected_target",
      xMilli: Math.trunc(widthMilli / 2),
      yMilli: Math.trunc(heightMilli / 2),
      velocityXMilliPerTick: 0,
      velocityYMilliPerTick: 0,
      hull: config.objective.targetHull,
      hullMax: config.objective.targetHull,
      collisionRadiusUnits: config.objective.collisionRadiusUnits,
      collected: false
    }];
  }
  if (config.objective.type !== "collect_scrap") return [];
  const margin = config.objective.collectionRadiusUnits * 1_000;
  const entities: ObjectiveEntityState[] = [];
  for (let index = 0; index < config.objective.scrapCount; index += 1) {
    entities.push({
      id: `objective-scrap-${index + 1}`,
      objectiveKind: "scrap",
      xMilli: rng.nextInt(margin, widthMilli - margin),
      yMilli: rng.nextInt(margin, heightMilli - margin),
      velocityXMilliPerTick: 0,
      velocityYMilliPerTick: 0,
      hull: 1,
      hullMax: 1,
      collisionRadiusUnits: config.objective.collectionRadiusUnits,
      collected: false
    });
  }
  return entities;
}

function validateConfig(config: MissionSimulationConfig): void {
  if (config.simulationVersion !== SIMULATION_VERSION) throw new Error("Unsupported simulation version.");
  for (const value of [config.sessionId, config.attemptId, config.missionId, config.contentVersion, config.shipBuildRevisionId]) {
    if (typeof value !== "string" || value.length === 0) throw new Error("Simulation identifiers must be non-empty.");
  }
  for (const value of [config.durationSeconds, config.arenaWidthUnits, config.arenaHeightUnits]) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 1_000_000) {
      throw new Error("Simulation dimensions and duration must be bounded positive integers.");
    }
  }
  const enemyRoster = resolveEnemyRoster(config);
  const enemyCount = enemyRoster.reduce((sum, entry) => sum + entry.count, 0);
  if (enemyCount > 512) throw new Error("Enemy count must be an integer between 0 and 512.");
  if (!Number.isSafeInteger(config.seed) || config.seed < 0 || config.seed > UINT32_MAX) {
    throw new Error("Simulation seed must be an unsigned 32-bit integer.");
  }
  switch (config.objective.type) {
    case "destroy_all":
      if (!Number.isSafeInteger(config.objective.targetKills)
        || config.objective.targetKills <= 0
        || config.objective.targetKills !== enemyCount) {
        throw new Error("Destroy-all objective must target the complete configured enemy population.");
      }
      break;
    case "survive_seconds":
      validateObjectiveSeconds(config.objective.targetSeconds, config.durationSeconds, "Survival");
      break;
    case "protect_target":
      validateObjectiveSeconds(config.objective.targetSeconds, config.durationSeconds, "Protect-target");
      validateBoundedPositiveInteger(config.objective.targetHull, "Protect-target hull");
      validateBoundedPositiveInteger(config.objective.collisionRadiusUnits, "Protect-target collision radius");
      break;
    case "collect_scrap":
      validateBoundedPositiveInteger(config.objective.targetScrap, "Collect-scrap target");
      validateBoundedPositiveInteger(config.objective.scrapCount, "Collect-scrap entity count");
      validateBoundedPositiveInteger(config.objective.collectionRadiusUnits, "Collect-scrap radius");
      if (config.objective.targetScrap > config.objective.scrapCount || config.objective.scrapCount > 512) {
        throw new Error("Collect-scrap target must fit the configured scrap population.");
      }
      break;
  }
  validatePlayerStats(config.player);
  for (const [index, entry] of enemyRoster.entries()) {
    if (!entry.definitionKey || entry.definitionKey.length > 128) {
      throw new Error(`enemyRoster[${index}].definitionKey must be a bounded non-empty string.`);
    }
    if (!Number.isSafeInteger(entry.count) || entry.count <= 0 || entry.count > 512) {
      throw new Error(`enemyRoster[${index}].count must be a bounded positive integer.`);
    }
    validateStats(entry.stats, `enemyRoster[${index}].stats`);
  }
  const maximumCollisionRadius = Math.max(
    config.objective.type === "collect_scrap" ? config.objective.collectionRadiusUnits : 0,
    config.objective.type === "protect_target" ? config.objective.collisionRadiusUnits : 0,
    ...enemyRoster.map((entry) => entry.stats.collisionRadiusUnits),
    1
  );
  const minimumArenaDimension = maximumCollisionRadius * 2 + 1;
  if (config.arenaWidthUnits < minimumArenaDimension || config.arenaHeightUnits < minimumArenaDimension) {
    throw new Error("Arena is too small for the configured collision radius.");
  }
}

function validateObjectiveSeconds(value: number, durationSeconds: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > durationSeconds) {
    throw new Error(`${label} objective must fit inside the mission duration.`);
  }
}

function validateBoundedPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 1_000_000) {
    throw new Error(`${label} must be a bounded positive integer.`);
  }
}

function resolveEnemyRoster(config: MissionSimulationConfig): EnemySimulationRosterEntry[] {
  if (Array.isArray(config.enemyRoster)) {
    return config.enemyRoster.map((entry) => ({
      definitionKey: entry.definitionKey,
      count: entry.count,
      stats: { ...entry.stats }
    }));
  }
  const legacyEnemyCount = config.enemyCount;
  if (config.enemy && typeof legacyEnemyCount === "number"
    && Number.isSafeInteger(legacyEnemyCount) && legacyEnemyCount >= 0) {
    return legacyEnemyCount === 0 ? [] : [{
      definitionKey: "legacy-enemy",
      count: legacyEnemyCount,
      stats: { ...config.enemy }
    }];
  }
  throw new Error("Simulation requires an explicit enemy roster.");
}

function validateStats(stats: Record<string, number>, label: string): void {
  for (const [key, value] of Object.entries(stats)) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 1_000_000) {
      throw new Error(`${label}.${key} must be a bounded positive integer.`);
    }
  }
}

function validatePlayerStats(stats: ShipSimulationStats): void {
  validateStats({
    hull: stats.hull,
    speedUnitsPerSecond: stats.speedUnitsPerSecond,
    weaponDamage: stats.weaponDamage,
    weaponRangeUnits: stats.weaponRangeUnits,
    weaponCooldownTicks: stats.weaponCooldownTicks,
    projectileSpeedUnitsPerSecond: stats.projectileSpeedUnitsPerSecond
  }, "player");
  validateRichShipConfig(stats, "player");
}

function isValidInput(input: SimulationInputCommand): boolean {
  return Number.isSafeInteger(input.seq)
    && input.seq > 0
    && Number.isSafeInteger(input.targetTick)
    && input.targetTick >= 0
    && Number.isSafeInteger(input.moveX)
    && Number.isSafeInteger(input.moveY)
    && Number.isSafeInteger(input.aimX)
    && Number.isSafeInteger(input.aimY)
    && Number.isSafeInteger(input.actionFlags)
    && input.actionFlags >= 0
    && input.actionFlags <= UINT32_MAX;
}

function neutralInput(): ActiveInputState {
  return { moveX: 0, moveY: 0, aimX: 0, aimY: -INPUT_AXIS_SCALE, actionFlags: 0 };
}

function velocityFromInput(x: number, y: number, speedUnitsPerSecond: number): { x: number; y: number } {
  const normalized = normalizedAxis(x, y, 0, 0);
  const speedMilliPerTick = Math.trunc((speedUnitsPerSecond * 1_000) / SIMULATION_TICK_RATE);
  return {
    x: Math.trunc((normalized.x * speedMilliPerTick) / INPUT_AXIS_SCALE),
    y: Math.trunc((normalized.y * speedMilliPerTick) / INPUT_AXIS_SCALE)
  };
}

function normalizedAxis(
  x: number,
  y: number,
  fallbackX: number,
  fallbackY: number
): { x: number; y: number } {
  return normalizeFixedAxis(x, y, INPUT_AXIS_SCALE, fallbackX, fallbackY);
}

function moveWithinArena(body: KinematicBody, config: MissionSimulationConfig): void {
  body.xMilli = clampInteger(body.xMilli + body.velocityXMilliPerTick, 0, config.arenaWidthUnits * 1_000);
  body.yMilli = clampInteger(body.yMilli + body.velocityYMilliPerTick, 0, config.arenaHeightUnits * 1_000);
}

function isInsideArena(body: KinematicBody, config: MissionSimulationConfig): boolean {
  return body.xMilli >= 0
    && body.yMilli >= 0
    && body.xMilli <= config.arenaWidthUnits * 1_000
    && body.yMilli <= config.arenaHeightUnits * 1_000;
}

function objectiveComplete(config: MissionSimulationConfig, state: MissionSimulationState): boolean {
  switch (config.objective.type) {
    case "destroy_all":
      return state.enemiesDestroyed >= config.objective.targetKills;
    case "survive_seconds":
    case "protect_target":
      return state.tick >= config.objective.targetSeconds * SIMULATION_TICK_RATE;
    case "collect_scrap":
      return state.scrapCollected >= config.objective.targetScrap;
  }
}

function protectedTargetDestroyed(config: MissionSimulationConfig, state: MissionSimulationState): boolean {
  return config.objective.type === "protect_target"
    && state.objectiveEntities.some((entity) => entity.objectiveKind === "protected_target" && entity.hull <= 0);
}

function objectiveSnapshot(
  config: MissionSimulationConfig,
  state: MissionSimulationState
): SimulationSnapshot["objective"] {
  switch (config.objective.type) {
    case "destroy_all":
      return { type: "destroy_all", progress: state.enemiesDestroyed, target: config.objective.targetKills };
    case "survive_seconds":
      return {
        type: "survive_seconds",
        progress: Math.min(config.objective.targetSeconds, Math.floor(state.tick / SIMULATION_TICK_RATE)),
        target: config.objective.targetSeconds
      };
    case "protect_target":
      return {
        type: "protect_target",
        progress: Math.min(config.objective.targetSeconds, Math.floor(state.tick / SIMULATION_TICK_RATE)),
        target: config.objective.targetSeconds
      };
    case "collect_scrap":
      return {
        type: "collect_scrap",
        progress: state.scrapCollected,
        target: config.objective.targetScrap
      };
  }
}

function snapshotPlayer(player: PlayerState): SimulationEntitySnapshot {
  return {
    ...snapshotBody(player, "player", player.hull, player.hullMax, player.hull <= 0 ? 1 : 0),
    shipSystems: createShipSystemsSnapshot(player.systems)
  };
}

function snapshotEnemy(enemy: EnemyState): SimulationEntitySnapshot {
  return snapshotBody(enemy, "enemy", enemy.hull, enemy.hullMax, enemy.hull <= 0 ? 1 : 0);
}

function snapshotObjectiveEntity(entity: ObjectiveEntityState): SimulationEntitySnapshot {
  return snapshotBody(
    entity,
    "objective",
    entity.hull,
    entity.hullMax,
    entity.objectiveKind === "scrap" ? 2 : entity.hull <= 0 ? 1 : 0
  );
}

function snapshotProjectile(projectile: ProjectileState): SimulationEntitySnapshot {
  return {
    ...snapshotBody(projectile, "projectile", 1, 1, 0),
    weaponId: projectile.weaponId
  };
}

function snapshotBody(
  body: KinematicBody & { id: string },
  kind: SimulationEntitySnapshot["kind"],
  hull: number,
  hullMax: number,
  flags: number
): SimulationEntitySnapshot {
  return {
    id: body.id,
    kind,
    xMilli: body.xMilli,
    yMilli: body.yMilli,
    velocityXMilliPerTick: body.velocityXMilliPerTick,
    velocityYMilliPerTick: body.velocityYMilliPerTick,
    rotationMilliRadians: rotationFromVelocity(body.velocityXMilliPerTick, body.velocityYMilliPerTick),
    hull,
    hullMax,
    flags
  };
}

function rotationFromVelocity(x: number, y: number): number {
  return fixedRotationMilliRadians(x, y);
}

function computeStateHash(config: MissionSimulationConfig, state: MissionSimulationState): string {
  const objectiveConfigTokens = simulationObjectiveConfigTokens(config.objective);
  const enemyRoster = resolveEnemyRoster(config);
  const tokens: Array<string | number> = [
    SIMULATION_VERSION,
    config.contentVersion,
    config.sessionId,
    config.attemptId,
    config.missionId,
    config.shipBuildRevisionId,
    config.mode,
    config.seed,
    config.durationSeconds,
    ...objectiveConfigTokens,
    config.arenaWidthUnits,
    config.arenaHeightUnits,
    enemyRoster.reduce((sum, entry) => sum + entry.count, 0),
    config.player.hull,
    config.player.speedUnitsPerSecond,
    config.player.weaponDamage,
    config.player.weaponRangeUnits,
    config.player.weaponCooldownTicks,
    config.player.projectileSpeedUnitsPerSecond,
    ...richShipConfigTokens(config.player),
    state.tick,
    state.status,
    state.outcomeReason ?? "-",
    state.rngState,
    state.lastProcessedInputSequence,
    state.nextProjectileId,
    state.nextEventId,
    state.enemiesDestroyed,
    state.scrapCollected,
    ...bodyTokens(state.player),
    state.player.hull,
    ...richShipStateTokens(state.player.systems)
  ];
  for (const rosterEntry of enemyRoster) {
    tokens.push(rosterEntry.definitionKey, rosterEntry.count, ...enemyStatsTokens(rosterEntry.stats));
  }
  for (const enemy of state.enemies) {
    tokens.push(
      ...bodyTokens(enemy),
      enemy.definitionKey,
      ...enemyStatsTokens(enemy.stats),
      enemy.hull,
      enemy.attackCooldownRemaining
    );
  }
  for (const objectiveEntity of state.objectiveEntities) {
    tokens.push(
      ...bodyTokens(objectiveEntity),
      objectiveEntity.objectiveKind,
      objectiveEntity.hull,
      objectiveEntity.hullMax,
      objectiveEntity.collisionRadiusUnits,
      objectiveEntity.collected ? 1 : 0
    );
  }
  for (const projectile of state.projectiles) {
    tokens.push(...bodyTokens(projectile), projectile.weaponId, projectile.damage, projectile.ttlTicks);
  }
  return fnv1a64(tokens.join("|"));
}

function simulationObjectiveConfigTokens(objective: SimulationObjectiveConfig): Array<string | number> {
  switch (objective.type) {
    case "destroy_all":
      return [objective.type, objective.targetKills];
    case "survive_seconds":
      return [objective.type, objective.targetSeconds];
    case "protect_target":
      return [objective.type, objective.targetSeconds, objective.targetHull, objective.collisionRadiusUnits];
    case "collect_scrap":
      return [objective.type, objective.targetScrap, objective.scrapCount, objective.collectionRadiusUnits];
  }
}

function enemyStatsTokens(stats: EnemySimulationStats): number[] {
  return [
    stats.hull,
    stats.speedUnitsPerSecond,
    stats.collisionRadiusUnits,
    stats.attackDamage,
    stats.attackRangeUnits,
    stats.attackCooldownTicks
  ];
}

function computeCheckpointHash(
  stateHash: string,
  activeInput: ActiveInputState,
  pendingInputs: SimulationInputCommand[]
): string {
  const tokens: Array<string | number> = [
    stateHash,
    activeInput.moveX,
    activeInput.moveY,
    activeInput.aimX,
    activeInput.aimY,
    activeInput.actionFlags
  ];
  for (const input of pendingInputs) {
    tokens.push(
      input.seq,
      input.targetTick,
      input.moveX,
      input.moveY,
      input.aimX,
      input.aimY,
      input.actionFlags
    );
  }
  return fnv1a64(tokens.join("|"));
}

function bodyTokens(body: KinematicBody & { id: string }): Array<string | number> {
  return [
    body.id,
    body.xMilli,
    body.yMilli,
    body.velocityXMilliPerTick,
    body.velocityYMilliPerTick
  ];
}

function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function cloneConfig(config: MissionSimulationConfig): MissionSimulationConfig {
  return {
    ...config,
    objective: { ...config.objective },
    player: cloneRichShipStats(config.player),
    enemyRoster: config.enemyRoster?.map((entry) => ({
      ...entry,
      stats: { ...entry.stats }
    })),
    enemy: config.enemy ? { ...config.enemy } : undefined
  };
}

function cloneState(state: MissionSimulationState): MissionSimulationState {
  return {
    ...state,
    player: { ...state.player, systems: cloneRichShipState(state.player.systems) },
    enemies: state.enemies.map((enemy) => ({ ...enemy, stats: { ...enemy.stats } })),
    objectiveEntities: state.objectiveEntities.map((entity) => ({ ...entity })),
    projectiles: state.projectiles.map((projectile) => ({ ...projectile }))
  };
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function toUint32(value: number): number {
  return Math.trunc(value) >>> 0;
}

function fail(message: string): never {
  throw new Error(message);
}

export * from "./rich.js";
export * from "./duel.js";
