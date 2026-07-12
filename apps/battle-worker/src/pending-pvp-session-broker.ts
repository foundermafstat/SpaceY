import type {
  BattleSessionDefinitionStore,
  BattleWorkerClock,
  BattleWorkerLogger,
  PendingPvpSessionCursor,
  PendingPvpSessionQueue,
  PendingPvpSessionSource,
} from "./ports.js";
import type { DuelSessionManager } from "./duel-session-manager.js";

export type PendingPvpSessionBrokerOptions = {
  workerId: string;
  pollIntervalMs: number;
  claimLeaseMs: number;
  retryDelayMs: number;
  activeRecheckMs: number;
  reconciliationIntervalMs: number;
  batchSize: number;
};

/**
 * Durable ownership stays in Valkey route leases and PostgreSQL. The timer and
 * reconciliation cursor are only scheduling hints and can be lost on crash.
 */
export class PendingPvpSessionBroker {
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private stopping = false;
  private sourceCursor: PendingPvpSessionCursor | null = null;
  private nextSourceScanAtMs = 0;

  constructor(
    private readonly queue: PendingPvpSessionQueue,
    private readonly definitions: BattleSessionDefinitionStore,
    private readonly source: PendingPvpSessionSource,
    private readonly sessions: DuelSessionManager,
    private readonly clock: BattleWorkerClock,
    private readonly logger: BattleWorkerLogger,
    private readonly options: PendingPvpSessionBrokerOptions,
  ) {}

  start(): void {
    if (this.stopping || this.timer || this.inFlight) return;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.inFlight;
  }

  async pollOnce(): Promise<void> {
    const nowMs = this.clock.nowMs();
    const claimed = await this.queue.claimBatch(
      this.options.workerId,
      nowMs,
      this.options.batchSize,
      this.options.claimLeaseMs,
    );
    for (const sessionId of claimed) await this.materializeClaim(sessionId, nowMs);

    if (nowMs >= this.nextSourceScanAtMs) {
      const page = await this.source.listPendingPvpSessions(this.sourceCursor, this.options.batchSize);
      this.sourceCursor = page.nextCursor;
      if (!this.sourceCursor) this.nextSourceScanAtMs = nowMs + this.options.reconciliationIntervalMs;
      for (const request of page.sessions) {
        try {
          await this.sessions.ensureSession(request);
        } catch (error) {
          this.logger.error("PostgreSQL PvP session reconciliation failed", {
            sessionId: request.simulationConfig.sessionId,
            errorName: error instanceof Error ? error.name : "UnknownError",
          });
        }
      }
    }
  }

  private async materializeClaim(sessionId: string, nowMs: number): Promise<void> {
    try {
      const definition = await this.definitions.load(sessionId);
      if (!definition) {
        await this.queue.complete(sessionId, this.options.workerId);
        return;
      }
      if (definition.kind !== "pvp") {
        await this.queue.complete(sessionId, this.options.workerId);
        this.logger.warn("Pending PvP queue contained a non-PvP definition");
        return;
      }
      const owned = await this.sessions.ensureSession(definition);
      await this.queue.release(
        sessionId,
        this.options.workerId,
        nowMs + (owned ? this.options.activeRecheckMs : this.options.retryDelayMs),
      );
    } catch (error) {
      await this.queue.release(sessionId, this.options.workerId, nowMs + this.options.retryDelayMs);
      this.logger.error("Pending PvP session claim failed", {
        sessionId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.stopping) return;
      this.inFlight = this.pollOnce()
        .catch((error) => {
          this.logger.error("Pending PvP session broker poll failed", {
            errorName: error instanceof Error ? error.name : "UnknownError",
          });
        })
        .finally(() => {
          this.inFlight = null;
          if (!this.stopping) this.schedule(this.options.pollIntervalMs);
        });
    }, delayMs);
    this.timer.unref?.();
  }
}
