import { HttpException, Injectable, OnModuleDestroy, ServiceUnavailableException } from "@nestjs/common";
import { createHmac, createHash } from "node:crypto";
import { Redis } from "ioredis";
import type { AdminApiConfig } from "../config.js";

export const ADMIN_AUTH_RATE_LIMITER = Symbol("spacey.admin-auth-rate-limiter");

export interface AdminAuthRateLimiter {
  consume(ipAddress: string, discriminator: string): Promise<void>;
  probe(): Promise<boolean>;
  close(): Promise<void>;
}

export interface AdminRateLimitRedisClient {
  status: string;
  connect(): Promise<unknown>;
  eval(script: string, keyCount: number, ...args: string[]): Promise<unknown>;
  ping(): Promise<string>;
  disconnect(reconnect?: boolean): void;
}

const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
local ttl = redis.call('PTTL', KEYS[1])
if count > tonumber(ARGV[1]) then return {0, ttl} end
return {1, ttl}
`;

export class UnavailableAdminAuthRateLimiter implements AdminAuthRateLimiter {
  async consume(): Promise<never> {
    throw new ServiceUnavailableException("Distributed admin authentication rate limiter is unavailable");
  }

  async probe(): Promise<boolean> { return false; }
  async close(): Promise<void> {}
}

@Injectable()
export class ValkeyAdminAuthRateLimiter implements AdminAuthRateLimiter, OnModuleDestroy {
  private readonly redis: AdminRateLimitRedisClient;

  constructor(
    private readonly maxAttempts: number,
    private readonly windowSeconds: number,
    private readonly hashKey: Buffer,
    valkeyUrl: string,
    client?: AdminRateLimitRedisClient,
  ) {
    this.redis = client ?? new Redis(valkeyUrl, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 3_000,
      commandTimeout: 3_000,
    });
  }

  async consume(ipAddress: string, discriminator: string): Promise<void> {
    try {
      await this.ensureConnected();
      await this.consumeKey("ip", ipAddress);
      await this.consumeKey("identity", discriminator.toLowerCase());
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException("Distributed admin authentication rate limiter is unavailable");
    }
  }

  async probe(): Promise<boolean> {
    try {
      await this.ensureConnected();
      return await this.redis.ping() === "PONG";
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    this.redis.disconnect(false);
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  private async consumeKey(scope: string, value: string): Promise<void> {
    const digest = createHmac("sha256", this.hashKey).update(`${scope}:${value}`, "utf8").digest("hex");
    const result = await this.redis.eval(
      CONSUME_SCRIPT,
      1,
      `spacey:admin-auth-rate:${scope}:${digest}`,
      String(this.maxAttempts),
      String(this.windowSeconds * 1_000),
    ) as [number, number];
    if (Number(result[0]) !== 1) {
      const retryAfterSeconds = Math.max(1, Math.ceil(Number(result[1]) / 1_000));
      throw new HttpException({ code: "ADMIN_AUTH_RATE_LIMITED", retryAfterSeconds }, 429);
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.redis.status === "wait" || this.redis.status === "end") await this.redis.connect();
    if (this.redis.status !== "ready") throw new Error("Valkey is not ready");
  }
}

export function createAdminAuthRateLimiter(
  config: AdminApiConfig,
  env: NodeJS.ProcessEnv = process.env,
): AdminAuthRateLimiter {
  if (!config.valkeyUrl) return new UnavailableAdminAuthRateLimiter();
  const encoded = env.ADMIN_AUTH_RATE_LIMIT_KEY;
  let key: Buffer;
  if (encoded) {
    key = Buffer.from(encoded, "base64");
    if (key.length !== 32 || key.toString("base64") !== encoded) {
      throw new Error("ADMIN_AUTH_RATE_LIMIT_KEY must be canonical base64 for 32 bytes");
    }
  } else {
    if (env.NODE_ENV === "production") throw new Error("ADMIN_AUTH_RATE_LIMIT_KEY is required in production");
    key = createHash("sha256").update("spacey-admin-development-rate-limit-key", "utf8").digest();
  }
  return new ValkeyAdminAuthRateLimiter(
    config.authRateLimitMax,
    config.authRateLimitWindowSeconds,
    key,
    config.valkeyUrl,
  );
}
