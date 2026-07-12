import { z } from "zod";
import { PVP_DUEL_PROTOCOL_READY } from "@spacey/protocol";

const booleanFromString = z.preprocess(
  (value) => value === true || value === "true",
  z.boolean()
);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  SPACEY_ENVIRONMENT: z.enum(["development", "test", "loadtest", "preprod", "staging", "production"]).optional(),
  API_PORT: z.coerce.number().int().positive().default(7800),
  API_HOST: z.string().default("127.0.0.1"),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1).optional(),
  VALKEY_URL: z.string().min(1).default("redis://localhost:6379"),
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  TELEGRAM_AUTH_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(300),
  TELEGRAM_AUTH_FUTURE_SKEW_SECONDS: z.coerce.number().int().nonnegative().default(30),
  PLAYER_ACCESS_TOKEN_SECRET: z.string().min(32).optional(),
  REFRESH_TOKEN_PEPPER: z.string().min(32).optional(),
  PUBLIC_API_KEY_PEPPER: z.string().min(32).optional(),
  PUBLIC_OAUTH_TOKEN_SECRET: z.string().min(32).optional(),
  PLAYER_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  PLAYER_REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  PLAYER_MAX_ACTIVE_SESSIONS: z.coerce.number().int().positive().default(5),
  BATTLE_WS_PUBLIC_URL: z.string().url().optional(),
  ALLOW_BROWSER_AUTH: booleanFromString.default(false),
  USE_IN_MEMORY_REPOSITORY: booleanFromString.default(false),
  PUBLIC_API_DEV_KEY: z.string().min(16).optional(),
  PUBLIC_OAUTH_DEV_CLIENT_ID: z.string().min(1).optional(),
  PUBLIC_OAUTH_DEV_CLIENT_SECRET: z.string().min(16).optional(),
  PVP_MATCHMAKING_ENABLED: booleanFromString.default(false),
  PVP_MATCH_CLAIM_LEASE_SECONDS: z.coerce.number().int().min(5).max(60).default(15),
  PRIVACY_EXPORT_S3_ENDPOINT: z.string().url().optional(),
  PRIVACY_EXPORT_S3_REGION: z.string().min(1).default("eu-west-1"),
  PRIVACY_EXPORT_S3_BUCKET: z.string().min(1).optional(),
  PRIVACY_EXPORT_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  PRIVACY_EXPORT_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  PRIVACY_EXPORT_S3_FORCE_PATH_STYLE: booleanFromString.default(false),
  PRIVACY_EXPORT_DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(300).default(60)
});

const parsed = schema.parse(process.env);
const deploymentEnvironment = parsed.SPACEY_ENVIRONMENT ?? parsed.NODE_ENV;
const productionLike = parsed.NODE_ENV === "production"
  || parsed.NODE_ENV === "staging"
  || deploymentEnvironment === "production"
  || deploymentEnvironment === "staging"
  || deploymentEnvironment === "preprod";
const battleWsPublicUrl = parsed.BATTLE_WS_PUBLIC_URL
  ?? (productionLike ? undefined : "ws://localhost:7801/battle");
const privacyDownloadValues = [
  parsed.PRIVACY_EXPORT_S3_ENDPOINT,
  parsed.PRIVACY_EXPORT_S3_BUCKET,
  parsed.PRIVACY_EXPORT_S3_ACCESS_KEY_ID,
  parsed.PRIVACY_EXPORT_S3_SECRET_ACCESS_KEY
];
const configuredPrivacyDownloadValues = privacyDownloadValues.filter(Boolean).length;
if (configuredPrivacyDownloadValues !== 0 && configuredPrivacyDownloadValues !== privacyDownloadValues.length) {
  throw new Error("Privacy export S3 download configuration is incomplete.");
}

if (productionLike) {
  const missing = [
    ["DATABASE_URL", parsed.DATABASE_URL],
    ["TELEGRAM_BOT_TOKEN", parsed.TELEGRAM_BOT_TOKEN],
    ["PLAYER_ACCESS_TOKEN_SECRET", parsed.PLAYER_ACCESS_TOKEN_SECRET],
    ["REFRESH_TOKEN_PEPPER", parsed.REFRESH_TOKEN_PEPPER],
    ["PUBLIC_API_KEY_PEPPER", parsed.PUBLIC_API_KEY_PEPPER],
    ["PUBLIC_OAUTH_TOKEN_SECRET", parsed.PUBLIC_OAUTH_TOKEN_SECRET],
    ["BATTLE_WS_PUBLIC_URL", battleWsPublicUrl],
    ["PRIVACY_EXPORT_S3_ENDPOINT", parsed.PRIVACY_EXPORT_S3_ENDPOINT],
    ["PRIVACY_EXPORT_S3_BUCKET", parsed.PRIVACY_EXPORT_S3_BUCKET],
    ["PRIVACY_EXPORT_S3_ACCESS_KEY_ID", parsed.PRIVACY_EXPORT_S3_ACCESS_KEY_ID],
    ["PRIVACY_EXPORT_S3_SECRET_ACCESS_KEY", parsed.PRIVACY_EXPORT_S3_SECRET_ACCESS_KEY]
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`Missing production configuration: ${missing.join(", ")}`);
  if (parsed.USE_IN_MEMORY_REPOSITORY) throw new Error("In-memory repository is forbidden outside development/test.");
  if (parsed.ALLOW_BROWSER_AUTH) throw new Error("Browser auth bypass is forbidden outside development/test.");
  if (parsed.PVP_MATCHMAKING_ENABLED && !PVP_DUEL_PROTOCOL_READY) {
    throw new Error("PvP matchmaking cannot be enabled until the multi-connection duel protocol is implemented.");
  }
  const battleWsUrl = new URL(battleWsPublicUrl!);
  if (battleWsUrl.protocol !== "wss:") {
    throw new Error("BATTLE_WS_PUBLIC_URL must use WSS outside development/test.");
  }
  if (battleWsUrl.pathname !== "/realtime/v1/battle" || battleWsUrl.search || battleWsUrl.hash
    || battleWsUrl.username || battleWsUrl.password) {
    throw new Error("BATTLE_WS_PUBLIC_URL must use the canonical credential-free /realtime/v1/battle endpoint.");
  }
  const expectedBattleHost = deploymentEnvironment === "production"
    ? "spacey.aima.space"
    : "staging.spacey.aima.space";
  if (battleWsUrl.hostname !== expectedBattleHost) {
    throw new Error(`BATTLE_WS_PUBLIC_URL must use ${expectedBattleHost} for ${deploymentEnvironment}.`);
  }
  if (new URL(parsed.PRIVACY_EXPORT_S3_ENDPOINT!).protocol !== "https:") {
    throw new Error("Privacy export S3 endpoint must use HTTPS outside development/test.");
  }
}

export const env = {
  ...parsed,
  BATTLE_WS_PUBLIC_URL: battleWsPublicUrl!,
  deploymentEnvironment,
  productionLike,
  corsOrigins: parsed.CORS_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean)
};
