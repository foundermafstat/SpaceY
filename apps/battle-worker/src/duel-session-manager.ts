import { BATTLE_PROTOCOL_VERSION, type BattleServerMessage, type BattleSnapshot, type ReconnectMetadata } from "@spacey/protocol";
import { battleWorkerMetrics, captureException } from "@spacey/observability";
import {
  CHECKPOINT_INTERVAL_TICKS,
  DuelSimulation,
  type DuelOutcome,
  type DuelSimulationSnapshot,
} from "@spacey/simulation";
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
  FinalizeDuelRequest,
  FinalizeDuelResult,
  PvpBattleTicketClaims,
  StoredPvpBattleSessionCheckpoint,
} from "./ports.js";
import type { BattleSessionInfrastructure } from "./session-manager.js";

const PVP_READY_TIMEOUT_MS = 20_000;
const INPUT_QUEUE_CAPACITY = 256;
const LIFECYCLE_QUEUE_CAPACITY = 64;

type DuelParticipantRuntime = CreatePvpBattleSessionRequest["participants"][number] & {
  connection: BattleConnection | null;
  hasConnectedBefore: boolean;
  policy: ConnectionPolicyState;
  inputRateLimiter: InputRateLimiter;
};

type ManagedDuelSession = {
  simulation: DuelSimulation;
  participants: [DuelParticipantRuntime, DuelParticipantRuntime];
  started: boolean;
  readyDeadlineAtMs: number;
  latestCheckpointTick: number;
  lastLeaseRefreshAtMs: number;
  leaseOwned: boolean;
  finalizationStarted: boolean;
  finalizationOutcome: DuelOutcome | null;
  finalizationAttempts: number;
  nextFinalizationAttemptAtMs: number;
  finalized: { result: FinalizeDuelResult; outcome: DuelOutcome } | null;
  replayAttached: boolean;
  completedAtMs: number | null;
  checkpointPending: boolean;
  checkpointInFlight: Promise<void> | null;
  routeRefreshInFlight: Promise<void> | null;
  inputQueue: BoundedOrderedQueue;
  lifecycleQueue: BoundedOrderedQueue;
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
    battleWorkerMetrics.sessionActivated(sessionId, "pvp");
  }

  async ensureSession(request: CreatePvpBattleSessionRequest): Promise<boolean> {
    if (this.sessions.has(request.simulationConfig.sessionId)) return true;
    return this.restoreSession(request.simulationConfig.sessionId, request);
  }

  async restoreSession(sessionId: string, fallbackRequest?: CreatePvpBattleSessionRequest): Promise<boolean> {
    if (this.sessions.has(sessionId)) return true;
    const stored = await this.checkpoints.load(sessionId);
    const databaseFinalized = fallbackRequest?.databaseFinalized === true;
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
        readyDeadlineAtMs: stored.readyDeadlineAtMs,
        databaseFinalized,
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
          hasConnectedBefore: participant.hasConnectedBefore ?? false,
          policy: restored.connected ? markDisconnected(restored, this.clock.nowMs()) : restored,
          inputRateLimiter: new InputRateLimiter(this.clock.nowMs()),
        };
      }) as [DuelParticipantRuntime, DuelParticipantRuntime];
      checkpointTick = stored.simulation.state.tick;
    } else {
      const definition = fallbackRequest ?? await this.infrastructure.definitions.load(sessionId);
      if (!definition || definition.kind !== "pvp" || definition.simulationConfig.sessionId !== sessionId) return false;
      this.validateDefinition(definition);
      request = definition;
      simulation = new DuelSimulation(definition.simulationConfig);
      participants = this.participantRuntimes(definition);
    }

    const recoveredOutcome = databaseFinalized ? simulation.createSnapshot().outcome : null;
    if (databaseFinalized && !recoveredOutcome) {
      throw new Error("Finalized PvP session checkpoint does not contain an authoritative outcome.");
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
      readyDeadlineAtMs: stored?.kind === "pvp"
        ? stored.readyDeadlineAtMs ?? stored.savedAtMs + PVP_READY_TIMEOUT_MS
        : request.readyDeadlineAtMs ?? this.clock.nowMs() + PVP_READY_TIMEOUT_MS,
      latestCheckpointTick: checkpointTick,
      lastLeaseRefreshAtMs: this.clock.nowMs(),
      leaseOwned: true,
      finalizationStarted: false,
      finalizationOutcome: recoveredOutcome,
      finalizationAttempts: 0,
      nextFinalizationAttemptAtMs: 0,
      finalized: recoveredOutcome ? { result: { resultIds: {} }, outcome: recoveredOutcome } : null,
      replayAttached: false,
      completedAtMs: stored?.kind === "pvp"
        ? stored.completedAtMs ?? (recoveredOutcome ? this.clock.nowMs() : null)
        : recoveredOutcome ? this.clock.nowMs() : null,
      checkpointPending: false,
      checkpointInFlight: null,
      routeRefreshInFlight: null,
      inputQueue: this.newInputQueue(sessionId),
      lifecycleQueue: this.newLifecycleQueue(sessionId),
      mutex: new AsyncMutex(),
    });
    battleWorkerMetrics.sessionActivated(sessionId, "pvp");
    if (stored?.kind === "pvp") battleWorkerMetrics.checkpointSaved(sessionId, "pvp", stored.savedAtMs);
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
      if (session.finalizationOutcome) {
        connection.close(4409, "duel result is finalizing");
        return false;
      }
      if (!session.started && this.clock.nowMs() >= session.readyDeadlineAtMs) {
        connection.close(4409, "duel ready deadline elapsed");
        return false;
      }
      if (!session.lifecycleQueue.hasCapacity) {
        connection.close(1013, "duel lifecycle queue is full");
        return false;
      }
      const isReconnect = participant.hasConnectedBefore;
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
      const connectedAtMs = this.clock.nowMs();
      const lifecycleQueued = session.lifecycleQueue.enqueue(async () => {
        try {
          await this.infrastructure.lifecycle.markConnected({
            attemptId: participant.attemptId,
            userId: participant.userId,
            connectedAtMs,
          });
        } catch (error) {
          if (participant.connection?.id === connection.id) connection.close(1011, "duel lifecycle persistence failed");
          throw error;
        }
      });
      if (!lifecycleQueued) {
        connection.close(1013, "duel lifecycle queue is full");
        participant.connection = null;
        return false;
      }
      participant.hasConnectedBefore = true;
      if (isReconnect) battleWorkerMetrics.reconnected("pvp");
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
        if (session.finalizationOutcome) {
          this.scheduleFinalization(sessionId, session, session.finalizationOutcome, nowMs);
          return;
        }
        await session.mutex.runExclusive(() => this.advanceSession(sessionId, session, nowMs));
      } catch (error) {
        this.logger.error("Duel session tick failed", {
          sessionId,
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage: error instanceof Error ? error.message : String(error),
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

  private async advanceSession(sessionId: string, session: ManagedDuelSession, nowMs: number) {
    if (session.finalized || !session.leaseOwned) return;
    if (session.finalizationOutcome) {
      this.scheduleFinalization(sessionId, session, session.finalizationOutcome, nowMs);
      return;
    }
    if (nowMs - session.lastLeaseRefreshAtMs >= (this.infrastructure.routeTtlSeconds * 1_000) / 3) {
      this.scheduleRouteRefresh(session);
    }
    if (!session.started) {
      const connected = session.participants.filter((participant) => participant.policy.connected);
      if (nowMs >= session.readyDeadlineAtMs) {
        const outcome = connected.length === 0
          ? session.simulation.forceNoContest()
          : session.simulation.forceForfeit(
              session.participants.find((participant) => !participant.policy.connected)!.userId
            );
        battleWorkerMetrics.noShow(connected.length === 0 ? "no_contest" : "forfeit");
        this.scheduleFinalization(sessionId, session, outcome, nowMs);
        return;
      }
      if (connected.length !== session.participants.length) return;
      await this.startSession(session);
    }
    for (const participant of session.participants) {
      const action = disconnectedAction(participant.policy, nowMs);
      participant.policy = action.state;
      if (action.action === "forfeit") {
        this.scheduleFinalization(sessionId, session, session.simulation.forceForfeit(participant.userId), nowMs);
        return;
      }
      if (action.action === "neutral_input") session.simulation.setNeutralInput(participant.userId);
    }
    const tick = session.simulation.advanceOneTick();
    for (const event of tick.events) {
      this.broadcast(session, {
        type: "battle.event",
        eventId: event.id,
        tick: event.tick,
        eventType: event.type,
        entityIds: event.entityIds,
        moduleIds: event.moduleIds,
        userIds: event.userIds,
        weaponId: event.weaponId,
        value: event.value,
      });
    }
    if (tick.snapshot) {
      for (const participant of session.participants) {
        if (participant.connection) this.sendRealtime(participant.connection, {
          type: "battle.snapshot",
          snapshot: this.snapshotFor(
            tick.snapshot,
            participant.userId,
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
    userId: string,
    connectionId: string,
    message: import("@spacey/protocol").BattleClientMessage,
  ) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    await session.mutex.runExclusive(async () => {
      const participant = session.participants.find((candidate) => candidate.userId === userId);
      if (!participant || participant.connection?.id !== connectionId || session.finalizationOutcome || session.finalized || !session.leaseOwned) return;
      if (message.type === "ping") {
        await participant.connection.send({ type: "pong", nonce: message.nonce, serverTick: session.simulation.tick });
        return;
      }
      if (message.type === "session.resume") {
        if (session.started) await participant.connection.send(this.initialMessage(session, participant));
        return;
      }
      battleWorkerMetrics.inputReceived("pvp");
      if (!session.started) {
        battleWorkerMetrics.inputWasRejected("pvp", "match_not_started");
        await participant.connection.send({
          type: "session.error",
          code: "MATCH_NOT_STARTED",
          message: "Waiting for both PvP participants to connect.",
          retryable: true,
        });
        return;
      }
      if (!participant.inputRateLimiter.allow(this.clock.nowMs())) {
        battleWorkerMetrics.inputWasRejected("pvp", "rate_limited");
        await participant.connection.send({
          type: "session.error",
          code: "INPUT_RATE_LIMITED",
          message: "Input command rate exceeded 30 commands per second (burst 45).",
          retryable: true,
        });
        return;
      }
      const queued = session.inputQueue.enqueue(() => this.persistAndApplyInput(
        sessionId,
        session,
        userId,
        connectionId,
        message.command,
      ));
      if (!queued) {
        battleWorkerMetrics.inputWasRejected("pvp", "queue_overflow");
        await participant.connection.send({
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
    session: ManagedDuelSession,
    userId: string,
    connectionId: string,
    command: Extract<import("@spacey/protocol").BattleClientMessage, { type: "input.command" }>["command"],
  ) {
    try {
      await this.infrastructure.inputJournal.append(sessionId, userId, command);
    } catch {
      battleWorkerMetrics.inputWasRejected("pvp", "journal_unavailable");
      const participant = session.participants.find((candidate) => candidate.userId === userId);
      const connection = participant?.connection?.id === connectionId ? participant.connection : null;
      await connection?.send({
        type: "session.error",
        code: "INPUT_JOURNAL_UNAVAILABLE",
        message: "Input command could not be persisted.",
        retryable: true,
      });
      return;
    }
    await session.mutex.runExclusive(async () => {
      const participant = session.participants.find((candidate) => candidate.userId === userId);
      if (!participant || participant.connection?.id !== connectionId || session.finalizationOutcome || session.finalized || !session.leaseOwned) return;
      const accepted = session.simulation.enqueueInput(userId, command);
      if (!accepted.accepted && accepted.reason !== "duplicate" && accepted.reason !== "already_processed") {
        battleWorkerMetrics.inputWasRejected(
          "pvp",
          accepted.reason === "buffer_full" ? "buffer_full" : "invalid",
        );
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
    await session.mutex.runExclusive(() => {
      const participant = session.participants.find((candidate) => candidate.userId === userId);
      if (!participant || participant.connection?.id !== connectionId || session.finalized) return;
      participant.connection = null;
      const disconnectedAtMs = this.clock.nowMs();
      participant.policy = markDisconnected(participant.policy, disconnectedAtMs);
      session.simulation.setNeutralInput(userId);
      const reconnectDeadlineAtMs = participant.policy.deadlineAtMs ?? disconnectedAtMs;
      const queued = session.lifecycleQueue.enqueue(() => this.infrastructure.lifecycle.markDisconnected({
        attemptId: participant.attemptId,
        userId,
        mode: "pvp",
        disconnectedAtMs,
        reconnectDeadlineAtMs,
      }));
      if (!queued) this.logger.error("PvP lifecycle queue overflow", { sessionId });
      this.scheduleCheckpoint(session);
    });
  }

  private scheduleCheckpoint(session: ManagedDuelSession) {
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
      this.logger.error("Duel checkpoint write failed", {
        sessionId: session.simulation.config.sessionId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    });
  }

  private async drainCheckpointQueue(session: ManagedDuelSession) {
    while (session.checkpointPending && session.leaseOwned) {
      session.checkpointPending = false;
      await this.persistCheckpointNow(session);
    }
  }

  private async flushCheckpoint(session: ManagedDuelSession) {
    this.scheduleCheckpoint(session);
    while (session.checkpointInFlight) await session.checkpointInFlight;
  }

  private async persistCheckpointNow(session: ManagedDuelSession) {
    if (!session.leaseOwned) return;
    const checkpoint = session.simulation.createCheckpoint();
    const savedAtMs = this.clock.nowMs();
    await this.checkpoints.save({
      kind: "pvp",
      sessionId: session.simulation.config.sessionId,
      matchId: session.simulation.config.matchId,
      started: session.started,
      readyDeadlineAtMs: session.readyDeadlineAtMs,
      completedAtMs: session.completedAtMs,
      simulation: checkpoint,
      participants: session.participants.map((participant) => ({
        userId: participant.userId,
        attemptId: participant.attemptId,
        participantId: participant.participantId,
        side: participant.side,
        disconnectedAtMs: participant.policy.disconnectedAtMs,
        disconnectDeadlineAtMs: participant.policy.deadlineAtMs,
        hasConnectedBefore: participant.hasConnectedBefore,
      })) as StoredPvpBattleSessionCheckpoint["participants"],
      savedAtMs,
    });
    session.latestCheckpointTick = checkpoint.state.tick;
    battleWorkerMetrics.checkpointSaved(session.simulation.config.sessionId, "pvp", savedAtMs);
    await this.refreshRoute(session);
  }

  private scheduleRouteRefresh(session: ManagedDuelSession) {
    if (!session.leaseOwned || session.routeRefreshInFlight) return;
    let task: Promise<void>;
    task = this.refreshRoute(session).finally(() => {
      if (session.routeRefreshInFlight === task) session.routeRefreshInFlight = null;
    });
    session.routeRefreshInFlight = task;
    void task.catch((error) => {
      this.logger.error("Duel route refresh failed", {
        sessionId: session.simulation.config.sessionId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    });
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

  private scheduleFinalization(
    sessionId: string,
    session: ManagedDuelSession,
    outcome: DuelOutcome,
    nowMs: number,
  ) {
    session.finalizationOutcome ??= outcome;
    session.completedAtMs ??= nowMs;
    if (session.finalizationStarted || nowMs < session.nextFinalizationAttemptAtMs) return;
    session.finalizationStarted = true;
    void this.finalize(sessionId, session, session.finalizationOutcome);
  }

  private async finalize(sessionId: string, session: ManagedDuelSession, outcome: DuelOutcome) {
    try {
      if (!session.replayAttached) {
        await session.inputQueue.drain();
        await session.lifecycleQueue.drain();
        await this.flushCheckpoint(session);
        const finalCheckpoint = session.simulation.createCheckpoint();
        const cancellation = outcome.reason === "no_contest"
          ? "no_contest" as const
          : !session.started && outcome.reason === "disconnect_forfeit" && outcome.finalTick === 0
            ? "no_show_forfeit" as const
            : null;
        const requestBase = {
          idempotencyKey: `pvp-match:${session.simulation.config.matchId}`,
          sessionId,
          matchId: session.simulation.config.matchId,
          participants: session.participants.map(({ userId, attemptId, participantId, side }) => ({
            userId, attemptId, participantId, side,
          })) as CreatePvpBattleSessionRequest["participants"],
          simulationConfig: session.simulation.config,
          finalCheckpoint,
          outcome,
        };
        let finalizationRequest: FinalizeDuelRequest;
        if (!session.finalized) {
          finalizationRequest = cancellation
            ? { ...requestBase, cancellation, replay: null }
            : { ...requestBase, cancellation: null, replay: null };
          const result = await this.finalizer.finalizeDuelOnce(finalizationRequest);
          session.finalized = { result, outcome };
          battleWorkerMetrics.finalizationCompleted(
            "pvp",
            this.clock.nowMs() - (session.completedAtMs ?? this.clock.nowMs()),
          );
          if (!cancellation) battleWorkerMetrics.replayPendingStarted(sessionId, "pvp");
          for (const participant of session.participants) {
            const participantOutcome = outcome.results.find((candidate) => candidate.userId === participant.userId);
            const resultId = result.resultIds[participant.userId];
            const connection = participant.connection;
            participant.connection = null;
            if (connection && participantOutcome && resultId) {
              await connection.send({
                type: "battle.ended",
                resultId,
                outcome: participantOutcome.outcome,
                reason: participantOutcome.reason,
                finalTick: outcome.finalTick,
                finalStateHash: outcome.finalStateHash,
              });
              connection.close(1000, "duel completed");
            }
          }
        }
        if (!cancellation) {
          const inputs = await this.infrastructure.inputJournal.readAll(sessionId);
          const replay = await this.infrastructure.replayStorage.store({
            kind: "pvp",
            simulationConfig: session.simulation.config,
            finalCheckpoint,
            inputs,
            outcome,
            completedAtMs: session.completedAtMs ?? this.clock.nowMs(),
          });
          await this.finalizer.attachReplayOnce({
            kind: "pvp",
            idempotencyKey: `pvp-match:${session.simulation.config.matchId}:replay`,
            matchId: session.simulation.config.matchId,
            replay,
          });
          battleWorkerMetrics.replayPendingResolved(sessionId, "pvp");
        }
        session.replayAttached = true;
      }
      await Promise.all([
        this.checkpoints.delete(sessionId),
        this.infrastructure.inputJournal.delete(sessionId),
        this.infrastructure.definitions.delete(sessionId),
        this.infrastructure.router.release(sessionId, this.infrastructure.routeLease),
      ]);
      this.sessions.delete(sessionId);
      battleWorkerMetrics.sessionDeactivated(sessionId);
      this.logger.info("PvP duel finalized", { sessionId, matchId: session.simulation.config.matchId });
    } catch (error) {
      battleWorkerMetrics.finalizationRetry(
        "pvp",
        !session.finalized ? "database" : session.replayAttached ? "cleanup" : "replay",
      );
      session.finalizationStarted = false;
      session.finalizationAttempts += 1;
      session.nextFinalizationAttemptAtMs = this.clock.nowMs()
        + finalizationRetryDelayMs(session.finalizationAttempts);
      this.logger.error("PvP duel finalization failed", {
        sessionId,
        matchId: session.simulation.config.matchId,
        retryAttempt: session.finalizationAttempts,
        retryAtMs: session.nextFinalizationAttemptAtMs,
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
      snapshot: this.snapshotFor(
        snapshot,
        participant.userId,
        session.simulation.config.arenaWidthUnits,
        session.simulation.config.arenaHeightUnits,
      ),
      reconnect: this.reconnectMetadata(session, participant),
    };
  }

  private snapshotFor(
    snapshot: DuelSimulationSnapshot,
    userId: string,
    arenaWidthUnits: number,
    arenaHeightUnits: number,
  ): BattleSnapshot {
    const outcome = snapshot.outcome?.results.find((candidate) => candidate.userId === userId);
    const opponent = snapshot.entities.find((entity) => entity.kind === "ship" && entity.ownerUserId !== userId);
    return {
      sessionId: snapshot.sessionId,
      tick: snapshot.tick,
      stateHash: snapshot.stateHash,
      lastProcessedInputSequence: snapshot.lastProcessedInputSequences[userId] ?? 0,
      status: snapshot.status === "active"
        ? "active"
        : outcome?.outcome === "victory"
          ? "victory"
          : outcome?.outcome === "draw"
            ? "draw"
            : "defeat",
      objective: { type: "destroy_opponent", progress: opponent?.hull === 0 ? 1 : 0, target: 1 },
      arenaWidthMilli: arenaWidthUnits * 1_000,
      arenaHeightMilli: arenaHeightUnits * 1_000,
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
        weaponId: entity.weaponId,
        shipSystems: entity.shipSystems,
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

  private broadcast(session: ManagedDuelSession, message: BattleServerMessage) {
    for (const participant of session.participants) {
      if (participant.connection) this.sendRealtime(participant.connection, message);
    }
  }

  private sendRealtime(connection: BattleConnection, message: BattleServerMessage): void {
    try {
      const sent = connection.send(message);
      if (sent && typeof sent.then === "function") {
        void sent.catch((error) => this.logger.warn("Duel realtime send failed", {
          errorName: error instanceof Error ? error.name : "UnknownError",
        }));
      }
    } catch (error) {
      this.logger.warn("Duel realtime send failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
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
      hasConnectedBefore: false,
      policy: markDisconnected(createConnectionPolicy("pvp"), this.clock.nowMs()),
      inputRateLimiter: new InputRateLimiter(this.clock.nowMs()),
    })) as [DuelParticipantRuntime, DuelParticipantRuntime];
  }

  private newSession(request: CreatePvpBattleSessionRequest, simulation: DuelSimulation): ManagedDuelSession {
    return {
      simulation,
      participants: this.participantRuntimes(request),
      started: false,
      readyDeadlineAtMs: request.readyDeadlineAtMs ?? this.clock.nowMs() + PVP_READY_TIMEOUT_MS,
      latestCheckpointTick: 0,
      lastLeaseRefreshAtMs: this.clock.nowMs(),
      leaseOwned: true,
      finalizationStarted: false,
      finalizationOutcome: null,
      finalizationAttempts: 0,
      nextFinalizationAttemptAtMs: 0,
      finalized: null,
      replayAttached: false,
      completedAtMs: null,
      checkpointPending: false,
      checkpointInFlight: null,
      routeRefreshInFlight: null,
      inputQueue: this.newInputQueue(request.simulationConfig.sessionId),
      lifecycleQueue: this.newLifecycleQueue(request.simulationConfig.sessionId),
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

  private newInputQueue(sessionId: string): BoundedOrderedQueue {
    return new BoundedOrderedQueue(INPUT_QUEUE_CAPACITY, (error) => {
      captureException(error, { service: "battle-worker", operation: "pvp-input-queue" });
      this.logger.error("PvP input queue task failed", {
        sessionId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    });
  }

  private newLifecycleQueue(sessionId: string): BoundedOrderedQueue {
    return new BoundedOrderedQueue(LIFECYCLE_QUEUE_CAPACITY, (error) => {
      captureException(error, { service: "battle-worker", operation: "pvp-lifecycle-queue" });
      this.logger.error("PvP lifecycle queue task failed", {
        sessionId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    });
  }

  private validateCheckpoint(stored: StoredPvpBattleSessionCheckpoint) {
    if (stored.sessionId !== stored.simulation.config.sessionId
      || stored.matchId !== stored.simulation.config.matchId) throw new Error("Duel checkpoint identity mismatch.");
  }

  private claimRoute(sessionId: string) {
    return this.infrastructure.router.claim(sessionId, this.infrastructure.routeLease, this.infrastructure.routeTtlSeconds);
  }
}
