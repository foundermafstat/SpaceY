import type { BattleWorkerLogger } from "./ports.js";

export class JsonBattleWorkerLogger implements BattleWorkerLogger {
  info(message: string, context: Record<string, unknown> = {}): void {
    this.write("info", message, context);
  }

  warn(message: string, context: Record<string, unknown> = {}): void {
    this.write("warn", message, context);
  }

  error(message: string, context: Record<string, unknown> = {}): void {
    this.write("error", message, context);
  }

  private write(level: "info" | "warn" | "error", message: string, context: Record<string, unknown>): void {
    const record = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service: "spacey-battle-worker",
      message,
      ...context
    });
    if (level === "error") console.error(record);
    else if (level === "warn") console.warn(record);
    else console.log(record);
  }
}

export const systemClock = {
  nowMs: () => Date.now()
};
