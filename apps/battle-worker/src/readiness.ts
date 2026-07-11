import type { BattleWorkerLogger } from "./ports.js";

export type ReadinessProbe = {
  name: string;
  ping(): Promise<void>;
};

export class BattleWorkerReadiness {
  private draining = false;
  private lastResult: { checkedAtMs: number; ready: boolean } | null = null;
  private inFlight: Promise<boolean> | null = null;

  constructor(
    private readonly probes: ReadinessProbe[],
    private readonly logger: BattleWorkerLogger,
    private readonly timeoutMs = 2_000,
    private readonly cacheMs = 2_000
  ) {}

  beginDrain(): void {
    this.draining = true;
  }

  async check(): Promise<boolean> {
    if (this.draining) return false;
    const nowMs = Date.now();
    if (this.lastResult && nowMs - this.lastResult.checkedAtMs < this.cacheMs) {
      return this.lastResult.ready;
    }
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runChecks();
    try {
      const ready = await this.inFlight;
      this.lastResult = { checkedAtMs: Date.now(), ready };
      return ready;
    } finally {
      this.inFlight = null;
    }
  }

  private async runChecks(): Promise<boolean> {
    const results = await Promise.all(this.probes.map(async (probe) => {
      try {
        await withTimeout(probe.ping(), this.timeoutMs);
        return true;
      } catch (error) {
        this.logger.warn("Battle worker readiness probe failed", {
          dependency: probe.name,
          errorName: error instanceof Error ? error.name : "UnknownError"
        });
        return false;
      }
    }));
    return results.every(Boolean);
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Readiness probe timed out.")), timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
