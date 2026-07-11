import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const booleanFromString = z.preprocess(
  (value) => value === true || value === "true",
  z.boolean()
);

const nullableEncryption = z.preprocess(
  (value) => value === "" || value === undefined ? null : value,
  z.enum(["AES256", "aws:kms"]).nullable()
);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  BATTLE_WORKER_HOST: z.string().min(1).default("127.0.0.1"),
  BATTLE_WORKER_PORT: z.coerce.number().int().min(1).max(65535).default(7801),
  BATTLE_WS_PATH: z.string().regex(/^\/[a-zA-Z0-9/_-]*$/).default("/battle"),
  BATTLE_ALLOWED_ORIGINS: z.string().default("http://localhost:3000"),
  BATTLE_WORKER_PUBLIC_URL: z.string().url().default("ws://localhost:7801/battle"),
  BATTLE_WORKER_ID: z.string().min(8).max(128).optional(),
  BATTLE_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(50_000).default(10_000),
  BATTLE_MAX_PAYLOAD_BYTES: z.coerce.number().int().min(1_024).max(1_048_576).default(65_536),
  BATTLE_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(5_000).max(120_000).default(30_000),
  BATTLE_DRAIN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(120_000),
  BATTLE_ROUTE_TTL_SECONDS: z.coerce.number().int().min(6).max(120).default(15),
  BATTLE_STATE_TTL_SECONDS: z.coerce.number().int().min(120).max(86_400).default(300),
  VALKEY_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(8),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1).default("auto"),
  S3_BUCKET: z.string().min(3).max(255),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: booleanFromString.default(true),
  S3_SERVER_SIDE_ENCRYPTION: nullableEncryption.default(null),
  S3_KMS_KEY_ID: z.preprocess((value) => value === "" ? null : value, z.string().min(1).nullable().default(null)),
  REPLAY_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30)
});

export function loadBattleWorkerEnv(source: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.parse(source);
  const productionLike = parsed.NODE_ENV === "production" || parsed.NODE_ENV === "staging";
  const allowedOrigins = parsed.BATTLE_ALLOWED_ORIGINS
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const valkeyProtocol = new URL(parsed.VALKEY_URL).protocol;
  const databaseProtocol = new URL(parsed.DATABASE_URL).protocol;
  const publicProtocol = new URL(parsed.BATTLE_WORKER_PUBLIC_URL).protocol;
  if (valkeyProtocol !== "redis:" && valkeyProtocol !== "rediss:") {
    throw new Error("VALKEY_URL must use redis:// or rediss://.");
  }
  if (databaseProtocol !== "postgres:" && databaseProtocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use PostgreSQL.");
  }
  if (publicProtocol !== "ws:" && publicProtocol !== "wss:") {
    throw new Error("BATTLE_WORKER_PUBLIC_URL must use ws:// or wss://.");
  }
  if (allowedOrigins.length === 0) throw new Error("At least one battle WebSocket origin is required.");
  if (productionLike && publicProtocol !== "wss:") {
    throw new Error("Production battle WebSocket URL must use wss://.");
  }
  if (productionLike) {
    for (const origin of allowedOrigins) {
      const parsedOrigin = new URL(origin);
      if (parsedOrigin.protocol !== "https:" || parsedOrigin.origin !== origin) {
        throw new Error("Production battle origins must be exact HTTPS origins.");
      }
    }
    if (new URL(parsed.S3_ENDPOINT).protocol !== "https:") {
      throw new Error("Production replay storage must use HTTPS.");
    }
    if (!parsed.S3_SERVER_SIDE_ENCRYPTION) {
      throw new Error("Production replay storage encryption is required.");
    }
  }
  if (parsed.S3_SERVER_SIDE_ENCRYPTION === "aws:kms" && !parsed.S3_KMS_KEY_ID) {
    throw new Error("S3_KMS_KEY_ID is required when aws:kms encryption is enabled.");
  }

  return {
    ...parsed,
    productionLike,
    allowedOrigins: new Set(allowedOrigins),
    workerId: parsed.BATTLE_WORKER_ID ?? `${hostname()}-${process.pid}-${randomUUID()}`
  };
}

export type BattleWorkerEnv = ReturnType<typeof loadBattleWorkerEnv>;
