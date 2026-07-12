import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Redis } from "ioredis";
import "reflect-metadata";
import { AppModule } from "./app.module.js";
import { ApiExceptionFilter } from "./common/api-exception.filter.js";
import { env } from "./config/env.js";
import { loadCanonicalOpenApi } from "./openapi/canonical-openapi.js";

async function bootstrap() {
  const adapter = new FastifyAdapter({
    trustProxy: env.productionLike,
    logger: { level: env.NODE_ENV === "development" ? "debug" : "info" },
    genReqId: (request: IncomingMessage) => {
      const supplied = request.headers["x-request-id"];
      return typeof supplied === "string" && /^[a-zA-Z0-9._:-]{8,128}$/.test(supplied) ? supplied : randomUUID();
    }
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true
  });
  await app.register(cookie);
  await app.register(formbody);
  await app.register(helmet, { contentSecurityPolicy: false });
  const rateLimitRedis = env.USE_IN_MEMORY_REPOSITORY
    ? undefined
    : new Redis(env.VALKEY_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
  if (rateLimitRedis) {
    const pong = await rateLimitRedis.ping();
    if (pong !== "PONG") throw new Error("Distributed rate-limit Valkey is unavailable.");
    adapter.getInstance().addHook("onClose", async () => {
      if (rateLimitRedis.status === "ready") await rateLimitRedis.quit();
    });
  }
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
    keyGenerator: (request) => request.ip,
    redis: rateLimitRedis,
  });
  app.enableCors({
    origin: env.corsOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "X-API-Key", "X-Request-ID"]
  });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();

  const canonicalOpenApi = loadCanonicalOpenApi();
  adapter.getInstance().get("/openapi.json", async (request, reply) => {
    reply
      .header("Cache-Control", "public, max-age=300")
      .header("ETag", canonicalOpenApi.etag)
      .header("X-Content-Type-Options", "nosniff")
      .header("X-SpaceY-OpenAPI-Source-SHA256", canonicalOpenApi.sourceSha256);
    if (request.headers["if-none-match"] === canonicalOpenApi.etag) return reply.code(304).send();
    return reply.type("application/json; charset=utf-8").send(canonicalOpenApi.document);
  });

  await app.listen({ host: env.API_HOST, port: env.API_PORT });
}

bootstrap().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({ level: "fatal", service: "spacey-api", error: String(error) })}\n`);
  process.exitCode = 1;
});
