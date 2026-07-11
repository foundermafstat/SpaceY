import { SIMULATION_TICK_RATE } from "@spacey/simulation";

import type { BattleSessionRuntime, BattleWorkerClock, BattleWorkerLogger } from "./ports.js";

const LOOP_INTERVAL_MS = 10;
const MAX_CATCH_UP_TICKS = 5;

export class FixedTickLoop {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastPumpAtMs = 0;
  private accumulatorMs = 0;
  private pumping = false;

  constructor(
    private readonly sessions: BattleSessionRuntime,
    private readonly clock: BattleWorkerClock,
    private readonly logger: BattleWorkerLogger
  ) {}

  start(): void {
    if (this.timer) return;
    this.lastPumpAtMs = this.clock.nowMs();
    this.timer = setInterval(() => void this.pump(), LOOP_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      const nowMs = this.clock.nowMs();
      const elapsedMs = Math.max(0, Math.min(250, nowMs - this.lastPumpAtMs));
      this.lastPumpAtMs = nowMs;
      this.accumulatorMs += elapsedMs;
      const fixedStepMs = 1_000 / SIMULATION_TICK_RATE;
      const ticks = Math.min(MAX_CATCH_UP_TICKS, Math.floor(this.accumulatorMs / fixedStepMs));
      for (let index = 0; index < ticks; index += 1) {
        await this.sessions.advanceOneTick(nowMs);
        this.accumulatorMs -= fixedStepMs;
      }
      if (ticks === MAX_CATCH_UP_TICKS && this.accumulatorMs >= fixedStepMs) {
        this.logger.warn("Battle worker tick loop is behind", {
          backlogMs: Math.round(this.accumulatorMs)
        });
      }
    } catch (error) {
      this.logger.error("Battle worker tick pump failed", {
        errorName: error instanceof Error ? error.name : "UnknownError"
      });
    } finally {
      this.pumping = false;
    }
  }
}
