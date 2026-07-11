import { Module } from "@nestjs/common";
import {
  DATABASE_READINESS,
  NOTIFICATION_PORT,
  REFERRAL_PORT,
  SUPPORT_PORT,
  TELEGRAM_READINESS,
  TELEGRAM_RESPONDER,
  UPDATE_DEDUPLICATOR,
  type NotificationPort,
  type ReferralPort,
  type SupportPort,
  type TelegramResponder,
} from "./application/ports.js";
import { UpdateRouter } from "./application/update-router.js";
import { BotController } from "./bot.controller.js";
import { TELEGRAM_BOT_CONFIG, loadTelegramBotConfig, type TelegramBotConfig } from "./config.js";
import { TelegramHttpTransport } from "./infrastructure/telegram-http-transport.js";
import { TelegramPostgresAdapter } from "./infrastructure/postgres-adapter.js";

@Module({
  controllers: [BotController],
  providers: [
    { provide: TELEGRAM_BOT_CONFIG, useFactory: loadTelegramBotConfig },
    {
      provide: TelegramPostgresAdapter,
      useFactory: (config: TelegramBotConfig) => TelegramPostgresAdapter.create(config),
      inject: [TELEGRAM_BOT_CONFIG],
    },
    {
      provide: TelegramHttpTransport,
      useFactory: (config: TelegramBotConfig) => new TelegramHttpTransport(config),
      inject: [TELEGRAM_BOT_CONFIG],
    },
    { provide: UPDATE_DEDUPLICATOR, useExisting: TelegramPostgresAdapter },
    { provide: REFERRAL_PORT, useExisting: TelegramPostgresAdapter },
    { provide: SUPPORT_PORT, useExisting: TelegramPostgresAdapter },
    { provide: NOTIFICATION_PORT, useExisting: TelegramPostgresAdapter },
    { provide: DATABASE_READINESS, useExisting: TelegramPostgresAdapter },
    { provide: TELEGRAM_RESPONDER, useExisting: TelegramHttpTransport },
    { provide: TELEGRAM_READINESS, useExisting: TelegramHttpTransport },
    {
      provide: UpdateRouter,
      useFactory: (
        referrals: ReferralPort,
        support: SupportPort,
        notifications: NotificationPort,
        responder: TelegramResponder,
        config: TelegramBotConfig,
      ) => new UpdateRouter({
        referrals,
        support,
        notifications,
        responder,
        starsEnabled: config.starsEnabled,
      }),
      inject: [REFERRAL_PORT, SUPPORT_PORT, NOTIFICATION_PORT, TELEGRAM_RESPONDER, TELEGRAM_BOT_CONFIG],
    },
  ],
})
export class AppModule {}
