import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import "reflect-metadata";
import { AppModule } from "./app.module.js";
import { ApiExceptionFilter } from "./common/api-exception.filter.js";
import { env } from "./config/env.js";

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
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
    keyGenerator: (request) => request.ip
  });
  app.enableCors({
    origin: env.corsOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "X-API-Key", "X-Request-ID"]
  });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("SpaceY Player and Public API")
      .setVersion("1.0.0")
      .addBearerAuth(undefined, "playerAccess")
      .addApiKey({ type: "apiKey", in: "header", name: "X-API-Key" }, "publicApiKey")
      .build()
  );
  document.openapi = "3.1.1";
  adapter.getInstance().get("/openapi.json", async (_request, reply) => reply.send(document));

  await app.listen({ host: env.API_HOST, port: env.API_PORT });
}

bootstrap().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({ level: "fatal", service: "spacey-api", error: String(error) })}\n`);
  process.exitCode = 1;
});
