import { BATTLE_PROTOCOL_VERSION, type BattleServerMessage, type BattleSnapshot, type ReconnectMetadata } from "@spacey/protocol";
import {
  CHECKPOINT_INTERVAL_TICKS,
  DuelSimulation,
  type DuelOutcome,
  type DuelSimulationSnapshot,
} from "@spacey/simulation";
import { AsyncMutex } from "./async-mutex.js";
import {
  createConnectionPolicy,
  disconnectedAction,
  markDisconnected,
  reconnect,
  restoreConnectionPolicy,
  type ConnectionPolicyState,
} from "./disconnect-policy.js";
import type {
  BattleCheckpointStore,
  BattleConnection,
  BattleFinalizer,
  BattleTicketClaims,
  BattleWorkerClock,
  BattleWorkerLogger,
  CreatePvpBattleSessionRequest,
  FinalizeDuelResult,
  PvpBattleTicketClaims,
  StoredPvpBattleSessionCheckpoint,
} from "./ports.js";
import type { BattleSessionInfrastructure } from "./session-manager.js";

type DuelParticipantRuntime = CreatePvpBattleSessionRequest["participants"][number] & {
  connection: BattleConnection | null;
  policy: ConnectionPolicyState;
};

type ManagedDuelSession = {
  simulation: DuelSimulation;
  participants: [DuelParticipantRuntime, DuelParticipantRuntime];
  started: boolean;
  latestCheckpointTick: number;
  lastLeaseRefreshAtMs: number;
  leaseOwned: boolean;
  finalizationStarted: boolean;
  finalized: { result: FinalizeDuelResult; outcome: DuelOutcome } | null;
  mutex: AsyncMutex;
};

export class DuelSessionManager {
  private readonly sessions = new Map<string, ManagedDuelSession>();

  constructor(
    private readonly checkpoints: BattleCheckpointStore,
    private readonly finalizer: BattleFinalizer,
    private readonly clock: BattleWorkerClock,
    private readonly logger: BattleWorkerLogger,
    private readonly infrastructure: BattleSessionInfrastructure,
  ) {}

  get activeSessionCount(): number {
    return this.sessions.size;
  }

  async createSession(request: CreatePvpBattleSessionRequest): Promise<void> {
    this.validateDefinition(request);
    const sessionId = request.simulationConfig.sessionId;
    if (this.sessions.has(sessionId)) throw new Error(`Duel session ${sessionId} already exists.`);
    if (!await this.claimRoute(sessionId)) throw new Error(`Duel session ${sessionId} is owned by another worker.`);
    this.sessions.set(sessionId, this.newSession(request, new DuelSimulation(request.simulationConfig)));
  }

  async restoreSession(sessionId: string): Promise<boolean> {
    if (this.sessions.has(sessionId)) return true;
    const stored = await this.checkpoints.load(sessionId);
    let request: CreatePvpBattleSessionRequest;
    let simulation: DuelSimulation;
    let participants: [DuelParticipantRuntime, DuelParticipantRuntime];
    let checkpointTick = 0;

    if (stored) {
      if (stored.kind !== "pvp") return false;
      this.validateCheckpoint(stored);
      request = {
        kind: "pvp",
        participants: stored.participants.map(({ userId, attemptId, participantId, side }) => ({
          userId, attemptId, participantId, side,
        })) as CreatePvpBattleSessionRequest["participants"],
        simulationConfig: stored.simulation.config,
      };
      simulation = DuelSimulation.fromCheckpoint(stored.simulation);
      participants = stored.participants.map((participant) => {
        const restored = restoreConnectionPolicy("pvp", participant.disconnectedAtMs, participant.disconnectDeadlineAtMs);
        return {
          userId: participant.userId,
          attemptId: participant.attemptId,
          participantId: participant.participantId,
          side: participant.side,
          connection: null,
          policy: restored.connected ? markDisconnected(restored, this.clock.nowMs()) : restored,
        };
      }) as [DuelParticipantRuntime, DuelParticipantRuntime];
      checkpointTick = stored.simulation.state.tick;
    } else {
      const definition = await this.infrastructure.definitions.load(sessionId);
      if (!definition || definition.kind !== "pvp" || definition.simulationConfig.sessionId !== sessionId) return false;
      this.validateDefinition(definition);
      request = definition;
      simulation = new DuelSimulation(definition.simulationConfig);
      participants = this.participantRuntimes(definition);
    }

    if (!await this.claimRoute(sessionId)) return false;
    for (const participant of request.participants) {
      const inputs = await this.infrastructure.inputJournal.readAfter(
        sessionId,
        participant.userId,
        simulation.lastProcessedInputSequence(participant.userId),
      );
      for (const input of inputs) simulation.enqueueInput(participant.userId, input);
    }
    this.sessions.set(sessionId, {
      simulation,
      participants,
      started: stored?.kind === "pvp" ? stored.started : false,
      latestCheckpointTick: checkpointTick,
      lastLeaseRefreshAtMs: this.clock.nowMs(),
      leaseOwned: true,
      finalizationStarted: false,
      finalized: null,
      mutex: new AsyncMutex(),
    });
    return true;
  }

  async attachConnection(claims: BattleTicketClaims, connection: BattleConnection): Promise<boolean> {
    if (claims.mode !== "pvp") return false;
    let session = this.sessions.get(claims.sessionId);
    if (!session && await this.restoreSession(claims.sessionId)) session = this.sessions.get(claims.sessionId);
    if (!session || !session.leaseOwned) {
      connection.close(4404, "duel session not found");
      return false;
    }
    const participant = this.claimedParticipant(session, claims);
    if (!participant) {
      connection.close(4401, "invalid duel participant claims");
      return false;
    }

    return session.mutex.runExclusive(async () => {
      const connectionResult = reconnect(participant.policy, this.clock.nowMs());
      participant.policy = connectionResult.state;
      if (!connectionResult.accepted) {
        connection.close(4409, "reconnect deadline elapsed");
        return false;
      }
      if (participant.connection && participant.connection.id !== connection.id) {
        participant.connection.close(4409, "participant resumed on another connection");
      }
      participant.connection = connection;
      connection.onMessage((message) => this.handleMessage(claims.sessionId, claims.userId, connection.id, message));
      connection.onClose(() => this.handleClose(claims.sessionId, claims.userId, connection.id));
      await this.infrastructure.lifecycle.markConnected({
        attemptId: participant.attemptId,
        userId: participant.userId,
        connectedAtMs: this.clock.nowMs(),
      });
      if (session.started) {
        await connection.send(this.initialMessage(session, participant));
      } else if (session.participants.every((candidate) => candidate.policy.connected)) {
        await this.startSession(session);
      }
      return true;
    });
  }

  async advanceOneTick(nowMs = this.clock.nowMs()): Promise<void> {
    await Promise.all([...this.sessions.entries()].map(async ([sessionId, session]) => {
      try {
        await session.mutex.runExclusive(() => this.advanceSession(sessionId, session, nowMs));
      } catch (error) {
        this.logger.error("Duel session tick failed", {
          sessionId,
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      }
    }));
  }

  async flushCheckpoints(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((session) =>
      session.mutex.runExclusive(() => this.persistCheckpoint(session)),
    ));
  }

  private async advanceSession(sessionId: string, session: ManagedDuelSession, nowMs: number) {
    if (session.finalized || !session.leaseOwned) return;
    if (nowMs - session.lastLeaseRefreshAtMs >= (this.infrastructure.routeTtlSeconds * 1_000) / 3) {
      await this.refreshRoute(session);
    }
    for (const participant of session.participants) {
      const action = disconnectedAction(participant.policy, nowMs);
      participant.policy = action.state;
      if (action.action === "forfeit") {
        await this.finalize(sessionId, session, session.simulation.forceForfeit(participant.userId));
        return;
      }
      if (action.action === "neutral_input") session.simulation.setNeutralInput(participant.userId);
    }
    if (!session.started) {
      if (!session.participants.every((participant) => participant.policy.connected)) return;
      await this.startSession(session);
    }

    const tick = session.simulation.advanceOneTick();
    for (const event of tick.events) {
      await this.broadcast(session, {
        type: "battle.event",
        eventId: event.id,
        tick: event.tick,
        eventType: event.type,
        entityIds: event.entityIds,
      });
    }
    if (tick.snapshot) {
      await Promise.all(session.participants.map((participant) => participant.connection?.send({
        type: "battle.snapshot",
        snapshot: this.snapshotFor(tick.snapshot!, participant.userId),
      })));
    }
    if (tick.tick % CHECKPOINT_INTERVAL_TICKS === 0) await this.persistCheckpoint(session);
    if (tick.outcome) await this.finalize(sessionId, session, tick.outcome);
  }

  private async handleMessage(
    sessionId: string,
    userId: string,
    connectionId: string,
    message: import("@spacey/protocol").BattleClientMessage,
  ) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    await session.mutex.runExclusive(async () => {
      const participant = session.participants.find((candidate) => candidate.userId === userId);
      if (!participant || participant.connection?.id !== connectionId || session.finalized || !session.leaseOwned) return;
      if (message.type === "ping") {
        await participant.connection.send({ type: "pong", nonce: message.nonce, serverTick: session.simulation.tick });
        return;
      }
      if (message.type === "session.resume") {
        if (session.started) await participant.connection.send(this.initialMessage(session, participant));
        return;
      }
      if (!session.started) {
        await participant.connection.send({
          type: "session.error",
          code: "MATCH_NOT_STARTED",
          message: "Waiting for both PvP participants to connect.",
          retryable: true,
        });
        return;
      }
      try {
        await this.infrastructure.inputJournal.append(sessionId, userId, message.command);
      } catch {
        await participant.connection.send({
          type: "session.error",
          code: "INPUT_JOURNAL_UNAVAILABLE",
          message: "Input command could not be persisted.",
          retryable: true,
        });
        return;
      }
      const accepted = session.simulation.enqueueInput(userId, message.command);
      if (!accepted.accepted && accepted.reason !== "duplicate" && accepted.reason !== "already_processed") {
        await participant.connection.send({
          type: "session.error",
          code: "INPUT_REJECTED",
          message: "Input command was rejected.",
          retryable: accepted.reason === "buffer_full",
        });
      }
    });
  }

  private async handleClose(sessionId: string, userId: string, connectionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    await session.mutex.runExclusive(async () => {
      const participant = session.participants.find((candidate) => candidate.userId === userId);
      if (!participant || participant.connection?.id !== connectionId || session.finalized) return;
      participant.connection = null;
      const disconnectedAtMs = this.clock.nowMs();
      participant.policy = markDisconnected(participant.policy, disconnectedAtMs);
      session.simulation.setNeutralInput(userId);
      await this.infrastructure.lifecycle.markDisconnected({
        attemptId: participant.attemptId,
        userId,
        mode: "pvp",
        disconnectedAtMs,
        reconnectDeadlineAtMs: participant.policy.deadlineAtMs ?? disconnectedAtMs,
      });
      await this.persistCheckpoint(session);
    });
  }

  private async persistCheckpoint(session: ManagedDuelSession) {
    if (!session.leaseOwned) return;
    const checkpoint = session.simulation.createCheckpoint();
    await this.checkpoints.save({
      kind: "pvp",
      sessionId: session.simulation.config.sessionId,
      matchId: session.simulation.config.matchId,
      started: session.started,
      simulation: checkpoint,
      participants: session.participants.map((participant) => ({
        userId: participant.userId,
        attemptId: participant.attemptId,
        participantId: participant.participantId,
        side: participant.side,
        disconnectedAtMs: participant.policy.disconnectedAtMs,
        disconnectDeadlineAtMs: participant.policy.deadlineAtMs,
      })) as StoredPvpBattleSessionCheckpoint["participants"],
      savedAtMs: this.clock.nowMs(),
    });
    session.latestCheckpointTick = checkpoint.state.tick;
    await this.refreshRoute(session);
  }

  private async refreshRoute(session: ManagedDuelSession) {
    const refreshed = await this.infrastructure.router.refresh(
      session.simulation.config.sessionId,
      this.infrastructure.routeLease,
      this.infrastructure.routeTtlSeconds,
    );
    session.lastLeaseRefreshAtMs = this.clock.nowMs();
    if (refreshed) return;
    session.leaseOwned = false;
    for (const participant of session.participants) {
      participant.connection?.close(1012, "duel session lease lost");
      participant.connection = null;
    }
    throw new Error("Duel session route lease was lost.");
  }

  private async finalize(sessionId: string, session: ManagedDuelSession, outcome: DuelOutcome) {
    if (session.finalizationStarted || session.finalized) return;
    session.finalizationStarted = true;
    try {
      await this.persistCheckpoint(session);
      const finalCheckpoint = session.simulation.createCheckpoint();
      const inputs = await this.infrastructure.inputJournal.readAll(sessionId);
      const replay = await this.infrastructure.replayStorage.store({
        kind: "pvp",
        simulationConfig: session.simulation.config,
        finalCheckpoint,
        inputs,
        outcome,
        completedAtMs: this.clock.nowMs(),
      });
      const result = await this.finalizer.finalizeDuelOnce({
        idempotencyKey: `pvp-match:${session.simulation.config.matchId}`,
        sessionId,
        matchId: session.simulation.config.matchId,
        participants: session.participants.map(({ userId, attemptId, participantId, side }) => ({
          userId, attemptId, participantId, side,
        })) as CreatePvpBattleSessionRequest["participants"],
        simulationConfig: session.simulation.config,
        finalCheckpoint,
        replay,
        outcome,
      });
      session.finalized = { result, outcome };
      for (const participant of session.participants) {
        const participantOutcome = outcome.results.find((candidate) => candidate.userId === participant.userId);
        const resultId = result.resultIds[participant.userId];
        if (participant.connection && participantOutcome && resultId) {
          await participant.connection.send({
            type: "battle.ended",
            resultId,
            outcome: participantOutcome.outcome,
            reason: participantOutcome.reason,
            finalTick: outcome.finalTick,
            finalStateHash: outcome.finalStateHash,
          });
          participant.connection.close(1000, "duel completed");
        }
      }
      await Promise.all([
        this.checkpoints.delete(sessionId),
        this.infrastructure.inputJournal.delete(sessionId),
        this.infrastructure.definitions.delete(sessionId),
        this.infrastructure.router.release(sessionId, this.infrastructure.routeLease),
      ]);
      this.sessions.delete(sessionId);
      this.logger.info("PvP duel finalized", { sessionId, matchId: session.simulation.config.matchId });
    } catch (error) {
      session.finalizationStarted = false;
      this.logger.error("PvP duel finalization failed", {
        sessionId,
        matchId: session.simulation.config.matchId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  private initialMessage(session: ManagedDuelSession, participant: DuelParticipantRuntime): BattleServerMessage {
    const snapshot = session.simulation.createSnapshot();
    return {
      type: "battle.initial",
      protocolVersion: BATTLE_PROTOCOL_VERSION,
      mode: "pvp",
      participant: {
        matchId: session.simulation.config.matchId,
        participantId: participant.participantId,
        side: participant.side,
      },
      snapshot: this.snapshotFor(snapshot, participant.userId),
      reconnect: this.reconnectMetadata(session, participant),
    };
  }

  private snapshotFor(snapshot: DuelSimulationSnapshot, userId: string): BattleSnapshot {
    const outcome = snapshot.outcome?.results.find((candidate) => candidate.userId === userId);
    const opponent = snapshot.entities.find((entity) => entity.kind === "ship" && entity.ownerUserId !== userId);
    return {
      sessionId: snapshot.sessionId,
      tick: snapshot.tick,
      stateHash: snapshot.stateHash,
      lastProcessedInputSequence: snapshot.lastProcessedInputSequences[userId] ?? 0,
      status: snapshot.status === "active" ? "active" : outcome?.outcome === "victory" ? "victory" : "defeat",
      objective: { type: "destroy_opponent", progress: opponent?.hull === 0 ? 1 : 0, target: 1 },
      entities: snapshot.entities.map((entity) => ({
        id: entity.id,
        kind: entity.kind === "ship"
          ? entity.ownerUserId === userId ? "player" : "enemy"
          : "projectile",
        xMilli: entity.xMilli,
        yMilli: entity.yMilli,
        velocityXMilliPerTick: entity.velocityXMilliPerTick,
        velocityYMilliPerTick: entity.velocityYMilliPerTick,
        rotationMilliRadians: entity.rotationMilliRadians,
        hull: entity.hull,
        hullMax: entity.hullMax,
        flags: entity.flags,
      })),
    };
  }

  private reconnectMetadata(session: ManagedDuelSession, participant: DuelParticipantRuntime): ReconnectMetadata {
    return {
      permitted: !participant.policy.forfeited && !session.finalized,
      disconnectedAt: participant.policy.disconnectedAtMs === null ? null : new Date(participant.policy.disconnectedAtMs).toISOString(),
      deadlineAt: participant.policy.deadlineAtMs === null ? null : new Date(participant.policy.deadlineAtMs).toISOString(),
      lastProcessedInputSequence: session.simulation.lastProcessedInputSequence(participant.userId),
      latestCheckpointTick: session.latestCheckpointTick,
    };
  }

  private async broadcast(session: ManagedDuelSession, message: BattleServerMessage) {
    await Promise.all(session.participants.map((participant) => participant.connection?.send(message)));
  }

  private async startSession(session: ManagedDuelSession) {
    if (session.started) return;
    session.started = true;
    await Promise.all(session.participants.map((participant) =>
      participant.connection?.send(this.initialMessage(session, participant)),
    ));
  }

  private claimedParticipant(session: ManagedDuelSession, claims: PvpBattleTicketClaims) {
    if (claims.matchId !== session.simulation.config.matchId) return null;
    return session.participants.find((participant) => participant.userId === claims.userId
      && participant.attemptId === claims.attemptId
      && participant.participantId === claims.participantId
      && participant.side === claims.side) ?? null;
  }

  private participantRuntimes(request: CreatePvpBattleSessionRequest): [DuelParticipantRuntime, DuelParticipantRuntime] {
    return request.participants.map((participant) => ({
      ...participant,
      connection: null,
      policy: markDisconnected(createConnectionPolicy("pvp"), this.clock.nowMs()),
    })) as [DuelParticipantRuntime, DuelParticipantRuntime];
  }

  private newSession(request: CreatePvpBattleSessionRequest, simulation: DuelSimulation): ManagedDuelSession {
    return {
      simulation,
      participants: this.participantRuntimes(request),
      started: false,
      latestCheckpointTick: 0,
      lastLeaseRefreshAtMs: this.clock.nowMs(),
      leaseOwned: true,
      finalizationStarted: false,
      finalized: null,
      mutex: new AsyncMutex(),
    };
  }

  private validateDefinition(request: CreatePvpBattleSessionRequest) {
    if (request.simulationConfig.participants.length !== 2 || request.participants.length !== 2) {
      throw new Error("PvP duel requires exactly two participants.");
    }
    for (const participant of request.participants) {
      const configured = request.simulationConfig.participants.find((candidate) => candidate.userId === participant.userId);
      const expectedSide = participant.side === 0 ? "alpha" : "beta";
      if (!configured
        || configured.participantId !== participant.participantId
        || configured.side !== expectedSide) throw new Error("PvP participant definition mismatch.");
    }
  }

  private validateCheckpoint(stored: StoredPvpBattleSessionCheckpoint) {
    if (stored.sessionId !== stored.simulation.config.sessionId
      || stored.matchId !== stored.simulation.config.matchId) throw new Error("Duel checkpoint identity mismatch.");
  }

  private claimRoute(sessionId: string) {
    return this.infrastructure.router.claim(sessionId, this.infrastructure.routeLease, this.infrastructure.routeTtlSeconds);
  }
}
