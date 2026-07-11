import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { captureException } from "@spacey/observability";
import "reflect-metadata";
import { AppModule } from "./app.module.js";
import { loadTelegramBotConfig } from "./config.js";

async function bootstrap() {
  const config = loadTelegramBotConfig();
  const adapter = new FastifyAdapter({ trustProxy: true });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, { bufferLogs: true });
  adapter.getInstance().addHook("onError", (request, _reply, error, done) => {
    if (!error.statusCode || error.statusCode >= 500) {
      captureException(error, { service: "telegram-bot", requestId: request.id, method: request.method });
    }
    done();
  });
  app.enableShutdownHooks();
  await app.listen(config.port, config.host);
}

void bootstrap();
