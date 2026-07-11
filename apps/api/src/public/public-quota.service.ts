import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Redis } from "ioredis";
import { ApiError } from "../common/api-error.js";
import { env } from "../config/env.js";

@Injectable()
export class PublicQuotaService implements OnModuleDestroy {
  private readonly redis = env.USE_IN_MEMORY_REPOSITORY
    ? null
    : new Redis(env.VALKEY_URL, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
  private readonly memory = new Map<string, number>();

  async consume(clientId: string, limit: number) {
    const minute = Math.floor(Date.now() / 60_000);
    const key = `spacey:public-quota:${clientId}:${minute}`;
    let count: number;
    if (this.redis) {
      try {
        if (this.redis.status === "wait") await this.redis.connect();
        const result = await this.redis.multi().incr(key).expire(key, 120).exec();
        count = Number(result?.[0]?.[1] ?? limit + 1);
      } catch {
        throw new ApiError("quota_store_unavailable", 503, "Public API quota service is unavailable.");
      }
    } else {
      count = (this.memory.get(key) ?? 0) + 1;
      this.memory.set(key, count);
    }
    if (count > limit) throw new ApiError("quota_exceeded", 429, "Public API quota exceeded.");
  }

  async onModuleDestroy() {
    if (this.redis?.status === "ready") await this.redis.quit();
  }
}
