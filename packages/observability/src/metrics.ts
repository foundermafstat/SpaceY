import { api } from "@opentelemetry/sdk-node";

export type BattleMetricMode = "pve" | "pvp";
export type InputRejectReason = "rate_limited" | "journal_unavailable" | "queue_overflow" | "match_not_started" | "invalid" | "buffer_full";
export type FinalizationStage = "database" | "replay" | "cleanup";
export type NoShowOutcome = "forfeit" | "no_contest";
export type LedgerConflictCode = "23505" | "40001" | "40P01" | "55P03";

type ActiveSession = Readonly<{ mode: BattleMetricMode }>;
type CheckpointObservation = Readonly<{ mode: BattleMetricMode; savedAtMs: number }>;

/**
 * Low-cardinality application metrics for the authoritative battle runtime.
 * IDs are used only for local de-duplication and are never exported as attributes.
 */
export class BattleWorkerMetrics {
  private readonly activeConnections: api.UpDownCounter;
  private readonly activeSessions: api.UpDownCounter;
  private readonly activeDuels: api.UpDownCounter;
  private readonly tickLag: api.Histogram;
  private readonly inputCommands: api.Counter;
  private readonly inputRejected: api.Counter;
  private readonly snapshotsDropped: api.Counter;
  private readonly reconnects: api.Counter;
  private readonly noShows: api.Counter;
  private readonly finalizationDuration: api.Histogram;
  private readonly finalizationRetries: api.Counter;
  private readonly pendingReplays: api.UpDownCounter;
  private readonly ledgerConflicts: api.Counter;
  private readonly connectionIds = new Set<string>();
  private readonly sessions = new Map<string, ActiveSession>();
  private readonly checkpoints = new Map<string, CheckpointObservation>();
  private readonly replayIds = new Set<string>();

  constructor(
    meter: api.Meter = api.metrics.getMeter("spacey-battle-worker"),
    private readonly nowMs: () => number = Date.now,
  ) {
    this.activeConnections = meter.createUpDownCounter("spacey.battle.ws.connections.active", {
      description: "Accepted battle WebSocket connections currently open.",
      unit: "{connection}",
    });
    this.activeSessions = meter.createUpDownCounter("spacey.battle.sessions.active", {
      description: "Authoritative battle sessions currently resident on this worker.",
      unit: "{session}",
    });
    this.activeDuels = meter.createUpDownCounter("spacey.battle.duels.active", {
      description: "Authoritative PvP duels currently resident on this worker.",
      unit: "{duel}",
    });
    this.tickLag = meter.createHistogram("spacey.battle.tick.lag", {
      description: "Unprocessed fixed-tick accumulator after each worker pump.",
      unit: "ms",
    });
    this.inputCommands = meter.createCounter("spacey.battle.input.commands", {
      description: "Authoritative input commands received from connected players.",
      unit: "{command}",
    });
    this.inputRejected = meter.createCounter("spacey.battle.input.rejected", {
      description: "Input commands rejected before entering authoritative simulation.",
      unit: "{command}",
    });
    this.snapshotsDropped = meter.createCounter("spacey.battle.ws.snapshots.dropped", {
      description: "Stale snapshots replaced while a WebSocket connection is backpressured.",
      unit: "{snapshot}",
    });
    this.reconnects = meter.createCounter("spacey.battle.reconnects", {
      description: "Connections accepted after a participant had previously connected.",
      unit: "{reconnect}",
    });
    this.noShows = meter.createCounter("spacey.battle.no_show", {
      description: "PvP ready deadlines resolved because one or both participants never connected.",
      unit: "{match}",
    });
    this.finalizationDuration = meter.createHistogram("spacey.battle.finalization.duration", {
      description: "Time from authoritative outcome to durable database finalization.",
      unit: "ms",
    });
    this.finalizationRetries = meter.createCounter("spacey.battle.finalization.retries", {
      description: "Durable battle finalization attempts scheduled after a failed stage.",
      unit: "{retry}",
    });
    this.pendingReplays = meter.createUpDownCounter("spacey.battle.replay.pending", {
      description: "Durably finalized battles on this worker whose replay is not yet attached.",
      unit: "{replay}",
    });
    this.ledgerConflicts = meter.createCounter("spacey.economy.ledger.conflicts", {
      description: "Retryable or unique-constraint conflicts while committing wallet ledger state.",
      unit: "{conflict}",
    });
    const checkpointAge = meter.createObservableGauge("spacey.battle.checkpoint.age", {
      description: "Oldest successful checkpoint age among active sessions on this worker.",
      unit: "s",
    });
    checkpointAge.addCallback((result) => {
      const oldestByMode = new Map<BattleMetricMode, number>();
      const nowMs = this.nowMs();
      for (const checkpoint of this.checkpoints.values()) {
        const ageSeconds = Math.max(0, nowMs - checkpoint.savedAtMs) / 1_000;
        oldestByMode.set(checkpoint.mode, Math.max(oldestByMode.get(checkpoint.mode) ?? 0, ageSeconds));
      }
      for (const [mode, ageSeconds] of oldestByMode) result.observe(ageSeconds, { mode });
    });
  }

  websocketOpened(connectionId: string): void {
    if (this.connectionIds.has(connectionId)) return;
    this.connectionIds.add(connectionId);
    this.activeConnections.add(1);
  }

  websocketClosed(connectionId: string): void {
    if (!this.connectionIds.delete(connectionId)) return;
    this.activeConnections.add(-1);
  }

  sessionActivated(sessionId: string, mode: BattleMetricMode): void {
    if (this.sessions.has(sessionId)) return;
    this.sessions.set(sessionId, { mode });
    this.activeSessions.add(1, { mode });
    if (mode === "pvp") this.activeDuels.add(1);
  }

  sessionDeactivated(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    this.checkpoints.delete(sessionId);
    this.activeSessions.add(-1, { mode: session.mode });
    if (session.mode === "pvp") this.activeDuels.add(-1);
  }

  recordTickLag(backlogMs: number): void {
    this.tickLag.record(nonNegative(backlogMs));
  }

  inputReceived(mode: BattleMetricMode): void {
    this.inputCommands.add(1, { mode });
  }

  inputWasRejected(mode: BattleMetricMode, reason: InputRejectReason): void {
    this.inputRejected.add(1, { mode, reason });
  }

  snapshotDropped(): void {
    this.snapshotsDropped.add(1, { reason: "backpressure" });
  }

  checkpointSaved(sessionId: string, mode: BattleMetricMode, savedAtMs: number): void {
    if (!this.sessions.has(sessionId)) return;
    this.checkpoints.set(sessionId, { mode, savedAtMs });
  }

  reconnected(mode: BattleMetricMode): void {
    this.reconnects.add(1, { mode });
  }

  noShow(outcome: NoShowOutcome): void {
    this.noShows.add(1, { outcome });
  }

  finalizationCompleted(mode: BattleMetricMode, durationMs: number): void {
    this.finalizationDuration.record(nonNegative(durationMs), { mode });
  }

  finalizationRetry(mode: BattleMetricMode, stage: FinalizationStage): void {
    this.finalizationRetries.add(1, { mode, stage });
  }

  replayPendingStarted(sessionId: string, mode: BattleMetricMode): void {
    if (this.replayIds.has(sessionId)) return;
    this.replayIds.add(sessionId);
    this.pendingReplays.add(1, { mode });
  }

  replayPendingResolved(sessionId: string, mode: BattleMetricMode): void {
    if (!this.replayIds.delete(sessionId)) return;
    this.pendingReplays.add(-1, { mode });
  }

  ledgerConflict(operation: "mission_reward", code: LedgerConflictCode): void {
    this.ledgerConflicts.add(1, { operation, code });
  }
}

export class JobsMetrics {
  private readonly outboxAge: api.Histogram;

  constructor(
    meter: api.Meter = api.metrics.getMeter("spacey-jobs"),
    private readonly nowMs: () => number = Date.now,
  ) {
    this.outboxAge = meter.createHistogram("spacey.jobs.outbox.event.age", {
      description: "Age of an outbox event when claimed for dispatch.",
      unit: "s",
    });
  }

  outboxEventClaimed(createdAt: Date): void {
    this.outboxAge.record(Math.max(0, this.nowMs() - createdAt.getTime()) / 1_000);
  }
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export const battleWorkerMetrics = new BattleWorkerMetrics();
export const jobsMetrics = new JobsMetrics();
