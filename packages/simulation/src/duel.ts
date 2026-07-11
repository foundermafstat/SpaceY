import type {
  InputAcceptance,
  ShipSimulationStats,
  SIMULATION_VERSION,
  SimulationInputCommand
} from "./index.js";

const DUEL_SIMULATION_VERSION: typeof SIMULATION_VERSION = "1.0.0";
const DUEL_TICK_RATE = 30;
const DUEL_SNAPSHOT_INTERVAL_TICKS = 3;
const DUEL_INPUT_AXIS_SCALE = 1_000;
const MAX_PENDING_INPUTS_PER_USER = 512;
const MAX_INPUT_LEAD_TICKS = 120;
const UINT32_MAX = 0xffff_ffff;

export type DuelSide = "alpha" | "beta";
export type DuelSimulationStatus = "active" | "ended";
export type DuelOutcomeReason = "ship_destroyed" | "time_expired" | "disconnect_forfeit";

export type DuelShipBuildStats = ShipSimulationStats & {
  collisionRadiusUnits: number;
};

export type DuelParticipantConfig = {
  participantId: string;
  userId: string;
  side: DuelSide;
  shipBuildRevisionId: string;
  buildStats: DuelShipBuildStats;
};

export type DuelSimulationConfig = {
  matchId: string;
  sessionId: string;
  seed: number;
  contentVersion: string;
  simulationVersion: typeof SIMULATION_VERSION;
  durationSeconds: number;
  arenaWidthUnits: number;
  arenaHeightUnits: number;
  participants: [DuelParticipantConfig, DuelParticipantConfig];
};

type DuelKinematicBody = {
  xMilli: number;
  yMilli: number;
  velocityXMilliPerTick: number;
  velocityYMilliPerTick: number;
};

export type DuelShipState = DuelKinematicBody & {
  id: string;
  participantId: string;
  userId: string;
  side: DuelSide;
  hull: number;
  hullMax: number;
  weaponCooldownRemaining: number;
};

export type DuelProjectileState = DuelKinematicBody & {
  id: string;
  ownerUserId: string;
  ownerSide: DuelSide;
  damage: number;
  ttlTicks: number;
};

export type DuelSimulationState = {
  tick: number;
  status: DuelSimulationStatus;
  outcomeReason: DuelOutcomeReason | null;
  winnerUserId: string | null;
  loserUserId: string | null;
  nextProjectileId: number;
  nextEventId: number;
  ships: [DuelShipState, DuelShipState];
  projectiles: DuelProjectileState[];
};

type DuelActiveInput = Omit<SimulationInputCommand, "seq" | "targetTick">;

export type DuelInputStreamCheckpoint = {
  userId: string;
  lastProcessedInputSequence: number;
  activeInput: DuelActiveInput;
  pendingInputs: SimulationInputCommand[];
};

export type DuelSimulationCheckpoint = {
  formatVersion: 1;
  config: DuelSimulationConfig;
  state: DuelSimulationState;
  inputStreams: [DuelInputStreamCheckpoint, DuelInputStreamCheckpoint];
  stateHash: string;
  checkpointHash: string;
};

export type DuelParticipantOutcome = {
  userId: string;
  outcome: "victory" | "defeat" | "forfeit";
  reason: DuelOutcomeReason;
};

export type DuelOutcome = {
  matchId: string;
  sessionId: string;
  winnerUserId: string;
  loserUserId: string;
  reason: DuelOutcomeReason;
  finalTick: number;
  finalStateHash: string;
  results: [DuelParticipantOutcome, DuelParticipantOutcome];
};

export type DuelSimulationEntitySnapshot = {
  id: string;
  kind: "ship" | "projectile";
  participantId: string | null;
  ownerUserId: string;
  side: DuelSide;
  xMilli: number;
  yMilli: number;
  velocityXMilliPerTick: number;
  velocityYMilliPerTick: number;
  rotationMilliRadians: number;
  hull: number;
  hullMax: number;
  flags: number;
};

export type DuelSimulationSnapshot = {
  matchId: string;
  sessionId: string;
  tick: number;
  stateHash: string;
  status: DuelSimulationStatus;
  lastProcessedInputSequences: Record<string, number>;
  entities: DuelSimulationEntitySnapshot[];
  outcome: DuelOutcome | null;
};

export type DuelSimulationEvent = {
  id: number;
  tick: number;
  type: "weapon_fired" | "entity_damaged" | "entity_destroyed" | "battle_ended";
  entityIds: string[];
  userIds: string[];
};

export type DuelSimulationTickResult = {
  tick: number;
  stateHash: string;
  snapshot: DuelSimulationSnapshot | null;
  events: DuelSimulationEvent[];
  outcome: DuelOutcome | null;
};

type DuelInputStream = {
  lastProcessedInputSequence: number;
  activeInput: DuelActiveInput;
  pendingInputs: Map<number, SimulationInputCommand>;
};

export class DuelSimulation {
  readonly config: DuelSimulationConfig;
  private state: DuelSimulationState;
  private readonly inputStreams = new Map<string, DuelInputStream>();

  constructor(config: DuelSimulationConfig) {
    validateDuelConfig(config);
    this.config = cloneDuelConfig(config);
    this.state = createInitialDuelState(this.config);
    for (const participant of this.config.participants) {
      this.inputStreams.set(participant.userId, {
        lastProcessedInputSequence: 0,
        activeInput: neutralDuelInput(participant.side),
        pendingInputs: new Map()
      });
    }
  }

  static fromCheckpoint(checkpoint: DuelSimulationCheckpoint): DuelSimulation {
    if (checkpoint.formatVersion !== 1) throw new Error("Unsupported duel checkpoint format.");
    validateDuelConfig(checkpoint.config);
    validateDuelCheckpointShape(checkpoint);

    const expectedStateHash = computeDuelStateHash(checkpoint.config, checkpoint.state, checkpoint.inputStreams);
    if (expectedStateHash !== checkpoint.stateHash) throw new Error("Duel checkpoint state hash mismatch.");
    const expectedCheckpointHash = computeDuelCheckpointHash(checkpoint.stateHash, checkpoint.inputStreams);
    if (expectedCheckpointHash !== checkpoint.checkpointHash) {
      throw new Error("Duel checkpoint input hash mismatch.");
    }

    const simulation = new DuelSimulation(checkpoint.config);
    simulation.state = cloneDuelState(checkpoint.state);
    simulation.inputStreams.clear();
    for (const stream of checkpoint.inputStreams) {
      simulation.inputStreams.set(stream.userId, {
        lastProcessedInputSequence: stream.lastProcessedInputSequence,
        activeInput: { ...stream.activeInput },
        pendingInputs: new Map(stream.pendingInputs.map((input) => [input.seq, { ...input }]))
      });
    }
    return simulation;
  }

  get tick(): number {
    return this.state.tick;
  }

  get status(): DuelSimulationStatus {
    return this.state.status;
  }

  enqueueInput(userId: string, input: SimulationInputCommand): InputAcceptance {
    const stream = this.requireInputStream(userId);
    if (this.state.status !== "active" || !isValidDuelInput(input)) {
      return { accepted: false, reason: "invalid" };
    }
    if (input.targetTick > this.state.tick + MAX_INPUT_LEAD_TICKS) {
      return { accepted: false, reason: "invalid" };
    }
    if (input.seq <= stream.lastProcessedInputSequence) {
      return { accepted: false, reason: "already_processed" };
    }
    if (stream.pendingInputs.has(input.seq)) return { accepted: false, reason: "duplicate" };
    if (stream.pendingInputs.size >= MAX_PENDING_INPUTS_PER_USER) {
      return { accepted: false, reason: "buffer_full" };
    }

    const scheduledTick = Math.max(this.state.tick + 1, input.targetTick);
    stream.pendingInputs.set(input.seq, {
      ...input,
      targetTick: scheduledTick,
      moveX: clampDuelInteger(input.moveX, -DUEL_INPUT_AXIS_SCALE, DUEL_INPUT_AXIS_SCALE),
      moveY: clampDuelInteger(input.moveY, -DUEL_INPUT_AXIS_SCALE, DUEL_INPUT_AXIS_SCALE),
      aimX: clampDuelInteger(input.aimX, -DUEL_INPUT_AXIS_SCALE, DUEL_INPUT_AXIS_SCALE),
      aimY: clampDuelInteger(input.aimY, -DUEL_INPUT_AXIS_SCALE, DUEL_INPUT_AXIS_SCALE)
    });
    return { accepted: true, scheduledTick };
  }

  setNeutralInput(userId: string): void {
    const participant = this.requireParticipant(userId);
    const stream = this.requireInputStream(userId);
    stream.pendingInputs.clear();
    stream.activeInput = neutralDuelInput(participant.side);
  }

  lastProcessedInputSequence(userId: string): number {
    return this.requireInputStream(userId).lastProcessedInputSequence;
  }

  advanceOneTick(): DuelSimulationTickResult {
    if (this.state.status !== "active") {
      const stateHash = this.getStateHash();
      return {
        tick: this.state.tick,
        stateHash,
        snapshot: null,
        events: [],
        outcome: this.getOutcome(stateHash)
      };
    }

    this.state.tick += 1;
    this.applyDueInputs();
    const events: DuelSimulationEvent[] = [];
    this.updateShips(events);
    this.updateProjectiles(events);
    this.updateOutcome(events);
    const stateHash = this.getStateHash();
    return {
      tick: this.state.tick,
      stateHash,
      snapshot: this.state.tick % DUEL_SNAPSHOT_INTERVAL_TICKS === 0 || this.status === "ended"
        ? this.createSnapshot(stateHash)
        : null,
      events,
      outcome: this.getOutcome(stateHash)
    };
  }

  advanceTicks(count: number): DuelSimulationTickResult[] {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("Tick count must be a non-negative integer.");
    const results: DuelSimulationTickResult[] = [];
    for (let index = 0; index < count; index += 1) {
      results.push(this.advanceOneTick());
      if (this.state.status !== "active") break;
    }
    return results;
  }

  forceForfeit(loserUserId: string): DuelOutcome {
    this.requireParticipant(loserUserId);
    if (this.state.status === "active") {
      const winner = this.config.participants.find((participant) => participant.userId !== loserUserId);
      if (!winner) throw new Error("Duel winner is unavailable.");
      this.endDuel(winner.userId, loserUserId, "disconnect_forfeit");
    }
    return this.getOutcome() ?? duelFail("Unable to create duel forfeit outcome.");
  }

  createSnapshot(stateHash = this.getStateHash()): DuelSimulationSnapshot {
    return {
      matchId: this.config.matchId,
      sessionId: this.config.sessionId,
      tick: this.state.tick,
      stateHash,
      status: this.state.status,
      lastProcessedInputSequences: Object.fromEntries(
        this.config.participants.map((participant) => [
          participant.userId,
          this.requireInputStream(participant.userId).lastProcessedInputSequence
        ])
      ),
      entities: [
        ...this.state.ships.map(snapshotDuelShip),
        ...this.state.projectiles.map(snapshotDuelProjectile)
      ],
      outcome: this.getOutcome(stateHash)
    };
  }

  createCheckpoint(): DuelSimulationCheckpoint {
    const state = cloneDuelState(this.state);
    const inputStreams = this.config.participants.map((participant) => {
      const stream = this.requireInputStream(participant.userId);
      return {
        userId: participant.userId,
        lastProcessedInputSequence: stream.lastProcessedInputSequence,
        activeInput: { ...stream.activeInput },
        pendingInputs: [...stream.pendingInputs.values()]
          .sort((left, right) => left.seq - right.seq)
          .map((input) => ({ ...input }))
      };
    }) as [DuelInputStreamCheckpoint, DuelInputStreamCheckpoint];
    const stateHash = computeDuelStateHash(this.config, state, inputStreams);
    return {
      formatVersion: 1,
      config: cloneDuelConfig(this.config),
      state,
      inputStreams,
      stateHash,
      checkpointHash: computeDuelCheckpointHash(stateHash, inputStreams)
    };
  }

  getStateHash(): string {
    return computeDuelStateHash(this.config, this.state, this.inputStreamCheckpoints(false));
  }

  getOutcome(stateHash = this.getStateHash()): DuelOutcome | null {
    if (this.state.status === "active"
      || this.state.outcomeReason === null
      || this.state.winnerUserId === null
      || this.state.loserUserId === null) {
      return null;
    }
    const reason = this.state.outcomeReason;
    return {
      matchId: this.config.matchId,
      sessionId: this.config.sessionId,
      winnerUserId: this.state.winnerUserId,
      loserUserId: this.state.loserUserId,
      reason,
      finalTick: this.state.tick,
      finalStateHash: stateHash,
      results: this.config.participants.map((participant) => ({
        userId: participant.userId,
        outcome: participant.userId === this.state.winnerUserId
          ? "victory" as const
          : reason === "disconnect_forfeit" ? "forfeit" as const : "defeat" as const,
        reason
      })) as [DuelParticipantOutcome, DuelParticipantOutcome]
    };
  }

  private inputStreamCheckpoints(includePending: boolean): [DuelInputStreamCheckpoint, DuelInputStreamCheckpoint] {
    return this.config.participants.map((participant) => {
      const stream = this.requireInputStream(participant.userId);
      return {
        userId: participant.userId,
        lastProcessedInputSequence: stream.lastProcessedInputSequence,
        activeInput: { ...stream.activeInput },
        pendingInputs: includePending
          ? [...stream.pendingInputs.values()].sort((left, right) => left.seq - right.seq).map((input) => ({ ...input }))
          : []
      };
    }) as [DuelInputStreamCheckpoint, DuelInputStreamCheckpoint];
  }

  private requireParticipant(userId: string): DuelParticipantConfig {
    const participant = this.config.participants.find((candidate) => candidate.userId === userId);
    if (!participant) throw new Error(`Unknown duel participant: ${userId}`);
    return participant;
  }

  private requireInputStream(userId: string): DuelInputStream {
    const stream = this.inputStreams.get(userId);
    if (!stream) throw new Error(`Unknown duel participant: ${userId}`);
    return stream;
  }

  private applyDueInputs(): void {
    for (const participant of this.config.participants) {
      const stream = this.requireInputStream(participant.userId);
      while (true) {
        const nextSequence = stream.lastProcessedInputSequence + 1;
        const input = stream.pendingInputs.get(nextSequence);
        if (!input || input.targetTick > this.state.tick) break;
        stream.pendingInputs.delete(nextSequence);
        stream.activeInput = {
          moveX: input.moveX,
          moveY: input.moveY,
          aimX: input.aimX,
          aimY: input.aimY,
          actionFlags: input.actionFlags
        };
        stream.lastProcessedInputSequence = input.seq;
      }
    }
  }

  private updateShips(events: DuelSimulationEvent[]): void {
    for (const ship of this.state.ships) {
      if (ship.hull <= 0) continue;
      const participant = this.requireParticipant(ship.userId);
      const input = this.requireInputStream(ship.userId).activeInput;
      const velocity = duelVelocityFromInput(
        input.moveX,
        input.moveY,
        participant.buildStats.speedUnitsPerSecond
      );
      ship.velocityXMilliPerTick = velocity.x;
      ship.velocityYMilliPerTick = velocity.y;
      moveDuelBodyWithinArena(ship, this.config);
      ship.weaponCooldownRemaining = Math.max(0, ship.weaponCooldownRemaining - 1);

      if ((input.actionFlags & 1) === 0 || ship.weaponCooldownRemaining > 0) continue;
      const fallbackAimX = ship.side === "alpha" ? DUEL_INPUT_AXIS_SCALE : -DUEL_INPUT_AXIS_SCALE;
      const aim = normalizedDuelAxis(input.aimX, input.aimY, fallbackAimX, 0);
      const projectileVelocity = duelVelocityFromInput(
        aim.x,
        aim.y,
        participant.buildStats.projectileSpeedUnitsPerSecond
      );
      const projectileId = `duel-projectile-${this.state.nextProjectileId}`;
      this.state.nextProjectileId += 1;
      this.state.projectiles.push({
        id: projectileId,
        ownerUserId: ship.userId,
        ownerSide: ship.side,
        xMilli: ship.xMilli,
        yMilli: ship.yMilli,
        velocityXMilliPerTick: projectileVelocity.x,
        velocityYMilliPerTick: projectileVelocity.y,
        damage: participant.buildStats.weaponDamage,
        ttlTicks: Math.max(
          1,
          Math.ceil(
            (participant.buildStats.weaponRangeUnits / participant.buildStats.projectileSpeedUnitsPerSecond)
            * DUEL_TICK_RATE
          )
        )
      });
      ship.weaponCooldownRemaining = participant.buildStats.weaponCooldownTicks;
      events.push(this.createEvent("weapon_fired", [ship.id, projectileId], [ship.userId]));
    }
  }

  private updateProjectiles(events: DuelSimulationEvent[]): void {
    const survivingProjectiles: DuelProjectileState[] = [];
    for (const projectile of this.state.projectiles) {
      const previousX = projectile.xMilli;
      const previousY = projectile.yMilli;
      projectile.xMilli += projectile.velocityXMilliPerTick;
      projectile.yMilli += projectile.velocityYMilliPerTick;
      projectile.ttlTicks -= 1;

      const target = this.state.ships.find((ship) => ship.userId !== projectile.ownerUserId);
      const targetConfig = target ? this.requireParticipant(target.userId) : null;
      const hit = target !== undefined
        && targetConfig !== null
        && target.hull > 0
        && segmentIntersectsDuelCircle(
          previousX,
          previousY,
          projectile.xMilli,
          projectile.yMilli,
          target.xMilli,
          target.yMilli,
          targetConfig.buildStats.collisionRadiusUnits * 1_000
        );
      if (hit && target) {
        target.hull = Math.max(0, target.hull - projectile.damage);
        events.push(this.createEvent(
          "entity_damaged",
          [target.id, projectile.id],
          [projectile.ownerUserId, target.userId]
        ));
        if (target.hull === 0) {
          target.velocityXMilliPerTick = 0;
          target.velocityYMilliPerTick = 0;
          events.push(this.createEvent("entity_destroyed", [target.id], [target.userId]));
        }
        continue;
      }
      if (projectile.ttlTicks > 0 && isDuelBodyInsideArena(projectile, this.config)) {
        survivingProjectiles.push(projectile);
      }
    }
    this.state.projectiles = survivingProjectiles;
  }

  private updateOutcome(events: DuelSimulationEvent[]): void {
    const [alpha, beta] = this.state.ships;
    if (alpha.hull <= 0 || beta.hull <= 0) {
      const winner = chooseDuelWinner(alpha, beta, this.config.seed);
      const loser = winner.userId === alpha.userId ? beta : alpha;
      this.endDuel(winner.userId, loser.userId, "ship_destroyed");
    } else if (this.state.tick >= this.config.durationSeconds * DUEL_TICK_RATE) {
      const winner = chooseDuelWinner(alpha, beta, this.config.seed);
      const loser = winner.userId === alpha.userId ? beta : alpha;
      this.endDuel(winner.userId, loser.userId, "time_expired");
    }
    if (this.state.status === "ended") {
      events.push(this.createEvent(
        "battle_ended",
        this.state.ships.map((ship) => ship.id),
        this.state.ships.map((ship) => ship.userId)
      ));
    }
  }

  private endDuel(winnerUserId: string, loserUserId: string, reason: DuelOutcomeReason): void {
    this.state.status = "ended";
    this.state.winnerUserId = winnerUserId;
    this.state.loserUserId = loserUserId;
    this.state.outcomeReason = reason;
  }

  private createEvent(
    type: DuelSimulationEvent["type"],
    entityIds: string[],
    userIds: string[]
  ): DuelSimulationEvent {
    const event = { id: this.state.nextEventId, tick: this.state.tick, type, entityIds, userIds };
    this.state.nextEventId += 1;
    return event;
  }
}

function createInitialDuelState(config: DuelSimulationConfig): DuelSimulationState {
  const widthMilli = config.arenaWidthUnits * 1_000;
  const heightMilli = config.arenaHeightUnits * 1_000;
  const ships = config.participants.map((participant) => ({
    id: `duel-ship-${participant.participantId}`,
    participantId: participant.participantId,
    userId: participant.userId,
    side: participant.side,
    xMilli: participant.side === "alpha" ? Math.trunc(widthMilli / 4) : Math.trunc((widthMilli * 3) / 4),
    yMilli: Math.trunc(heightMilli / 2),
    velocityXMilliPerTick: 0,
    velocityYMilliPerTick: 0,
    hull: participant.buildStats.hull,
    hullMax: participant.buildStats.hull,
    weaponCooldownRemaining: 0
  })) as [DuelShipState, DuelShipState];
  return {
    tick: 0,
    status: "active",
    outcomeReason: null,
    winnerUserId: null,
    loserUserId: null,
    nextProjectileId: 1,
    nextEventId: 1,
    ships,
    projectiles: []
  };
}

function validateDuelConfig(config: DuelSimulationConfig): void {
  if (config.simulationVersion !== DUEL_SIMULATION_VERSION) throw new Error("Unsupported simulation version.");
  for (const value of [config.matchId, config.sessionId, config.contentVersion]) {
    validateDuelIdentifier(value, "Duel identifiers");
  }
  if (!Array.isArray(config.participants) || config.participants.length !== 2) {
    throw new Error("Duel simulation requires exactly two participants.");
  }
  const userIds = new Set<string>();
  const participantIds = new Set<string>();
  const sides = new Set<DuelSide>();
  for (const participant of config.participants) {
    validateDuelIdentifier(participant.participantId, "participantId");
    validateDuelIdentifier(participant.userId, "userId");
    validateDuelIdentifier(participant.shipBuildRevisionId, "shipBuildRevisionId");
    if (participant.side !== "alpha" && participant.side !== "beta") throw new Error("Invalid duel side.");
    if (userIds.has(participant.userId)) throw new Error("Duel participant userIds must be unique.");
    if (participantIds.has(participant.participantId)) throw new Error("Duel participantIds must be unique.");
    if (sides.has(participant.side)) throw new Error("Duel sides must be unique.");
    userIds.add(participant.userId);
    participantIds.add(participant.participantId);
    sides.add(participant.side);
    validateDuelStats(participant.buildStats, participant.userId);
  }
  if (!sides.has("alpha") || !sides.has("beta")) throw new Error("Duel requires alpha and beta sides.");
  for (const value of [config.durationSeconds, config.arenaWidthUnits, config.arenaHeightUnits]) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 1_000_000) {
      throw new Error("Duel dimensions and duration must be bounded positive integers.");
    }
  }
  if (!Number.isSafeInteger(config.seed) || config.seed < 0 || config.seed > UINT32_MAX) {
    throw new Error("Duel seed must be an unsigned 32-bit integer.");
  }
  const largestRadius = Math.max(...config.participants.map((participant) => participant.buildStats.collisionRadiusUnits));
  if (config.arenaWidthUnits < largestRadius * 2 + 1 || config.arenaHeightUnits < largestRadius * 2 + 1) {
    throw new Error("Duel arena is too small for the configured ships.");
  }
}

function validateDuelIdentifier(value: string, label: string): void {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw new Error(`${label} must be a non-empty bounded string.`);
  }
}

function validateDuelStats(stats: DuelShipBuildStats, label: string): void {
  for (const [key, value] of Object.entries(stats)) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 1_000_000) {
      throw new Error(`${label}.buildStats.${key} must be a bounded positive integer.`);
    }
  }
}

function validateDuelCheckpointShape(checkpoint: DuelSimulationCheckpoint): void {
  if (!Array.isArray(checkpoint.inputStreams) || checkpoint.inputStreams.length !== 2) {
    throw new Error("Duel checkpoint requires two input streams.");
  }
  const expectedUsers = checkpoint.config.participants.map((participant) => participant.userId);
  const checkpointUsers = checkpoint.inputStreams.map((stream) => stream.userId);
  if (expectedUsers.some((userId, index) => checkpointUsers[index] !== userId)) {
    throw new Error("Duel checkpoint input stream identities mismatch.");
  }
  if (!Array.isArray(checkpoint.state.ships) || checkpoint.state.ships.length !== 2) {
    throw new Error("Duel checkpoint requires two ship states.");
  }
  for (let index = 0; index < checkpoint.config.participants.length; index += 1) {
    const participant = checkpoint.config.participants[index];
    const ship = checkpoint.state.ships[index];
    const stream = checkpoint.inputStreams[index];
    if (!participant || !ship || !stream
      || ship.userId !== participant.userId
      || ship.participantId !== participant.participantId
      || ship.side !== participant.side) {
      throw new Error("Duel checkpoint ship identities mismatch.");
    }
    if (!Number.isSafeInteger(stream.lastProcessedInputSequence) || stream.lastProcessedInputSequence < 0) {
      throw new Error("Invalid duel checkpoint input sequence.");
    }
    const seen = new Set<number>();
    for (const input of stream.pendingInputs) {
      if (!isValidDuelInput(input)
        || input.seq <= stream.lastProcessedInputSequence
        || seen.has(input.seq)) {
        throw new Error("Invalid duel checkpoint pending input.");
      }
      seen.add(input.seq);
    }
    if (stream.pendingInputs.length > MAX_PENDING_INPUTS_PER_USER) {
      throw new Error("Duel checkpoint input buffer is too large.");
    }
  }
}

function cloneDuelConfig(config: DuelSimulationConfig): DuelSimulationConfig {
  const participants = config.participants
    .map((participant) => ({ ...participant, buildStats: { ...participant.buildStats } }))
    .sort((left, right) => left.side === right.side ? 0 : left.side === "alpha" ? -1 : 1) as [
      DuelParticipantConfig,
      DuelParticipantConfig
    ];
  return { ...config, participants };
}

function cloneDuelState(state: DuelSimulationState): DuelSimulationState {
  return {
    ...state,
    ships: state.ships.map((ship) => ({ ...ship })) as [DuelShipState, DuelShipState],
    projectiles: state.projectiles.map((projectile) => ({ ...projectile }))
  };
}

function neutralDuelInput(side: DuelSide): DuelActiveInput {
  return {
    moveX: 0,
    moveY: 0,
    aimX: side === "alpha" ? DUEL_INPUT_AXIS_SCALE : -DUEL_INPUT_AXIS_SCALE,
    aimY: 0,
    actionFlags: 0
  };
}

function isValidDuelInput(input: SimulationInputCommand): boolean {
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

function duelVelocityFromInput(x: number, y: number, speedUnitsPerSecond: number): { x: number; y: number } {
  const normalized = normalizedDuelAxis(x, y, 0, 0);
  const speedMilliPerTick = Math.trunc((speedUnitsPerSecond * 1_000) / DUEL_TICK_RATE);
  return {
    x: Math.trunc((normalized.x * speedMilliPerTick) / DUEL_INPUT_AXIS_SCALE),
    y: Math.trunc((normalized.y * speedMilliPerTick) / DUEL_INPUT_AXIS_SCALE)
  };
}

function normalizedDuelAxis(
  x: number,
  y: number,
  fallbackX: number,
  fallbackY: number
): { x: number; y: number } {
  if (x === 0 && y === 0) return { x: fallbackX, y: fallbackY };
  const length = Math.hypot(x, y);
  if (length <= DUEL_INPUT_AXIS_SCALE) return { x, y };
  return {
    x: Math.round((x / length) * DUEL_INPUT_AXIS_SCALE),
    y: Math.round((y / length) * DUEL_INPUT_AXIS_SCALE)
  };
}

function moveDuelBodyWithinArena(body: DuelKinematicBody, config: DuelSimulationConfig): void {
  body.xMilli = clampDuelInteger(body.xMilli + body.velocityXMilliPerTick, 0, config.arenaWidthUnits * 1_000);
  body.yMilli = clampDuelInteger(body.yMilli + body.velocityYMilliPerTick, 0, config.arenaHeightUnits * 1_000);
}

function isDuelBodyInsideArena(body: DuelKinematicBody, config: DuelSimulationConfig): boolean {
  return body.xMilli >= 0
    && body.yMilli >= 0
    && body.xMilli <= config.arenaWidthUnits * 1_000
    && body.yMilli <= config.arenaHeightUnits * 1_000;
}

function segmentIntersectsDuelCircle(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  centerX: number,
  centerY: number,
  radius: number
): boolean {
  const segmentX = endX - startX;
  const segmentY = endY - startY;
  const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (segmentLengthSquared === 0) {
    const dx = startX - centerX;
    const dy = startY - centerY;
    return dx * dx + dy * dy <= radius * radius;
  }
  const projection = clampDuelNumber(
    ((centerX - startX) * segmentX + (centerY - startY) * segmentY) / segmentLengthSquared,
    0,
    1
  );
  const closestX = startX + projection * segmentX;
  const closestY = startY + projection * segmentY;
  const dx = closestX - centerX;
  const dy = closestY - centerY;
  return dx * dx + dy * dy <= radius * radius;
}

function chooseDuelWinner(alpha: DuelShipState, beta: DuelShipState, seed: number): DuelShipState {
  const alphaScore = alpha.hull * beta.hullMax;
  const betaScore = beta.hull * alpha.hullMax;
  if (alphaScore === betaScore) return (seed & 1) === 0 ? alpha : beta;
  return alphaScore > betaScore ? alpha : beta;
}

function snapshotDuelShip(ship: DuelShipState): DuelSimulationEntitySnapshot {
  return {
    id: ship.id,
    kind: "ship",
    participantId: ship.participantId,
    ownerUserId: ship.userId,
    side: ship.side,
    xMilli: ship.xMilli,
    yMilli: ship.yMilli,
    velocityXMilliPerTick: ship.velocityXMilliPerTick,
    velocityYMilliPerTick: ship.velocityYMilliPerTick,
    rotationMilliRadians: duelRotationFromVelocity(ship.velocityXMilliPerTick, ship.velocityYMilliPerTick),
    hull: ship.hull,
    hullMax: ship.hullMax,
    flags: ship.hull <= 0 ? 1 : 0
  };
}

function snapshotDuelProjectile(projectile: DuelProjectileState): DuelSimulationEntitySnapshot {
  return {
    id: projectile.id,
    kind: "projectile",
    participantId: null,
    ownerUserId: projectile.ownerUserId,
    side: projectile.ownerSide,
    xMilli: projectile.xMilli,
    yMilli: projectile.yMilli,
    velocityXMilliPerTick: projectile.velocityXMilliPerTick,
    velocityYMilliPerTick: projectile.velocityYMilliPerTick,
    rotationMilliRadians: duelRotationFromVelocity(
      projectile.velocityXMilliPerTick,
      projectile.velocityYMilliPerTick
    ),
    hull: 1,
    hullMax: 1,
    flags: 0
  };
}

function duelRotationFromVelocity(x: number, y: number): number {
  return x === 0 && y === 0 ? 0 : Math.round(Math.atan2(y, x) * 1_000);
}

function computeDuelStateHash(
  config: DuelSimulationConfig,
  state: DuelSimulationState,
  inputStreams: [DuelInputStreamCheckpoint, DuelInputStreamCheckpoint]
): string {
  const tokens: Array<string | number> = [
    DUEL_SIMULATION_VERSION,
    config.contentVersion,
    config.matchId,
    config.sessionId,
    config.seed,
    config.durationSeconds,
    config.arenaWidthUnits,
    config.arenaHeightUnits
  ];
  for (const participant of config.participants) {
    tokens.push(
      participant.participantId,
      participant.userId,
      participant.side,
      participant.shipBuildRevisionId,
      participant.buildStats.hull,
      participant.buildStats.speedUnitsPerSecond,
      participant.buildStats.weaponDamage,
      participant.buildStats.weaponRangeUnits,
      participant.buildStats.weaponCooldownTicks,
      participant.buildStats.projectileSpeedUnitsPerSecond,
      participant.buildStats.collisionRadiusUnits
    );
  }
  tokens.push(
    state.tick,
    state.status,
    state.outcomeReason ?? "-",
    state.winnerUserId ?? "-",
    state.loserUserId ?? "-",
    state.nextProjectileId,
    state.nextEventId
  );
  for (const ship of state.ships) {
    tokens.push(
      ship.id,
      ship.participantId,
      ship.userId,
      ship.side,
      ...duelBodyTokens(ship),
      ship.hull,
      ship.hullMax,
      ship.weaponCooldownRemaining
    );
  }
  for (const projectile of state.projectiles) {
    tokens.push(
      projectile.id,
      projectile.ownerUserId,
      projectile.ownerSide,
      ...duelBodyTokens(projectile),
      projectile.damage,
      projectile.ttlTicks
    );
  }
  for (const stream of inputStreams) {
    tokens.push(
      stream.userId,
      stream.lastProcessedInputSequence,
      stream.activeInput.moveX,
      stream.activeInput.moveY,
      stream.activeInput.aimX,
      stream.activeInput.aimY,
      stream.activeInput.actionFlags
    );
  }
  return duelFnv1a64(tokens.join("|"));
}

function computeDuelCheckpointHash(
  stateHash: string,
  inputStreams: [DuelInputStreamCheckpoint, DuelInputStreamCheckpoint]
): string {
  const tokens: Array<string | number> = [stateHash];
  for (const stream of inputStreams) {
    tokens.push(stream.userId);
    for (const input of stream.pendingInputs) {
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
  }
  return duelFnv1a64(tokens.join("|"));
}

function duelBodyTokens(body: DuelKinematicBody): Array<string | number> {
  return [body.xMilli, body.yMilli, body.velocityXMilliPerTick, body.velocityYMilliPerTick];
}

function duelFnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function clampDuelInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function clampDuelNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function duelFail(message: string): never {
  throw new Error(message);
}
