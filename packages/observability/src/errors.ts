import * as Sentry from "@sentry/node";

export function captureException(error: unknown, context: Readonly<Record<string, unknown>> = {}): void {
  if (!process.env.SENTRY_DSN) return;
  Sentry.withScope((scope) => {
    for (const [key, value] of Object.entries(context)) scope.setExtra(key, safeContextValue(value));
    Sentry.captureException(error);
  });
}

function safeContextValue(value: unknown): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 512);
  if (Array.isArray(value)) return value.slice(0, 32).map(safeContextValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .slice(0, 32)
      .map(([key, item]) => [key, safeContextValue(item)]));
  }
  return String(value).slice(0, 512);
}
