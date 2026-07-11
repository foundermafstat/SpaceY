import cookie from "@fastify/cookie";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { captureException } from "@spacey/observability";
import "reflect-metadata";
import { AppModule } from "./app.module.js";
import { loadAdminApiConfig } from "./config.js";

async function bootstrap() {
  const config = loadAdminApiConfig();
  const adapter = new FastifyAdapter({ trustProxy: true });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, { bufferLogs: true });
  adapter.getInstance().addHook("onError", (request, _reply, error, done) => {
    if (!error.statusCode || error.statusCode >= 500) {
      captureException(error, { service: "admin-api", requestId: request.id, method: request.method });
    }
    done();
  });
  await app.register(cookie, { hook: "onRequest" });
  app.setGlobalPrefix("internal/admin/v1");
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  app.enableShutdownHooks();
  await app.listen(config.port, config.host);
}

void bootstrap();
