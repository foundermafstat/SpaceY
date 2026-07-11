import { Controller, Get, Inject } from "@nestjs/common";
import { PLATFORM_REPOSITORY, type PlatformRepository } from "../platform/platform.repository.js";
import { BattleTicketStore } from "../battle/battle-ticket.store.js";
import { MatchmakingQueueStore } from "../matchmaking/matchmaking-queue.store.js";
import { MatchmakingService } from "../matchmaking/matchmaking.service.js";
import {
  PRIVACY_EXPORT_DOWNLOAD_SIGNER,
  type PrivacyExportDownloadSigner,
} from "../privacy/privacy-export-download.js";

@Controller()
export class HealthController {
  constructor(
    @Inject(PLATFORM_REPOSITORY) private readonly repository: PlatformRepository,
    private readonly tickets: BattleTicketStore,
    private readonly matchmakingQueue: MatchmakingQueueStore,
    private readonly matchmaking: MatchmakingService,
    @Inject(PRIVACY_EXPORT_DOWNLOAD_SIGNER) private readonly privacyDownloads: PrivacyExportDownloadSigner,
  ) {}

  @Get("health")
  health() {
    return { ok: true, service: "spacey-api" };
  }

  @Get("ready")
  async ready() {
    await this.repository.ping();
    await this.tickets.ping();
    if (this.matchmaking.capability().matchmakingEnabled) await this.matchmakingQueue.ping();
    await this.privacyDownloads.ping();
    return { ok: true, status: "ready", pvp: this.matchmaking.capability() };
  }
}
