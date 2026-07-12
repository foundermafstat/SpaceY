import {
  BATTLE_PROTOCOL_VERSION,
  type BattleClientMessage,
  type BattleServerMessage,
  type BattleSnapshot,
  type ReconnectMetadata
} from "@spacey/protocol";
import {
  CHECKPOINT_INTERVAL_TICKS,
  MissionSimulation,
  type MissionOutcome,
  type SimulationSnapshot
} from "@spacey/simulation";
import { battleWorkerMetrics, captureException } from "@spacey/observability";

import { AsyncMutex } from "./async-mutex.js";
import { BoundedOrderedQueue } from "./bounded-ordered-queue.js";
import { isCheckpointTick } from "./checkpoint-schedule.js";
import { finalizationRetryDelayMs } from "./finalization-retry.js";
import { InputRateLimiter } from "./input-rate-limiter.js";
import {
  createConnectionPolicy,
  disconnectedAction,
  markDisconnected,
  reconnect,
  restoreConnectionPolicy,
  type ConnectionPolicyState
} from "./disconnect-policy.js";
import type {
  BattleCheckpointStore,
  BattleConnection,
  BattleAttemptLifecycle,
  BattleFinalizer,
  BattleInputJournal,
  BattleReplayStorage,
  BattleRouteLease,
  BattleSessionDefinitionStore,
  BattleSessionRouter,
  BattleTicketClaims,
  BattleWorkerClock,
  BattleWorkerLogger,
  CreatePveBattleSessionRequest,
  FinalizeBattleResult,
  StoredPveBattleSessionCheckpoint
} from "./ports.js";

type ManagedBattleSession = {
  userId: string;
  simulation: MissionSimulation;
  connection: BattleConnection | null;
  hasConnectedBefore: boolean;
  connectionPolicy: ConnectionPolicyState;
  latestCheckpointTick: number;
  lastLeaseRefreshAtMs: number;
  leaseOwned: boolean;
  finalizationStarted: boolean;
  finalizationOutcome: MissionOutcome | null;
  finalizationAttempts: number;
  nextFinalizationAttemptAtMs: number;
  finalized: { result: FinalizeBattleResult; outcome: MissionOutcome } | null;
  replayAttached: boolean;
  completedAtMs: number | null;
  checkpointPending: boolean;
  checkpointInFlight: Promise<void> | null;
  routeRefreshInFlight: Promise<void> | null;
  inputRateLimiter: InputRateLimiter;
  inputQueue: BoundedOrderedQueue;
  lifecycleQueue: BoundedOrderedQueue;
  mutex: AsyncMutex;
};

const INPUT_QUEUE_CAPACITY = 256;
const LIFECYCLE_QUEUE_CAPACITY = 64;

export type BattleSessionInfrastructure = {
  lifecycle: BattleAttemptLifecycle;
  definitions: BattleSessionDefinitionStore;
  inputJournal: BattleInputJournal;
  router: BattleSessionRouter;
  replayStorage: BattleReplayStorage;
  routeLease: BattleRouteLease;
  routeTtlSeconds: number;
};

export class BattleSessionManager {
  private readonly sessions = new Map<string, ManagedBattleSession>();

  constructor(
    private readonly checkpoints: BattleCheckpointStore,
    private readonly finalizer: BattleFinalizer,
    private readonly clock: BattleWorkerClock,
    private readonly logger: BattleWorkerLogger,
    private readonly infrastructure: BattleSessionInfrastructure
  ) {}

  get activeSessionCount(): number {
    return this.sessions.size;
  }

  async createSession(request: CreatePveBattleSessionRequest): Promise<void> {
    const sessionId = request.simulationConfig.sessionId;
    if (this.sessions.has(sessionId)) throw new Error(`Battle session ${sessionId} already exists.`);
    if (!await this.claimRoute(sessionId)) throw new Error(`Battle session ${sessionId} is owned by another worker.`);
    this.sessions.set(sessionId, this.newSession(
      request.userId,
      new MissionSimulation(request.simulationConfig),
      markDisconnected(createConnectionPolicy(request.simulationConfig.mode), this.clock.nowMs()),
      0
    ));
    battleWorkerMetrics.sessionActivated(sessionId, "pve");
  }

  async restoreSession(sessionId: string): Promise<boolean> {
    if (this.sessions.has(sessionId)) return true;
    const stored = await this.checkpoints.load(sessionId);
    let request: CreatePveBattleSessionRequest;
    let simulation: MissionSimulation;
    let connectionPolicy: ConnectionPolicyState;
    let checkpointTick = 0;

    if (stored) {
      if (stored.kind !== "pve") return false;
      this.assertCheckpointIdentity(stored);
      request = { kind: "pve", userId: stored.userId, simulationConfig: stored.simulation.config };
      simulation = MissionSimulation.fromCheckpoint(stored.simulation);
      const restored = restoreConnectionPolicy(
        stored.mode,
        stored.disconnectedAtMs,
        stored.disconnectDeadlineAtMs
      );
      connectionPolicy = restored.connected
        ? markDisconnected(restored, this.clock.nowMs())
        : restored;
      checkpointTick = stored.simulation.state.tick;
    } else {
      const definition = await this.infrastructure.definitions.load(sessionId);
      if (!definition || definition.kind !== "pve" || definition.simulationConfig.sessionId !== sessionId) return false;
      request = definition;
      simulation = new MissionSimulation(definition.simulationConfig);
      connectionPolicy = markDisconnected(
        createConnectionPolicy(definition.simulationConfig.mode),
        this.clock.nowMs()
      );
    }

    if (!await this.claimRoute(sessionId)) return false;
    const journaledInputs = await this.infrastructure.inputJournal.readAfter(
      sessionId,
      request.userId,
      simulation.lastProcessedInputSequence
    );
    for (const input of journaledInputs) simulation.enqueueInput(input);
    this.sessions.set(
      sessionId,
      this.newSession(
        request.userId,
        simulation,
        connectionPolicy,
        checkpointTick,
        stored?.kind === "pve" ? stored.completedAtMs ?? null : null,
        stored?.kind === "pve" ? stored.hasConnectedBefore ?? false : false,
      )
    );
    battleWorkerMetrics.sessionActivated(sessionId, "pve");
    if (stored?.kind === "pve") battleWorkerMetrics.checkpointSaved(sessionId, "pve", stored.savedAtMs);
    return true;
  }

  async attachConnection(claims: BattleTicketClaims, connection: BattleConnection): Promise<boolean> {
    let session = this.sessions.get(claims.sessionId);
    if (!session && await this.restoreSession(claims.sessionId)) {
      session = this.sessions.get(claims.sessionId);
    }
    if (!session || !this.claimsMatchSession(claims, session) || !session.leaseOwned) {
      connection.close(4404, "battle session not found");
      return false;
    }

    let initialMessage: BattleServerMessage | null = null;
    const accepted = await session.mutex.runExclusive(async () => {
      if (session.finalizationOutcome) {
        connection.close(4409, "battle result is finalizing");
        return false;
      }
      if (!session.lifecycleQueue.hasCapacity) {
        connection.close(1013, "battle lifecycle queue is full");
        return false;
      }
      const isReconnect = session.hasConnectedBefore;
      const connectionResult = reconnect(session.connectionPolicy, this.clock.nowMs());
      session.connectionPolicy = connectionResult.state;
      if (!connectionResult.accepted) {
        connection.close(4409, "reconnect deadline elapsed");
        return false;
      }

      if (session.connection && session.connection.id !== connection.id) {
        session.connection.close(4409, "session resumed on another connection");
      }
      session.connection = connection;
      connection.onMessage((message) => this.handleMessage(claims.sessionId, connection.id, message));
      connection.onClose(() => this.handleClose(claims.sessionId, connection.id));

      const connectedAtMs = this.clock.nowMs();
      const lifecycleQueued = session.lifecycleQueue.enqueue(async () => {
        try {
          await this.infrastructure.lifecycle.markConnected({
            attemptId: session.simulation.config.attemptId,
            userId: session.userId,
            connectedAtMs,
          });
        } catch (error) {
          if (session.connection?.id === connection.id) connection.close(1011, "battle lifecycle persistence failed");
          throw error;
        }
      });
      if (!lifecycleQueued) {
        connection.close(1013, "battle lifecycle queue is full");
        session.connection = null;
        return false;
      }
      session.hasConnectedBefore = true;
      if (isReconnect) battleWorkerMetrics.reconnected("pve");

      initialMessage = {
        type: "battle.initial",
        protocolVersion: BATTLE_PROTOCOL_VERSION,
        mode: session.simulation.config.mode,
        participant: null,
        snapshot: toProtocolSnapshot(
          session.simulation.createSnapshot(),
          session.simulation.config.arenaWidthUnits,
          session.simulation.config.arenaHeightUnits,
        ),
        reconnect: this.reconnectMetadata(session)
      };
      return true;
    });
    if (accepted && initialMessage) await connection.send(initialMessage);
    return accepted;
  }

  async advanceOneTick(nowMs = this.clock.nowMs()): Promise<void> {
    await Promise.all([...this.sessions.entries()].map(async ([sessionId, session]) => {
      try {
        if (session.finalizationOutcome) {
          this.scheduleFinalization(sessionId, session, session.finalizationOutcome, nowMs);
          return;
        }
        await session.mutex.runExclusive(() => this.advanceSession(sessionId, session, nowMs));
      } catch (error) {
        captureException(error, { service: "battle-worker", operation: "tick", sessionId });
        this.logger.error("Battle session tick failed", {
          sessionId,
          errorName: error instanceof Error ? error.name : "UnknownError"
        });
      }
    }));
  }

  async flushCheckpoints(): Promise<void> {
    await Promise.all([...this.sessions.values()].map(async (session) => {
      await session.inputQueue.drain();
      await session.lifecycleQueue.drain();
      await session.mutex.runExclusive(() => this.flushCheckpoint(session));
    }));
  }

  private async advanceSession(
    sessionId: string,
    session: ManagedBattleSession,
    nowMs: number
  ): Promise<void> {
    if (session.finalized || !session.leaseOwned) return;
    if (session.finalizationOutcome) {
      this.scheduleFinalization(sessionId, session, session.finalizationOutcome, nowMs);
      return;
    }
    if (nowMs - session.lastLeaseRefreshAtMs >= (this.infrastructure.routeTtlSeconds * 1_000) / 3) {
      this.scheduleRouteRefresh(session);
    }
    const policy = disconnectedAction(session.connectionPolicy, nowMs);
    session.connectionPolicy = policy.state;
    if (policy.action === "pause") return;
    if (policy.action === "forfeit") {
      this.scheduleFinalization(sessionId, session, session.simulation.forceForfeit(), nowMs);
      return;
    }
    if (policy.action === "neutral_input") session.simulation.setNeutralInput();

    const tick = session.simulation.advanceOneTick();
    if (session.connection) {
      for (const event of tick.events) {
        this.sendRealtime(session.connection, {
          type: "battle.event",
          eventId: event.id,
          tick: event.tick,
          eventType: event.type,
          entityIds: event.entityIds,
          moduleIds: event.moduleIds,
          weaponId: event.weaponId,
          value: event.value
        });
      }
      if (tick.snapshot) {
        this.sendRealtime(session.connection, {
          type: "battle.snapshot",
          snapshot: toProtocolSnapshot(
            tick.snapshot,
            session.simulation.config.arenaWidthUnits,
            session.simulation.config.arenaHeightUnits,
          ),
        });
      }
    }

    if (isCheckpointTick(sessionId, tick.tick, CHECKPOINT_INTERVAL_TICKS)) this.scheduleCheckpoint(session);
    if (tick.outcome) this.scheduleFinalization(sessionId, session, tick.outcome, nowMs);
  }

  private async handleMessage(
    sessionId: string,
    connectionId: string,
    message: BattleClientMessage
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    await session.mutex.runExclusive(async () => {
      if (session.connection?.id !== connectionId || session.finalizationOutcome || session.finalized || !session.leaseOwned) return;
      if (message.type === "ping") {
        await session.connection.send({ type: "pong", nonce: message.nonce, serverTick: session.simulation.tick });
        return;
      }
      if (message.type === "session.resume") {
        await session.connection.send({
          type: "battle.initial",
          protocolVersion: BATTLE_PROTOCOL_VERSION,
          mode: session.simulation.config.mode,
          participant: null,
          snapshot: toProtocolSnapshot(
            session.simulation.createSnapshot(),
            session.simulation.config.arenaWidthUnits,
            session.simulation.config.arenaHeightUnits,
          ),
          reconnect: this.reconnectMetadata(session)
        });
        return;
      }

      battleWorkerMetrics.inputReceived("pve");

      if (!session.inputRateLimiter.allow(this.clock.nowMs())) {
        battleWorkerMetrics.inputWasRejected("pve", "rate_limited");
        await session.connection.send({
          type: "session.error",
          code: "INPUT_RATE_LIMITED",
          message: "Input command rate exceeded 30 commands per second (burst 45).",
          retryable: true
        });
        return;
      }

      const queued = session.inputQueue.enqueue(() => this.persistAndApplyInput(
        sessionId,
        session,
        connectionId,
        message.command,
      ));
      if (!queued) {
        battleWorkerMetrics.inputWasRejected("pve", "queue_overflow");
        await session.connection.send({
          type: "session.error",
          code: "INPUT_QUEUE_FULL",
          message: "Input persistence queue is full.",
          retryable: true,
        });
      }
    });
  }

  private async persistAndApplyInput(
    sessionId: string,
    session: ManagedBattleSession,
    connectionId: string,
    command: Extract<BattleClientMessage, { type: "input.command" }>["command"],
  ): Promise<void> {
    try {
      await this.infrastructure.inputJournal.append(sessionId, session.userId, command);
    } catch {
      battleWorkerMetrics.inputWasRejected("pve", "journal_unavailable");
      const connection = session.connection?.id === connectionId ? session.connection : null;
      await connection?.send({
        type: "session.error",
        code: "INPUT_JOURNAL_UNAVAILABLE",
        message: "Input command could not be persisted.",
        retryable: true,
      });
      return;
    }
    await session.mutex.runExclusive(async () => {
      if (session.connection?.id !== connectionId || session.finalizationOutcome || session.finalized || !session.leaseOwned) return;
      const accepted = session.simulation.enqueueInput(command);
      if (!accepted.accepted && accepted.reason !== "duplicate" && accepted.reason !== "already_processed") {
        battleWorkerMetrics.inputWasRejected(
          "pve",
          accepted.reason === "buffer_full" ? "buffer_full" : "invalid",
        );
        await session.connection.send({
          type: "session.error",
          code: "INPUT_REJECTED",
          message: "Input command was rejected.",
          retryable: accepted.reason === "buffer_full",
        });
      }
    });
  }

  private async handleClose(sessionId: string, connectionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    await session.mutex.runExclusive(() => {
      if (session.connection?.id !== connectionId || session.finalized) return;
      session.connection = null;
      const disconnectedAtMs = this.clock.nowMs();
      session.connectionPolicy = markDisconnected(session.connectionPolicy, disconnectedAtMs);
      const reconnectDeadlineAtMs = session.connectionPolicy.deadlineAtMs ?? disconnectedAtMs;
      const queued = session.lifecycleQueue.enqueue(() => this.infrastructure.lifecycle.markDisconnected({
        attemptId: session.simulation.config.attemptId,
        userId: session.userId,
        mode: session.simulation.config.mode,
        disconnectedAtMs,
        reconnectDeadlineAtMs,
      }));
      if (!queued) {
        this.logger.error("PvE lifecycle queue overflow", { sessionId });
      }
      this.scheduleCheckpoint(session);
    });
  }

  private scheduleCheckpoint(session: ManagedBattleSession): void {
    if (!session.leaseOwned) return;
    session.checkpointPending = true;
    if (session.checkpointInFlight) return;
    let task: Promise<void>;
    task = this.drainCheckpointQueue(session).finally(() => {
      if (session.checkpointInFlight === task) session.checkpointInFlight = null;
      if (session.checkpointPending && session.leaseOwned) this.scheduleCheckpoint(session);
    });
    session.checkpointInFlight = task;
    void task.catch((error) => {
      this.logger.error("Battle checkpoint write failed", {
        sessionId: session.simulation.config.sessionId,
        errorName: error instanceof Error ? error.name : "UnknownError"
      });
    });
  }

  private async drainCheckpointQueue(session: ManagedBattleSession): Promise<void> {
    while (session.checkpointPending && session.leaseOwned) {
      session.checkpointPending = false;
      await this.persistCheckpointNow(session);
    }
  }

  private async flushCheckpoint(session: ManagedBattleSession): Promise<void> {
    this.scheduleCheckpoint(session);
    while (session.checkpointInFlight) await session.checkpointInFlight;
  }

  private async persistCheckpointNow(session: ManagedBattleSession): Promise<void> {
    if (!session.leaseOwned) return;
    const checkpoint = session.simulation.createCheckpoint();
    const savedAtMs = this.clock.nowMs();
    await this.checkpoints.save({
      kind: "pve",
      sessionId: session.simulation.config.sessionId,
      attemptId: session.simulation.config.attemptId,
      userId: session.userId,
      mode: session.simulation.config.mode,
      simulation: checkpoint,
      disconnectedAtMs: session.connectionPolicy.disconnectedAtMs,
      disconnectDeadlineAtMs: session.connectionPolicy.deadlineAtMs,
      hasConnectedBefore: session.hasConnectedBefore,
      completedAtMs: session.completedAtMs,
      savedAtMs
    });
    session.latestCheckpointTick = checkpoint.state.tick;
    battleWorkerMetrics.checkpointSaved(session.simulation.config.sessionId, "pve", savedAtMs);
    await this.refreshRoute(session);
  }

  private scheduleRouteRefresh(session: ManagedBattleSession): void {
    if (!session.leaseOwned || session.routeRefreshInFlight) return;
    let task: Promise<void>;
    task = this.refreshRoute(session).finally(() => {
      if (session.routeRefreshInFlight === task) session.routeRefreshInFlight = null;
    });
    session.routeRefreshInFlight = task;
    void task.catch((error) => {
      this.logger.error("Battle route refresh failed", {
        sessionId: session.simulation.config.sessionId,
        errorName: error instanceof Error ? error.name : "UnknownError"
      });
    });
  }

  private async refreshRoute(session: ManagedBattleSession): Promise<void> {
    const refreshed = await this.infrastructure.router.refresh(
      session.simulation.config.sessionId,
      this.infrastructure.routeLease,
      this.infrastructure.routeTtlSeconds
    );
    session.lastLeaseRefreshAtMs = this.clock.nowMs();
    if (refreshed) return;
    session.leaseOwned = false;
    session.connection?.close(1012, "battle session lease lost");
    session.connection = null;
    throw new Error("Battle session route lease was lost.");
  }

  private scheduleFinalization(
    sessionId: string,
    session: ManagedBattleSession,
    outcome: MissionOutcome,
    nowMs: number
  ): void {
    session.finalizationOutcome ??= outcome;
    session.completedAtMs ??= nowMs;
    if (session.finalizationStarted || nowMs < session.nextFinalizationAttemptAtMs) return;
    session.finalizationStarted = true;
    void this.finalize(sessionId, session, session.finalizationOutcome);
  }

  private async finalize(
    sessionId: string,
    session: ManagedBattleSession,
    outcome: MissionOutcome
  ): Promise<void> {
    try {
      if (!session.replayAttached) {
        await session.inputQueue.drain();
        await session.lifecycleQueue.drain();
        await this.flushCheckpoint(session);
        const finalCheckpoint = session.simulation.createCheckpoint();
        let finalized = session.finalized;
        if (!finalized) {
          const result = await this.finalizer.finalizeOnce({
            idempotencyKey: `battle:${session.simulation.config.attemptId}`,
            sessionId,
            attemptId: session.simulation.config.attemptId,
            userId: session.userId,
            mode: session.simulation.config.mode,
            simulationConfig: session.simulation.config,
            finalCheckpoint,
            replay: null,
            outcome
          });
          finalized = { result, outcome };
          session.finalized = finalized;
          battleWorkerMetrics.finalizationCompleted(
            "pve",
            this.clock.nowMs() - (session.completedAtMs ?? this.clock.nowMs()),
          );
          battleWorkerMetrics.replayPendingStarted(sessionId, "pve");
          const connection = session.connection;
          session.connection = null;
          if (connection) {
            await connection.send(this.endedMessage(result, outcome));
            connection.close(1000, "battle completed");
          }
        }
        const inputs = await this.infrastructure.inputJournal.readAfter(sessionId, session.userId, 0);
        const replay = await this.infrastructure.replayStorage.store({
          kind: "pve",
          simulationConfig: session.simulation.config,
          finalCheckpoint,
          inputs,
          outcome,
          completedAtMs: session.completedAtMs ?? this.clock.nowMs()
        });
        await this.finalizer.attachReplayOnce({
          kind: "pve",
          idempotencyKey: `battle:${session.simulation.config.attemptId}:replay`,
          attemptId: session.simulation.config.attemptId,
          replay
        });
        battleWorkerMetrics.replayPendingResolved(sessionId, "pve");
        session.replayAttached = true;
      }
      await Promise.all([
        this.checkpoints.delete(sessionId),
        this.infrastructure.inputJournal.delete(sessionId),
        this.infrastructure.definitions.delete(sessionId),
        this.infrastructure.router.release(sessionId, this.infrastructure.routeLease)
      ]);
      this.sessions.delete(sessionId);
      battleWorkerMetrics.sessionDeactivated(sessionId);
      this.logger.info("Battle finalized", {
        sessionId,
        attemptId: session.simulation.config.attemptId,
        outcome: outcome.outcome
      });
    } catch (error) {
      battleWorkerMetrics.finalizationRetry(
        "pve",
        !session.finalized ? "database" : session.replayAttached ? "cleanup" : "replay",
      );
      session.finalizationStarted = false;
      session.finalizationAttempts += 1;
      session.nextFinalizationAttemptAtMs = this.clock.nowMs()
        + finalizationRetryDelayMs(session.finalizationAttempts);
      this.logger.error("Battle finalization failed", {
        sessionId,
        attemptId: session.simulation.config.attemptId,
        retryAttempt: session.finalizationAttempts,
        retryAtMs: session.nextFinalizationAttemptAtMs,
        errorName: error instanceof Error ? error.name : "UnknownError"
      });
    }
  }

  private newSession(
    userId: string,
    simulation: MissionSimulation,
    connectionPolicy: ConnectionPolicyState,
    latestCheckpointTick: number,
    completedAtMs: number | null = null,
    hasConnectedBefore = false,
  ): ManagedBattleSession {
    return {
      userId,
      simulation,
      connection: null,
      hasConnectedBefore,
      connectionPolicy,
      latestCheckpointTick,
      lastLeaseRefreshAtMs: this.clock.nowMs(),
      leaseOwned: true,
      finalizationStarted: false,
      finalizationOutcome: null,
      finalizationAttempts: 0,
      nextFinalizationAttemptAtMs: 0,
      finalized: null,
      replayAttached: false,
      completedAtMs,
      checkpointPending: false,
      checkpointInFlight: null,
      routeRefreshInFlight: null,
      inputRateLimiter: new InputRateLimiter(this.clock.nowMs()),
      inputQueue: new BoundedOrderedQueue(INPUT_QUEUE_CAPACITY, (error) => {
        captureException(error, { service: "battle-worker", operation: "pve-input-queue" });
        this.logger.error("PvE input queue task failed", {
          sessionId: simulation.config.sessionId,
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      }),
      lifecycleQueue: new BoundedOrderedQueue(LIFECYCLE_QUEUE_CAPACITY, (error) => {
        captureException(error, { service: "battle-worker", operation: "pve-lifecycle-queue" });
        this.logger.error("PvE lifecycle queue task failed", {
          sessionId: simulation.config.sessionId,
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      }),
      mutex: new AsyncMutex()
    };
  }

  private async claimRoute(sessionId: string): Promise<boolean> {
    return this.infrastructure.router.claim(
      sessionId,
      this.infrastructure.routeLease,
      this.infrastructure.routeTtlSeconds
    );
  }

  private reconnectMetadata(session: ManagedBattleSession): ReconnectMetadata {
    const disconnectedAtMs = session.connectionPolicy.disconnectedAtMs;
    const deadlineAtMs = session.connectionPolicy.deadlineAtMs;
    return {
      permitted: !session.connectionPolicy.forfeited && !session.finalized,
      disconnectedAt: disconnectedAtMs === null ? null : new Date(disconnectedAtMs).toISOString(),
      deadlineAt: deadlineAtMs === null ? null : new Date(deadlineAtMs).toISOString(),
      lastProcessedInputSequence: session.simulation.lastProcessedInputSequence,
      latestCheckpointTick: session.latestCheckpointTick
    };
  }

  private endedMessage(result: FinalizeBattleResult, outcome: MissionOutcome): BattleServerMessage {
    return {
      type: "battle.ended",
      resultId: result.resultId,
      outcome: outcome.outcome,
      reason: outcome.reason,
      finalTick: outcome.finalTick,
      finalStateHash: outcome.finalStateHash
    };
  }

  private sendRealtime(connection: BattleConnection, message: BattleServerMessage): void {
    try {
      const sent = connection.send(message);
      if (sent && typeof sent.then === "function") {
        void sent.catch((error) => this.logger.warn("Battle realtime send failed", {
          errorName: error instanceof Error ? error.name : "UnknownError",
        }));
      }
    } catch (error) {
      this.logger.warn("Battle realtime send failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  private claimsMatchSession(claims: BattleTicketClaims, session: ManagedBattleSession): boolean {
    const config = session.simulation.config;
    return claims.userId === session.userId
      && claims.attemptId === config.attemptId
      && claims.mode === config.mode;
  }

  private assertCheckpointIdentity(stored: StoredPveBattleSessionCheckpoint): void {
    const config = stored.simulation.config;
    if (stored.sessionId !== config.sessionId
      || stored.attemptId !== config.attemptId
      || stored.mode !== config.mode) {
      throw new Error("Battle checkpoint identity mismatch.");
    }
  }
}

function toProtocolSnapshot(
  snapshot: SimulationSnapshot,
  arenaWidthUnits: number,
  arenaHeightUnits: number,
): BattleSnapshot {
  return {
    sessionId: snapshot.sessionId,
    tick: snapshot.tick,
    stateHash: snapshot.stateHash,
    lastProcessedInputSequence: snapshot.lastProcessedInputSequence,
    status: snapshot.status,
    objective: snapshot.objective,
    entities: snapshot.entities,
    arenaWidthMilli: arenaWidthUnits * 1_000,
    arenaHeightMilli: arenaHeightUnits * 1_000,
  };
}
