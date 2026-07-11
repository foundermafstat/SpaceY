import { BadRequestException, Body, Controller, Get, Headers, Inject, Post, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { TELEGRAM_BOT_CONFIG, type TelegramBotConfig } from "./config.js";
import { parseTelegramUpdate } from "./domain/telegram-update.js";
import {
  DATABASE_READINESS,
  TELEGRAM_READINESS,
  UPDATE_DEDUPLICATOR,
  type DependencyReadiness,
  type UpdateDeduplicator,
} from "./application/ports.js";
import { UpdateRouter } from "./application/update-router.js";
import { verifyWebhookSecret } from "./security/webhook-secret.js";

@Controller()
export class BotController {
  constructor(
    @Inject(TELEGRAM_BOT_CONFIG) private readonly config: TelegramBotConfig,
    @Inject(UPDATE_DEDUPLICATOR) private readonly deduplicator: UpdateDeduplicator,
    @Inject(DATABASE_READINESS) private readonly databaseReadiness: DependencyReadiness,
    @Inject(TELEGRAM_READINESS) private readonly telegramReadiness: DependencyReadiness,
    private readonly router: UpdateRouter,
  ) {}

  @Get("health")
  health() {
    return { status: "ok", service: "telegram-bot", starsEnabled: this.config.starsEnabled };
  }

  @Get("ready")
  async ready() {
    try {
      await Promise.all([this.databaseReadiness.check(), this.telegramReadiness.check()]);
      return { status: "ready", service: "telegram-bot" };
    } catch {
      throw new ServiceUnavailableException("Telegram bot dependencies are not ready");
    }
  }

  @Post("webhook")
  async webhook(
    @Headers("x-telegram-bot-api-secret-token") webhookSecret: string | undefined,
    @Body() body: unknown,
  ) {
    if (!verifyWebhookSecret(webhookSecret, this.config.webhookSecret)) throw new UnauthorizedException();

    let update;
    try {
      update = parseTelegramUpdate(body);
    } catch {
      throw new BadRequestException("Invalid Telegram update");
    }

    const claim = await this.deduplicator.claim(update.update_id);
    if (claim === "duplicate") {
      return { ok: true, duplicate: true };
    }
    if (claim === "busy") throw new ServiceUnavailableException("Telegram update is already processing");

    try {
      const route = await this.router.route(update);
      await this.deduplicator.complete(update.update_id);
      return { ok: true, route };
    } catch (error) {
      await this.deduplicator.release(update.update_id);
      throw error;
    }
  }
}
