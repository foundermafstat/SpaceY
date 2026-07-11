export const TELEGRAM_BOT_CONFIG = Symbol("spacey.telegram-bot-config");

export type TelegramBotConfig = Readonly<{
  host: string;
  port: number;
  webhookSecret: string;
  botToken: string;
  databaseUrl: string;
  databasePoolSize: number;
  apiBaseUrl: string;
  miniAppUrl: string;
  requestTimeoutMs: number;
  processingLeaseSeconds: number;
  starsEnabled: false;
}>;

function integerInRange(value: string | undefined, fallback: number, name: string, min: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} is invalid`);
  return parsed;
}

function parseUrl(value: string, name: string, protocols: readonly string[]): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} is invalid`);
  }
  if (!protocols.includes(parsed.protocol)) throw new Error(`${name} uses an unsupported protocol`);
  return parsed;
}

export function loadTelegramBotConfig(env: NodeJS.ProcessEnv = process.env): TelegramBotConfig {
  const production = env.NODE_ENV === "production";
  const port = integerInRange(env.TELEGRAM_BOT_PORT, 3103, "TELEGRAM_BOT_PORT", 1, 65_535);
  const databasePoolSize = integerInRange(env.TELEGRAM_DB_POOL_SIZE, 5, "TELEGRAM_DB_POOL_SIZE", 1, 20);
  const requestTimeoutMs = integerInRange(env.TELEGRAM_REQUEST_TIMEOUT_MS, 5_000, "TELEGRAM_REQUEST_TIMEOUT_MS", 500, 15_000);
  const processingLeaseSeconds = integerInRange(env.TELEGRAM_PROCESSING_LEASE_SECONDS, 120, "TELEGRAM_PROCESSING_LEASE_SECONDS", 30, 600);

  const webhookSecret = env.TELEGRAM_WEBHOOK_SECRET ?? "";
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(webhookSecret)) {
    throw new Error("TELEGRAM_WEBHOOK_SECRET must be a strong Telegram-compatible secret");
  }

  const botToken = env.TELEGRAM_BOT_TOKEN ?? "";
  if (!/^\d{6,16}:[A-Za-z0-9_-]{30,128}$/.test(botToken)) {
    throw new Error("TELEGRAM_BOT_TOKEN is missing or invalid");
  }

  const databaseUrl = production
    ? (env.TELEGRAM_DATABASE_URL ?? "")
    : (env.TELEGRAM_DATABASE_URL ?? env.DATABASE_URL ?? "");
  const parsedDatabaseUrl = parseUrl(databaseUrl, "TELEGRAM_DATABASE_URL", ["postgres:", "postgresql:"]);
  if (production && parsedDatabaseUrl.searchParams.get("sslmode") === "disable") {
    throw new Error("TELEGRAM_DATABASE_URL must not disable TLS in production");
  }

  const apiBaseUrl = (env.TELEGRAM_API_BASE_URL ?? "https://api.telegram.org").replace(/\/+$/, "");
  const parsedApiBaseUrl = parseUrl(apiBaseUrl, "TELEGRAM_API_BASE_URL", production ? ["https:"] : ["http:", "https:"]);
  if (production && parsedApiBaseUrl.origin !== "https://api.telegram.org") {
    throw new Error("TELEGRAM_API_BASE_URL must use the official Telegram API in production");
  }

  const miniAppUrl = env.SPACEY_MINI_APP_URL ?? "";
  const parsedMiniAppUrl = parseUrl(miniAppUrl, "SPACEY_MINI_APP_URL", production ? ["https:"] : ["http:", "https:"]);
  if (parsedMiniAppUrl.username || parsedMiniAppUrl.password) throw new Error("SPACEY_MINI_APP_URL must not contain credentials");

  if (env.TELEGRAM_STARS_ENABLED === "true") {
    throw new Error("Telegram Stars cannot be enabled before the payment processor is implemented");
  }

  return {
    host: env.TELEGRAM_BOT_HOST ?? "127.0.0.1",
    port,
    webhookSecret,
    botToken,
    databaseUrl,
    databasePoolSize,
    apiBaseUrl,
    miniAppUrl,
    requestTimeoutMs,
    processingLeaseSeconds,
    starsEnabled: false,
  };
}
