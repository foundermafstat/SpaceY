import { Module } from "@nestjs/common";
import { AuthController } from "./auth/auth.controller.js";
import { AuthService } from "./auth/auth.service.js";
import { CookieOriginGuard } from "./auth/cookie-origin.guard.js";
import { PlayerAccessGuard } from "./auth/player-access.guard.js";
import { PlayerTokenService } from "./auth/player-token.service.js";
import { TelegramInitDataVerifier } from "./auth/telegram-init-data.verifier.js";
import { BattleTicketStore } from "./battle/battle-ticket.store.js";
import { env } from "./config/env.js";
import { GameController } from "./game/game.controller.js";
import { GameService } from "./game/game.service.js";
import { HealthController } from "./health/health.controller.js";
import { MemoryPlatformRepository } from "./platform/memory-platform.repository.js";
import { PLATFORM_REPOSITORY } from "./platform/platform.repository.js";
import { PrismaPlatformRepository } from "./platform/prisma-platform.repository.js";
import { PublicApiGuard } from "./public/public-api.guard.js";
import { DeveloperApiController } from "./public/developer-api.controller.js";
import { DeveloperApiService } from "./public/developer-api.service.js";
import { PublicAuthController } from "./public/public-auth.controller.js";
import { PublicQuotaService } from "./public/public-quota.service.js";
import { PublicTokenService } from "./public/public-token.service.js";
import { PublicController } from "./public/public.controller.js";
import { MatchmakingController } from "./matchmaking/matchmaking.controller.js";
import { MatchmakingQueueStore } from "./matchmaking/matchmaking-queue.store.js";
import {
  MATCHMAKING_RUNTIME_CONFIG,
  MatchmakingService,
  type MatchmakingRuntimeConfig,
} from "./matchmaking/matchmaking.service.js";
import { PVP_DUEL_PROTOCOL_READY } from "@spacey/protocol";
import { PrivacyController } from "./privacy/privacy.controller.js";
import {
  PRIVACY_EXPORT_DOWNLOAD_SIGNER,
  S3PrivacyExportDownloadSigner,
  UnconfiguredPrivacyExportDownloadSigner,
} from "./privacy/privacy-export-download.js";
import { PrivacyService } from "./privacy/privacy.service.js";
import { ResultsController } from "./results/results.controller.js";
import { ResultsService } from "./results/results.service.js";

@Module({
  controllers: [AuthController, DeveloperApiController, GameController, HealthController, MatchmakingController, PrivacyController, PublicAuthController, PublicController, ResultsController],
  providers: [
    {
      provide: PLATFORM_REPOSITORY,
      useClass: env.USE_IN_MEMORY_REPOSITORY ? MemoryPlatformRepository : PrismaPlatformRepository
    },
    AuthService,
    BattleTicketStore,
    {
      provide: MatchmakingQueueStore,
      useFactory: () => new MatchmakingQueueStore({
        useMemory: env.USE_IN_MEMORY_REPOSITORY,
        valkeyUrl: env.VALKEY_URL,
        claimLeaseMs: env.PVP_MATCH_CLAIM_LEASE_SECONDS * 1_000,
      }),
    },
    {
      provide: MATCHMAKING_RUNTIME_CONFIG,
      useValue: {
        enabled: env.PVP_MATCHMAKING_ENABLED,
        duelRuntimeReady: PVP_DUEL_PROTOCOL_READY,
      } satisfies MatchmakingRuntimeConfig,
    },
    CookieOriginGuard,
    DeveloperApiService,
    GameService,
    MatchmakingService,
    PlayerAccessGuard,
    PlayerTokenService,
    {
      provide: PRIVACY_EXPORT_DOWNLOAD_SIGNER,
      useFactory: () => env.PRIVACY_EXPORT_S3_ENDPOINT
        && env.PRIVACY_EXPORT_S3_BUCKET
        && env.PRIVACY_EXPORT_S3_ACCESS_KEY_ID
        && env.PRIVACY_EXPORT_S3_SECRET_ACCESS_KEY
        ? new S3PrivacyExportDownloadSigner({
            endpoint: env.PRIVACY_EXPORT_S3_ENDPOINT,
            region: env.PRIVACY_EXPORT_S3_REGION,
            bucket: env.PRIVACY_EXPORT_S3_BUCKET,
            accessKeyId: env.PRIVACY_EXPORT_S3_ACCESS_KEY_ID,
            secretAccessKey: env.PRIVACY_EXPORT_S3_SECRET_ACCESS_KEY,
            forcePathStyle: env.PRIVACY_EXPORT_S3_FORCE_PATH_STYLE,
            ttlSeconds: env.PRIVACY_EXPORT_DOWNLOAD_URL_TTL_SECONDS,
          })
        : new UnconfiguredPrivacyExportDownloadSigner(env.productionLike),
    },
    PrivacyService,
    ResultsService,
    PublicApiGuard,
    PublicQuotaService,
    PublicTokenService,
    TelegramInitDataVerifier
  ]
})
export class AppModule {}
