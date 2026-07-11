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
import { captureException } from "@spacey/observability";

import { AsyncMutex } from "./async-mutex.js";
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
  connectionPolicy: ConnectionPolicyState;
  latestCheckpointTick: number;
  lastLeaseRefreshAtMs: number;
  leaseOwned: boolean;
  finalizationStarted: boolean;
  finalized: { result: FinalizeBattleResult; outcome: MissionOutcome } | null;
  mutex: AsyncMutex;
};

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
      this.newSession(request.userId, simulation, connectionPolicy, checkpointTick)
    );
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

    return session.mutex.runExclusive(async () => {
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

      await this.infrastructure.lifecycle.markConnected({
        attemptId: session.simulation.config.attemptId,
        userId: session.userId,
        connectedAtMs: this.clock.nowMs()
      });

      await connection.send({
        type: "battle.initial",
        protocolVersion: BATTLE_PROTOCOL_VERSION,
        mode: session.simulation.config.mode,
        participant: null,
        snapshot: toProtocolSnapshot(session.simulation.createSnapshot()),
        reconnect: this.reconnectMetadata(session)
      });
      return true;
    });
  }

  async advanceOneTick(nowMs = this.clock.nowMs()): Promise<void> {
    await Promise.all([...this.sessions.entries()].map(async ([sessionId, session]) => {
      try {
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
    await Promise.all([...this.sessions.values()].map((session) =>
      session.mutex.runExclusive(() => this.persistCheckpoint(session))
    ));
  }

  private async advanceSession(
    sessionId: string,
    session: ManagedBattleSession,
    nowMs: number
  ): Promise<void> {
    if (session.finalized || !session.leaseOwned) return;
    if (nowMs - session.lastLeaseRefreshAtMs >= (this.infrastructure.routeTtlSeconds * 1_000) / 3) {
      await this.refreshRoute(session);
    }
    const policy = disconnectedAction(session.connectionPolicy, nowMs);
    session.connectionPolicy = policy.state;
    if (policy.action === "pause") return;
    if (policy.action === "forfeit") {
      await this.finalize(sessionId, session, session.simulation.forceForfeit());
      return;
    }
    if (policy.action === "neutral_input") session.simulation.setNeutralInput();

    const tick = session.simulation.advanceOneTick();
    if (session.connection) {
      for (const event of tick.events) {
        await session.connection.send({
          type: "battle.event",
          eventId: event.id,
          tick: event.tick,
          eventType: event.type,
          entityIds: event.entityIds
        });
      }
      if (tick.snapshot) {
        await session.connection.send({ type: "battle.snapshot", snapshot: toProtocolSnapshot(tick.snapshot) });
      }
    }

    if (tick.tick % CHECKPOINT_INTERVAL_TICKS === 0) await this.persistCheckpoint(session);
    if (tick.outcome) await this.finalize(sessionId, session, tick.outcome);
  }

  private async handleMessage(
    sessionId: string,
    connectionId: string,
    message: BattleClientMessage
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    await session.mutex.runExclusive(async () => {
      if (session.connection?.id !== connectionId || session.finalized || !session.leaseOwned) return;
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
          snapshot: toProtocolSnapshot(session.simulation.createSnapshot()),
          reconnect: this.reconnectMetadata(session)
        });
        return;
      }

      try {
        await this.infrastructure.inputJournal.append(sessionId, session.userId, message.command);
      } catch {
        await session.connection.send({
          type: "session.error",
          code: "INPUT_JOURNAL_UNAVAILABLE",
          message: "Input command could not be persisted.",
          retryable: true
        });
        return;
      }
      const accepted = session.simulation.enqueueInput(message.command);
      if (!accepted.accepted && accepted.reason !== "duplicate" && accepted.reason !== "already_processed") {
        await session.connection.send({
          type: "session.error",
          code: "INPUT_REJECTED",
          message: "Input command was rejected.",
          retryable: accepted.reason === "buffer_full"
        });
      }
    });
  }

  private async handleClose(sessionId: string, connectionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    await session.mutex.runExclusive(async () => {
      if (session.connection?.id !== connectionId || session.finalized) return;
      session.connection = null;
      const disconnectedAtMs = this.clock.nowMs();
      session.connectionPolicy = markDisconnected(session.connectionPolicy, disconnectedAtMs);
      await this.infrastructure.lifecycle.markDisconnected({
        attemptId: session.simulation.config.attemptId,
        userId: session.userId,
        mode: session.simulation.config.mode,
        disconnectedAtMs,
        reconnectDeadlineAtMs: session.connectionPolicy.deadlineAtMs ?? disconnectedAtMs
      });
      await this.persistCheckpoint(session);
    });
  }

  private async persistCheckpoint(session: ManagedBattleSession): Promise<void> {
    if (!session.leaseOwned) return;
    const checkpoint = session.simulation.createCheckpoint();
    await this.checkpoints.save({
      kind: "pve",
      sessionId: session.simulation.config.sessionId,
      attemptId: session.simulation.config.attemptId,
      userId: session.userId,
      mode: session.simulation.config.mode,
      simulation: checkpoint,
      disconnectedAtMs: session.connectionPolicy.disconnectedAtMs,
      disconnectDeadlineAtMs: session.connectionPolicy.deadlineAtMs,
      savedAtMs: this.clock.nowMs()
    });
    session.latestCheckpointTick = checkpoint.state.tick;
    await this.refreshRoute(session);
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

  private async finalize(
    sessionId: string,
    session: ManagedBattleSession,
    outcome: MissionOutcome
  ): Promise<void> {
    if (session.finalizationStarted || session.finalized) return;
    session.finalizationStarted = true;
    try {
      await this.persistCheckpoint(session);
      const finalCheckpoint = session.simulation.createCheckpoint();
      const inputs = await this.infrastructure.inputJournal.readAfter(sessionId, session.userId, 0);
      const replay = await this.infrastructure.replayStorage.store({
        kind: "pve",
        simulationConfig: session.simulation.config,
        finalCheckpoint,
        inputs,
        outcome,
        completedAtMs: this.clock.nowMs()
      });
      const result = await this.finalizer.finalizeOnce({
        idempotencyKey: `battle:${session.simulation.config.attemptId}`,
        sessionId,
        attemptId: session.simulation.config.attemptId,
        userId: session.userId,
        mode: session.simulation.config.mode,
        simulationConfig: session.simulation.config,
        finalCheckpoint,
        replay,
        outcome
      });
      session.finalized = { result, outcome };
      if (session.connection) {
        await session.connection.send(this.endedMessage(result, outcome));
        session.connection.close(1000, "battle completed");
      }
      await Promise.all([
        this.checkpoints.delete(sessionId),
        this.infrastructure.inputJournal.delete(sessionId),
        this.infrastructure.definitions.delete(sessionId),
        this.infrastructure.router.release(sessionId, this.infrastructure.routeLease)
      ]);
      this.sessions.delete(sessionId);
      this.logger.info("Battle finalized", {
        sessionId,
        attemptId: session.simulation.config.attemptId,
        outcome: outcome.outcome
      });
    } catch (error) {
      session.finalizationStarted = false;
      this.logger.error("Battle finalization failed", {
        sessionId,
        attemptId: session.simulation.config.attemptId,
        errorName: error instanceof Error ? error.name : "UnknownError"
      });
    }
  }

  private newSession(
    userId: string,
    simulation: MissionSimulation,
    connectionPolicy: ConnectionPolicyState,
    latestCheckpointTick: number
  ): ManagedBattleSession {
    return {
      userId,
      simulation,
      connection: null,
      connectionPolicy,
      latestCheckpointTick,
      lastLeaseRefreshAtMs: this.clock.nowMs(),
      leaseOwned: true,
      finalizationStarted: false,
      finalized: null,
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

function toProtocolSnapshot(snapshot: SimulationSnapshot): BattleSnapshot {
  return {
    sessionId: snapshot.sessionId,
    tick: snapshot.tick,
    stateHash: snapshot.stateHash,
    lastProcessedInputSequence: snapshot.lastProcessedInputSequence,
    status: snapshot.status,
    objective: snapshot.objective,
    entities: snapshot.entities
  };
}
