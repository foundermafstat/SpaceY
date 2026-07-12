export const INPUT_COMMANDS_PER_SECOND = 30;
export const INPUT_COMMAND_BURST = 45;

export class InputRateLimiter {
  private tokens = INPUT_COMMAND_BURST;
  private lastRefillAtMs: number;

  constructor(nowMs: number) {
    this.lastRefillAtMs = nowMs;
  }

  allow(nowMs: number): boolean {
    const elapsedMs = Math.max(0, nowMs - this.lastRefillAtMs);
    this.lastRefillAtMs = Math.max(this.lastRefillAtMs, nowMs);
    this.tokens = Math.min(
      INPUT_COMMAND_BURST,
      this.tokens + elapsedMs * INPUT_COMMANDS_PER_SECOND / 1_000
    );
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
