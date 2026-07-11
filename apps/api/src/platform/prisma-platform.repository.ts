import { createHash, randomBytes } from "node:crypto";
import { Injectable, OnModuleDestroy } from "@nestjs/common";
import {
  createPrismaClient,
  createUuidV7,
  type Prisma,
  type SpaceYPrismaClient
} from "@spacey/db";
import type {
  ApplyShipBuildCommandsRequestDto,
  BootstrapResponseDto,
  CreatePrivacyRequestDto,
  LegacyBuildImportProposalDto,
  MissionAttemptStatusDto,
  PlayerProfileDto,
  PrivacyPreferencesDto,
  PrivacyRequestDto,
  PublicAggregateStatsDto,
  PublicCatalogDto,
  PublicLeaderboardEntryDto,
  PublicProfileDto,
  ShipBuildDto,
  ShipBuildPartDto,
  UpdatePrivacyPreferencesRequestDto,
  WalletDto
} from "@spacey/contracts";
import { BATTLE_PROTOCOL_VERSION } from "@spacey/protocol";
import { SIMULATION_VERSION, type MissionSimulationConfig } from "@spacey/simulation";
import { ApiError } from "../common/api-error.js";
import { env } from "../config/env.js";
import type {
  MissionAttemptRecord,
  MatchmakingTicketRecord,
  MaterializedPvpMatch,
  PvpConnectionRecord,
  PlatformRepository,
  PublicApiPrincipal,
  RefreshSessionRecord,
  RotateRefreshSessionResult,
  TelegramPlayerIdentity
} from "./platform.repository.js";

type TransactionClient = Prisma.TransactionClient;

@Injectable()
export class PrismaPlatformRepository implements PlatformRepository, OnModuleDestroy {
  private readonly prisma: SpaceYPrismaClient;

  constructor() {
    if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required for the Prisma repository.");
    this.prisma = createPrismaClient(env.DATABASE_URL);
  }

  async ping() {
    await this.prisma.$queryRaw`SELECT 1`;
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }

  async authenticateTelegram(input: {
    initDataHash: string;
    authDate: Date;
    replayExpiresAt: Date;
    identity: TelegramPlayerIdentity;
  }): Promise<PlayerProfileDto> {
    if (await this.prisma.telegramAuthReplay.findUnique({ where: { initDataHash: input.initDataHash }, select: { id: true } })) {
      throw new ApiError("telegram_init_data_replayed", 401, "Telegram authorization payload was already used.");
    }
    const telegramUserId = BigInt(input.identity.telegramUserId);
    const identity = await this.prisma.telegramIdentity.findUnique({
      where: { telegramUserId },
      select: { userId: true }
    });
    if (identity) return this.updateExistingTelegramPlayer(identity.userId, input);

    const userId = createUuidV7();
    try {
      return await this.withUser(userId, async (tx) => {
        const user = await tx.user.create({
          data: {
            id: userId,
            displayName: this.displayName(input.identity),
            locale: input.identity.languageCode ?? "en",
            avatarUrl: input.identity.photoUrl,
            telegramIdentity: {
              create: {
                id: createUuidV7(),
                telegramUserId,
                username: input.identity.username,
                firstName: input.identity.firstName,
                lastName: input.identity.lastName,
                languageCode: input.identity.languageCode,
                isPremium: input.identity.isPremium
              }
            },
            walletBalances: {
              create: ["CREDITS", "SCRAP", "ALLOY", "DATA_SHARDS"].map((currency) => ({
                id: createUuidV7(),
                currency: currency as "CREDITS" | "SCRAP" | "ALLOY" | "DATA_SHARDS"
              }))
            },
            progression: { create: { id: createUuidV7() } }
          }
        });
        await tx.telegramAuthReplay.create({
          data: {
            id: createUuidV7(),
            userId,
            initDataHash: input.initDataHash,
            telegramUserId,
            authDate: input.authDate,
            expiresAt: input.replayExpiresAt
          }
        });
        await this.provisionStarterBuild(tx, userId);
        return this.profileFromRecords(user, input.identity.telegramUserId);
      });
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      if (await this.prisma.telegramAuthReplay.findUnique({ where: { initDataHash: input.initDataHash }, select: { id: true } })) {
        throw new ApiError("telegram_init_data_replayed", 401, "Telegram authorization payload was already used.");
      }
      const winner = await this.prisma.telegramIdentity.findUnique({ where: { telegramUserId }, select: { userId: true } });
      if (!winner) throw error;
      return this.updateExistingTelegramPlayer(winner.userId, input);
    }
  }

  async getProfile(userId: string) {
    return this.withUser(userId, async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        include: { telegramIdentity: true }
      });
      return user?.telegramIdentity
        ? this.profileFromRecords(user, user.telegramIdentity.telegramUserId.toString())
        : null;
    });
  }

  async getPrivacyPreferences(userId: string): Promise<PrivacyPreferencesDto | null> {
    return this.withUser(userId, async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          profilePublic: true,
          analyticsConsentAt: true,
          analyticsConsentUpdatedAt: true,
          updatedAt: true
        }
      });
      return user ? this.mapPrivacyPreferences(user) : null;
    });
  }

  async updatePrivacyPreferences(
    userId: string,
    input: UpdatePrivacyPreferencesRequestDto
  ): Promise<PrivacyPreferencesDto> {
    return this.withUser(userId, async (tx) => {
      const current = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
      if (!current) throw new ApiError("player_not_found", 404, "Player not found.");
      if (current.status !== "ACTIVE") {
        throw new ApiError("player_inactive", 409, "Inactive player privacy preferences cannot be changed.");
      }
      const now = new Date();
      const user = await tx.user.update({
        where: { id: userId },
        data: {
          profilePublic: input.profilePublic,
          analyticsConsentAt: input.analyticsConsent ? now : null,
          analyticsConsentUpdatedAt: now
        },
        select: {
          profilePublic: true,
          analyticsConsentAt: true,
          analyticsConsentUpdatedAt: true,
          updatedAt: true
        }
      });
      return this.mapPrivacyPreferences(user);
    });
  }

  async createPrivacyRequest(userId: string, input: CreatePrivacyRequestDto): Promise<PrivacyRequestDto> {
    const type = input.type === "export" ? "EXPORT" as const : "DELETE" as const;
    const requestHash = createHash("sha256").update(JSON.stringify({ type: input.type })).digest("hex");
    try {
      return await this.withUser(userId, async (tx) => {
        const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
        if (!user) throw new ApiError("player_not_found", 404, "Player not found.");
        if (user.status !== "ACTIVE") {
          throw new ApiError("player_inactive", 409, "Inactive player cannot create a privacy request.");
        }
        const existing = await tx.privacyRequest.findUnique({
          where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } }
        });
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw new ApiError("idempotency_key_reused", 409, "Idempotency key was reused with another privacy request.");
          }
          return this.mapPrivacyRequest(existing);
        }

        const now = new Date();
        const requestId = createUuidV7();
        if (type === "DELETE") {
          await tx.user.update({
            where: { id: userId },
            data: {
              profilePublic: false,
              analyticsConsentAt: null,
              analyticsConsentUpdatedAt: now
            }
          });
          await tx.authSession.updateMany({
            where: { userId, status: { in: ["ACTIVE", "ROTATED"] } },
            data: { status: "REVOKED", revokedAt: now }
          });
        }
        const request = await tx.privacyRequest.create({
          data: {
            id: requestId,
            userId,
            type,
            requestHash,
            idempotencyKey: input.idempotencyKey,
            requestedAt: now,
            retentionUntil: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1_000)
          }
        });
        await tx.outboxEvent.create({
          data: {
            id: createUuidV7(),
            aggregateType: "privacy-request",
            aggregateId: requestId,
            eventType: type === "EXPORT" ? "privacy.export.requested" : "privacy.delete.requested",
            payload: { requestId, userId, requestType: input.type, retentionPolicyVersion: "eu-v1" },
            idempotencyKey: `privacy-request:${requestId}:requested`
          }
        });
        return this.mapPrivacyRequest(request);
      });
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      return this.withUser(userId, async (tx) => {
        const winner = await tx.privacyRequest.findUnique({
          where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } }
        });
        if (!winner || winner.requestHash !== requestHash) {
          throw new ApiError("idempotency_key_reused", 409, "Idempotency key was reused with another privacy request.");
        }
        return this.mapPrivacyRequest(winner);
      });
    }
  }

  async getPrivacyRequest(userId: string, requestId: string): Promise<PrivacyRequestDto | null> {
    return this.withUser(userId, async (tx) => {
      const request = await tx.privacyRequest.findFirst({ where: { id: requestId, userId } });
      return request ? this.mapPrivacyRequest(request) : null;
    });
  }

  async getPrivacyExportDownloadTarget(userId: string, requestId: string) {
    return this.withUser(userId, async (tx) => {
      const request = await tx.privacyRequest.findFirst({
        where: {
          id: requestId,
          userId,
          type: "EXPORT",
          status: "COMPLETED",
          exportExpiresAt: { gt: new Date() },
          exportObjectKey: { not: null }
        },
        select: { exportObjectKey: true, exportObjectVersion: true, exportExpiresAt: true }
      });
      return request?.exportObjectKey && request.exportExpiresAt
        ? {
            objectKey: request.exportObjectKey,
            objectVersion: request.exportObjectVersion,
            artifactExpiresAt: request.exportExpiresAt
          }
        : null;
    });
  }

  async createRefreshSession(input: {
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    ipHash: string | null;
    userAgentHash: string | null;
    maxActiveSessions: number;
  }): Promise<RefreshSessionRecord> {
    return this.prisma.$transaction(async (tx) => {
      const active = await tx.authSession.findMany({
        where: { userId: input.userId, status: "ACTIVE", expiresAt: { gt: new Date() } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true }
      });
      const revokeCount = Math.max(0, active.length - input.maxActiveSessions + 1);
      if (revokeCount) {
        await tx.authSession.updateMany({
          where: { id: { in: active.slice(0, revokeCount).map(({ id }) => id) } },
          data: { status: "REVOKED", revokedAt: new Date() }
        });
      }
      const created = await tx.authSession.create({
        data: {
          id: createUuidV7(),
          userId: input.userId,
          tokenFamily: createUuidV7(),
          refreshTokenHash: input.refreshTokenHash,
          expiresAt: input.expiresAt,
          ipHash: input.ipHash,
          userAgentHash: input.userAgentHash
        }
      });
      return this.refreshSessionRecord(created);
    });
  }

  async rotateRefreshSession(input: {
    currentTokenHash: string;
    nextTokenHash: string;
    nextExpiresAt: Date;
    ipHash: string | null;
    userAgentHash: string | null;
  }): Promise<RotateRefreshSessionResult> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.authSession.findUnique({ where: { refreshTokenHash: input.currentTokenHash } });
      if (!current) return { kind: "invalid" } as const;
      if (current.status === "ROTATED") {
        const now = new Date();
        await tx.authSession.updateMany({
          where: { tokenFamily: current.tokenFamily, status: { not: "REVOKED" } },
          data: { status: "REVOKED", revokedAt: now }
        });
        await tx.authSession.update({ where: { id: current.id }, data: { reuseDetectedAt: now } });
        return { kind: "reuse", userId: current.userId } as const;
      }
      if (current.status !== "ACTIVE" || current.expiresAt <= new Date()) {
        if (current.status === "ACTIVE") {
          await tx.authSession.update({ where: { id: current.id }, data: { status: "EXPIRED" } });
        }
        return { kind: "invalid" } as const;
      }
      const claimed = await tx.authSession.updateMany({
        where: { id: current.id, status: "ACTIVE" },
        data: { status: "ROTATED", lastUsedAt: new Date() }
      });
      if (claimed.count !== 1) return { kind: "invalid" } as const;
      const next = await tx.authSession.create({
        data: {
          id: createUuidV7(),
          userId: current.userId,
          tokenFamily: current.tokenFamily,
          refreshTokenHash: input.nextTokenHash,
          rotatedFromId: current.id,
          expiresAt: input.nextExpiresAt,
          ipHash: input.ipHash,
          userAgentHash: input.userAgentHash
        }
      });
      await tx.authSession.update({ where: { id: current.id }, data: { replacedById: next.id } });
      return { kind: "rotated", session: this.refreshSessionRecord(next) } as const;
    });
  }

  async revokeRefreshSession(tokenHash: string) {
    await this.prisma.authSession.updateMany({
      where: { refreshTokenHash: tokenHash, status: { in: ["ACTIVE", "ROTATED"] } },
      data: { status: "REVOKED", revokedAt: new Date() }
    });
  }

  async revokeAllRefreshSessions(userId: string) {
    await this.prisma.authSession.updateMany({
      where: { userId, status: { in: ["ACTIVE", "ROTATED"] } },
      data: { status: "REVOKED", revokedAt: new Date() }
    });
  }

  async getBootstrap(userId: string): Promise<BootstrapResponseDto> {
    return this.withUser(userId, async (tx) => {
      const [user, release, build, balances, inventory] = await Promise.all([
        tx.user.findUnique({ where: { id: userId }, include: { telegramIdentity: true } }),
        tx.contentRelease.findFirst({
          where: { status: "PUBLISHED" },
          orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
          include: {
            missions: { where: { enabled: true }, orderBy: { key: "asc" }, include: { dropTable: true } },
            moduleDefinitions: { where: { enabled: true } }
          }
        }),
        tx.shipBuild.findFirst({
          where: { userId, status: "ACTIVE" },
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          include: {
            currentRevision: {
              include: { installedItems: { include: { inventoryItem: true }, orderBy: { slotKey: "asc" } } }
            }
          }
        }),
        tx.walletBalance.findMany({ where: { userId } }),
        tx.inventoryItem.findMany({ where: { userId }, include: { contentRelease: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })
      ]);
      if (!user?.telegramIdentity) throw new ApiError("player_not_found", 404, "Player not found.");
      if (!release?.publishedAt) throw new ApiError("content_unavailable", 503, "No published content release is available.");
      return {
        serverTime: new Date().toISOString(),
        profile: this.profileFromRecords(user, user.telegramIdentity.telegramUserId.toString()),
        wallet: this.mapWallet(balances),
        activeBuild: build ? this.mapBuild(build) : null,
        inventory: inventory.map((item) => {
          const definition = release.moduleDefinitions.find((candidate) =>
            candidate.contentReleaseId === item.contentReleaseId && candidate.key === item.definitionKey
          );
          const installedInCurrent = build?.currentRevision?.installedItems.some((installed) => installed.inventoryItemId === item.id)
            ? build.currentRevision.id
            : null;
          const rarity = definition?.rarity === "uncommon" || definition?.rarity === "superRare"
            ? definition.rarity
            : "common";
          const states = {
            AVAILABLE: "available",
            INSTALLED: "installed",
            DAMAGED: "damaged",
            DESTROYED: "destroyed",
            CONSUMED: "destroyed"
          } as const;
          return {
            id: item.id,
            definitionId: item.definitionKey,
            contentVersion: item.contentRelease.version,
            rarity,
            state: states[item.state],
            durability: item.durability,
            installedBuildRevisionId: installedInCurrent,
            createdAt: item.createdAt.toISOString()
          };
        }),
        contentRelease: {
          id: release.id,
          version: release.version,
          publishedAt: release.publishedAt.toISOString()
        },
        missions: release.missions.map((mission) => this.mapMission(mission, release.version))
      };
    });
  }

  async authenticatePublicApiKey(secretHash: string): Promise<PublicApiPrincipal | null> {
    const key = await this.prisma.apiKey.findUnique({
      where: { secretHash },
      include: { apiClient: true }
    });
    if (
      !key || key.revokedAt || (key.expiresAt && key.expiresAt <= new Date()) ||
      key.apiClient.status !== "ACTIVE"
    ) return null;
    await this.prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
    return {
      clientId: key.apiClient.clientId,
      scopes: key.scopes.filter((scope) => key.apiClient.scopes.includes(scope)),
      rateLimitPerMinute: key.apiClient.rateLimitPerMinute
    };
  }

  async authenticatePublicClient(clientId: string, secretHash: string): Promise<PublicApiPrincipal | null> {
    const client = await this.prisma.apiClient.findUnique({ where: { clientId } });
    if (!client || client.status !== "ACTIVE" || client.clientSecretHash !== secretHash) return null;
    return { clientId: client.clientId, scopes: client.scopes, rateLimitPerMinute: client.rateLimitPerMinute };
  }

  async getPublicCatalog(): Promise<PublicCatalogDto> {
    const release = await this.prisma.contentRelease.findFirst({
      where: { status: "PUBLISHED" },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      include: { missions: { where: { enabled: true }, orderBy: { key: "asc" }, include: { dropTable: true } } }
    });
    if (!release?.publishedAt) throw new ApiError("content_unavailable", 503, "No published content release is available.");
    return {
      contentRelease: { id: release.id, version: release.version, publishedAt: release.publishedAt.toISOString() },
      missions: release.missions.map((mission) => this.mapMission(mission, release.version))
    };
  }

  async getPublicLeaderboard(limit: number): Promise<PublicLeaderboardEntryDto[]> {
    const rows = await this.prisma.$queryRaw<Array<{
      rank: bigint;
      public_player_id: string;
      display_name: string;
      score: bigint;
    }>>`
      SELECT rank, user_id::text AS public_player_id, display_name, rating::bigint AS score
      FROM spacey_public_leaderboard(${limit})
    `;
    return rows.map((row) => ({
      rank: this.safeNumber(row.rank),
      publicPlayerId: row.public_player_id,
      displayName: row.display_name,
      score: this.safeNumber(row.score)
    }));
  }

  async getPublicProfile(userId: string): Promise<PublicProfileDto | null> {
    const rows = await this.prisma.$queryRaw<Array<{
      id: string;
      display_name: string;
      avatar_url: string | null;
      joined_at: Date;
      level: number;
      season_rating: number | null;
      wins: number;
      losses: number;
      draws: number;
    }>>`SELECT * FROM spacey_public_profile(${userId}::uuid)`;
    const row = rows[0];
    return row ? {
      id: row.id,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      joinedAt: row.joined_at.toISOString(),
      level: row.level,
      seasonRating: row.season_rating,
      wins: row.wins,
      losses: row.losses,
      draws: row.draws,
    } : null;
  }

  async getPublicAggregateStats(): Promise<PublicAggregateStatsDto> {
    const rows = await this.prisma.$queryRaw<Array<{
      consented_players: bigint;
      completed_battles: bigint;
      completed_pvp_matches: bigint;
      published_content_version: string | null;
    }>>`SELECT * FROM spacey_public_aggregate_stats()`;
    const row = rows[0];
    if (!row) throw new ApiError("public_stats_unavailable", 503, "Public aggregate statistics are unavailable.");
    return {
      generatedAt: new Date().toISOString(),
      consentedPlayers: this.safeNumber(row.consented_players),
      completedBattles: this.safeNumber(row.completed_battles),
      completedPvpMatches: this.safeNumber(row.completed_pvp_matches),
      publishedContentVersion: row.published_content_version,
    };
  }

  private async updateExistingTelegramPlayer(
    userId: string,
    input: {
      initDataHash: string;
      authDate: Date;
      replayExpiresAt: Date;
      identity: TelegramPlayerIdentity;
    }
  ) {
    return this.withUser(userId, async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: {
          displayName: this.displayName(input.identity),
          locale: input.identity.languageCode ?? "en",
          avatarUrl: input.identity.photoUrl,
          telegramIdentity: {
            update: {
              username: input.identity.username,
              firstName: input.identity.firstName,
              lastName: input.identity.lastName,
              languageCode: input.identity.languageCode,
              isPremium: input.identity.isPremium
            }
          }
        }
      });
      await tx.telegramAuthReplay.create({
        data: {
          id: createUuidV7(),
          userId,
          initDataHash: input.initDataHash,
          telegramUserId: BigInt(input.identity.telegramUserId),
          authDate: input.authDate,
          expiresAt: input.replayExpiresAt
        }
      });
      return this.profileFromRecords(user, input.identity.telegramUserId);
    });
  }

  private profileFromRecords(
    user: { id: string; displayName: string | null; avatarUrl: string | null; locale: string; createdAt: Date },
    telegramUserId: string
  ): PlayerProfileDto {
    return {
      id: user.id,
      telegramUserId,
      displayName: user.displayName ?? "Pilot",
      avatarUrl: user.avatarUrl,
      locale: user.locale,
      createdAt: user.createdAt.toISOString()
    };
  }

  private mapPrivacyPreferences(user: {
    profilePublic: boolean;
    analyticsConsentAt: Date | null;
    analyticsConsentUpdatedAt: Date | null;
    updatedAt: Date;
  }): PrivacyPreferencesDto {
    return {
      profilePublic: user.profilePublic,
      analyticsConsent: user.analyticsConsentAt !== null,
      analyticsConsentUpdatedAt: user.analyticsConsentUpdatedAt?.toISOString() ?? null,
      updatedAt: user.updatedAt.toISOString()
    };
  }

  private mapPrivacyRequest(request: {
    id: string;
    type: string;
    status: string;
    requestedAt: Date;
    processingStartedAt: Date | null;
    completedAt: Date | null;
    failedAt: Date | null;
    failureCode: string | null;
    retentionUntil: Date;
    exportContentType: string | null;
    exportContentSha256: string | null;
    exportSizeBytes: bigint | null;
    exportExpiresAt: Date | null;
  }): PrivacyRequestDto {
    const exportArtifact = request.exportContentType === "application/json"
      && request.exportContentSha256
      && request.exportSizeBytes !== null
      && request.exportExpiresAt
      ? {
          state: "stored_encrypted" as const,
          contentType: "application/json" as const,
          contentSha256: request.exportContentSha256,
          sizeBytes: this.safeNumber(request.exportSizeBytes),
          expiresAt: request.exportExpiresAt.toISOString()
        }
      : null;
    return {
      id: request.id,
      type: request.type.toLowerCase() as PrivacyRequestDto["type"],
      status: request.status.toLowerCase() as PrivacyRequestDto["status"],
      requestedAt: request.requestedAt.toISOString(),
      processingStartedAt: request.processingStartedAt?.toISOString() ?? null,
      completedAt: request.completedAt?.toISOString() ?? null,
      failedAt: request.failedAt?.toISOString() ?? null,
      failureCode: request.failureCode,
      retentionUntil: request.retentionUntil.toISOString(),
      exportArtifact
    };
  }

  private mapWallet(rows: Array<{ currency: string; balance: bigint }>): WalletDto {
    const wallet: WalletDto = { credits: 0, scrap: 0, alloy: 0, dataShards: 0 };
    const names = { CREDITS: "credits", SCRAP: "scrap", ALLOY: "alloy", DATA_SHARDS: "dataShards" } as const;
    for (const row of rows) {
      const name = names[row.currency as keyof typeof names];
      if (name) wallet[name] = this.safeNumber(row.balance);
    }
    return wallet;
  }

  private mapBuild(build: {
    id: string;
    name: string;
    updatedAt: Date;
    currentRevision: null | {
      id: string;
      version: number;
      createdAt: Date;
      installedItems: Array<{
        inventoryItemId: string;
        placement: unknown;
        inventoryItem: { definitionKey: string };
      }>;
    };
  }): ShipBuildDto {
    if (!build.currentRevision) throw new ApiError("build_revision_missing", 500, "Active build has no revision.");
    return {
      id: build.id,
      updatedAt: build.updatedAt.toISOString(),
      activeRevision: {
        id: build.currentRevision.id,
        buildId: build.id,
        revision: build.currentRevision.version,
        name: build.name,
        parts: build.currentRevision.installedItems.map((item) => {
          const placement = this.placement(item.placement);
          return {
            inventoryItemId: item.inventoryItemId,
            definitionId: item.inventoryItem.definitionKey,
            ...placement
          };
        }),
        createdAt: build.currentRevision.createdAt.toISOString()
      }
    };
  }

  private mapMission(mission: {
    key: string;
    type: string;
    risk: string;
    title: string;
    description: string;
    objective: unknown;
    rewardDefinition: unknown;
    dropTable: { entries: unknown } | null;
    durationSeconds: number;
  }, contentVersion: string) {
    const objective = this.record(mission.objective);
    const rewards = this.rewardPreview(mission.rewardDefinition, mission.dropTable?.entries);
    const objectiveType = ["destroy_all", "survive_seconds", "collect_scrap", "protect_target", "hold_position"]
      .includes(String(objective.type))
      ? String(objective.type) as "destroy_all" | "survive_seconds" | "collect_scrap" | "protect_target" | "hold_position"
      : "destroy_all";
    return {
      id: mission.key,
      contentVersion,
      name: mission.title,
      type: mission.type.toLowerCase() as "salvage" | "escort" | "mining" | "intercept" | "defense",
      risk: mission.risk.toLowerCase() as "green" | "yellow" | "red",
      briefing: mission.description,
      durationSeconds: mission.durationSeconds,
      objective: {
        type: objectiveType,
        target: this.positiveInteger(objective.target, 1),
        label: typeof objective.label === "string" ? objective.label : mission.title
      },
      rewardPreview: {
        credits: rewards.credits,
        scrap: rewards.scrap,
        alloy: rewards.alloy,
        dataShards: rewards.dataShards
      }
    };
  }

  private mapMatchmakingTicket(ticket: {
    id: string;
    userId: string;
    buildRevisionId: string;
    queue: string;
    region: string;
    mmr: number;
    status: string;
    baseMmrWindow: number;
    expansionPerSecond: number;
    maxMmrWindow: number;
    createdAt: Date;
    expiresAt: Date;
    pvpMatch: null | {
      id: string;
      battleSession: null | { id: string };
      missionAttempts: Array<{ id: string; userId: string }>;
    };
  }, userId: string): MatchmakingTicketRecord {
    const statuses = {
      QUEUED: "queued",
      MATCHED: "matched",
      COMPLETED: "completed",
      CANCELLED: "cancelled",
      EXPIRED: "expired",
      FAILED: "failed",
    } as const;
    const status = statuses[ticket.status as keyof typeof statuses];
    if (!status) throw new ApiError("matchmaking_status_invalid", 500, "Stored matchmaking status is invalid.");
    const attempt = ticket.pvpMatch?.missionAttempts.find((candidate) => candidate.userId === userId);
    const match = ticket.pvpMatch && ticket.pvpMatch.battleSession && attempt
      ? { matchId: ticket.pvpMatch.id, sessionId: ticket.pvpMatch.battleSession.id, attemptId: attempt.id }
      : null;
    if ((status === "matched" || status === "completed") && !match) {
      throw new ApiError("pvp_match_incomplete", 500, "Matched ticket has incomplete battle records.");
    }
    return {
      ticketId: ticket.id,
      userId: ticket.userId,
      buildRevisionId: ticket.buildRevisionId,
      queue: ticket.queue,
      region: ticket.region,
      mmr: ticket.mmr,
      status,
      createdAt: ticket.createdAt,
      expiresAt: ticket.expiresAt,
      policy: {
        baseMmrWindow: ticket.baseMmrWindow,
        expansionPerSecond: ticket.expansionPerSecond,
        maxMmrWindow: ticket.maxMmrWindow,
      },
      match,
    };
  }

  private matchmakingPolicy(rulesValue: unknown, queue: string) {
    const rules = this.record(rulesValue);
    const queues = this.record(rules.matchmakingQueues);
    const policy = this.record(queues[queue]);
    if (!Object.keys(policy).length) throw new ApiError("matchmaking_queue_not_found", 404, "Matchmaking queue not found.");
    const text = (value: unknown, pattern: RegExp, name: string) => {
      if (typeof value !== "string" || !pattern.test(value)) {
        throw new ApiError("pvp_queue_configuration_invalid", 503, `PvP queue ${name} is invalid.`);
      }
      return value;
    };
    const integer = (value: unknown, minimum: number, maximum: number, name: string) => {
      if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
        throw new ApiError("pvp_queue_configuration_invalid", 503, `PvP queue ${name} is invalid.`);
      }
      return Number(value);
    };
    const baseMmrWindow = integer(policy.baseMmrWindow, 0, 5_000, "baseMmrWindow");
    const maxMmrWindow = integer(policy.maxMmrWindow, baseMmrWindow, 10_000, "maxMmrWindow");
    return {
      region: text(policy.region, /^[a-z0-9][a-z0-9_-]{0,31}$/, "region"),
      missionId: text(policy.missionId, /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/, "missionId"),
      baseMmrWindow,
      expansionPerSecond: integer(policy.expansionPerSecond, 0, 100, "expansionPerSecond"),
      maxMmrWindow,
      ticketTtlSeconds: integer(policy.ticketTtlSeconds, 30, 900, "ticketTtlSeconds"),
    };
  }

  private rewardPreview(definition: unknown, dropTableEntries: unknown): WalletDto {
    const source = this.record(definition);
    const currencySource = this.record(source.currencies);
    const preview: WalletDto = {
      credits: this.nonnegativeInteger(currencySource.credits ?? source.credits),
      scrap: this.nonnegativeInteger(currencySource.scrap ?? source.scrap),
      alloy: this.nonnegativeInteger(currencySource.alloy ?? source.alloy),
      dataShards: this.nonnegativeInteger(currencySource.dataShards ?? source.dataShards)
    };
    if (!Array.isArray(dropTableEntries)) return preview;
    const names = { CREDITS: "credits", SCRAP: "scrap", ALLOY: "alloy", DATA_SHARDS: "dataShards" } as const;
    for (const entry of dropTableEntries) {
      const item = this.record(entry);
      if (item.kind !== "currency" || typeof item.currency !== "string") continue;
      const name = names[item.currency as keyof typeof names];
      if (name) preview[name] += this.nonnegativeInteger(item.amount);
    }
    return preview;
  }

  private placement(value: unknown): Pick<ShipBuildPartDto, "gridX" | "gridY" | "rotation"> {
    const placement = this.record(value);
    const rotation = [0, 90, 180, 270].includes(Number(placement.rotation))
      ? Number(placement.rotation) as 0 | 90 | 180 | 270
      : 0;
    return {
      gridX: Number.isInteger(placement.gridX) ? Number(placement.gridX) : 0,
      gridY: Number.isInteger(placement.gridY) ? Number(placement.gridY) : 0,
      rotation
    };
  }

  private record(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private safeNumber(value: bigint) {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw new ApiError("numeric_overflow", 500, "Stored numeric value exceeds API range.");
    return number;
  }

  private nonnegativeInteger(value: unknown) {
    return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
  }

  private positiveInteger(value: unknown, fallback: number) {
    return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback;
  }

  private validatePartPlacements(parts: ShipBuildPartDto[]) {
    const anchors = new Set<string>();
    for (const part of parts) {
      if (![part.gridX, part.gridY].every((coordinate) => Number.isInteger(coordinate) && Math.abs(coordinate) <= 64)) {
        throw new ApiError("build_coordinate_invalid", 422, "Build part coordinate is outside the supported grid.");
      }
      const anchor = `${part.gridX}:${part.gridY}`;
      if (anchors.has(anchor)) throw new ApiError("build_overlap", 422, "Build parts overlap.");
      anchors.add(anchor);
    }
  }

  private validateDefinitionShapes(
    parts: Array<Pick<ShipBuildPartDto, "definitionId" | "gridX" | "gridY" | "rotation">>,
    definitions: Array<{ key: string; shape: unknown }>
  ) {
    const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
    const occupied = new Set<string>();
    for (const part of parts) {
      const definition = byKey.get(part.definitionId);
      if (!definition) throw new ApiError("build_definition_invalid", 422, "Build references an unknown definition.");
      const shape = this.record(definition.shape);
      const cells = Array.isArray(shape.cells) ? shape.cells : [[0, 0]];
      for (const value of cells) {
        if (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isInteger)) {
          throw new ApiError("content_shape_invalid", 503, "Published module shape is invalid.");
        }
        const [sourceX, sourceY] = value as [number, number];
        const [x, y] = part.rotation === 90
          ? [-sourceY, sourceX]
          : part.rotation === 180
            ? [-sourceX, -sourceY]
            : part.rotation === 270
              ? [sourceY, -sourceX]
              : [sourceX, sourceY];
        const coordinate = `${part.gridX + x}:${part.gridY + y}`;
        if (occupied.has(coordinate)) throw new ApiError("build_overlap", 422, "Build parts overlap.");
        occupied.add(coordinate);
      }
    }
  }

  private definitionMetrics(
    parts: Array<Pick<ShipBuildPartDto, "definitionId">>,
    definitions: Array<{ key: string; stats: unknown }>
  ) {
    const stats = new Map(definitions.map((definition) => [definition.key, this.record(definition.stats)]));
    let mass = 0;
    let output = 0;
    let draw = 0;
    for (const part of parts) {
      const values = stats.get(part.definitionId) ?? {};
      mass += this.nonnegativeInteger(values.mass);
      output += this.nonnegativeInteger(values.powerOutput);
      draw += this.nonnegativeInteger(values.powerDraw);
    }
    return { mass, power: Math.max(0, output - draw) };
  }

  private hashJson(value: unknown) {
    return this.hashText(JSON.stringify(this.canonical(value)));
  }

  private hashText(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }

  private canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.canonical(item));
    if (typeof value !== "object" || value === null) return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, this.canonical(item)])
    );
  }

  private refreshSessionRecord(session: {
    id: string;
    userId: string;
    tokenFamily: string;
    refreshTokenHash: string;
    status: string;
    expiresAt: Date;
  }): RefreshSessionRecord {
    return {
      id: session.id,
      userId: session.userId,
      tokenFamily: session.tokenFamily,
      refreshTokenHash: session.refreshTokenHash,
      status: session.status.toLowerCase() as RefreshSessionRecord["status"],
      expiresAt: session.expiresAt
    };
  }

  private displayName(identity: TelegramPlayerIdentity) {
    return [identity.firstName, identity.lastName].filter(Boolean).join(" ");
  }

  private async withUser<T>(userId: string, operation: (tx: TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('spacey.user_id', ${userId}, true)`;
      return operation(tx);
    });
  }

  private isUniqueViolation(error: unknown): error is { code: "P2002" } {
    return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
  }

  private postgresCode(error: unknown, depth = 0): string | null {
    if (depth > 4 || typeof error !== "object" || error === null) return null;
    const record = error as Record<string, unknown>;
    if (typeof record.code === "string" && /^[0-9A-Z]{5}$/.test(record.code) && !/^P2\d{3}$/.test(record.code)) {
      return record.code;
    }
    for (const key of ["meta", "cause", "driverAdapterError", "originalError"]) {
      const nested = this.postgresCode(record[key], depth + 1);
      if (nested) return nested;
    }
    return null;
  }

  private async provisionStarterBuild(tx: TransactionClient, userId: string) {
    const release = await tx.contentRelease.findFirst({
      where: { status: "PUBLISHED" },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }]
    });
    if (!release) return;
    const config = this.record(release.bootstrapConfig);
    const template = this.record(config.starterBuildTemplate);
    const modules = Array.isArray(template.modules) ? template.modules.map((value) => this.record(value)) : [];
    const inventorySpecs = Array.isArray(config.starterInventory)
      ? config.starterInventory.map((value) => this.record(value))
      : [];
    if (!modules.length || !inventorySpecs.length) return;

    const definitionKeys = [...new Set(inventorySpecs.map((item) => item.definitionKey).filter(
      (key): key is string => typeof key === "string" && key.length > 0
    ))];
    const definitions = await tx.moduleDefinition.findMany({
      where: { contentReleaseId: release.id, key: { in: definitionKeys }, enabled: true }
    });
    if (definitions.length !== definitionKeys.length) {
      throw new ApiError("starter_content_invalid", 503, "Starter inventory references unknown content.");
    }

    const inventoryByDefinition = new Map<string, string[]>();
    for (const spec of inventorySpecs) {
      if (typeof spec.definitionKey !== "string") continue;
      const quantity = Math.min(16, this.positiveInteger(spec.quantity, 1));
      for (let index = 0; index < quantity; index += 1) {
        const id = createUuidV7();
        const ids = inventoryByDefinition.get(spec.definitionKey) ?? [];
        ids.push(id);
        inventoryByDefinition.set(spec.definitionKey, ids);
        await tx.inventoryItem.create({
          data: {
            id,
            userId,
            contentReleaseId: release.id,
            definitionKey: spec.definitionKey,
            metadata: { source: "starter_bootstrap" }
          }
        });
      }
    }

    const parts = modules.map((module, index) => {
      const definitionId = typeof module.definitionKey === "string" ? module.definitionKey : "";
      const inventoryItemId = inventoryByDefinition.get(definitionId)?.shift();
      if (!inventoryItemId) throw new ApiError("starter_content_invalid", 503, "Starter build exceeds starter inventory.");
      return {
        inventoryItemId,
        definitionId,
        gridX: Number.isInteger(module.x) ? Number(module.x) : 0,
        gridY: Number.isInteger(module.y) ? Number(module.y) : 0,
        rotation: [0, 90, 180, 270].includes(Number(module.rotation))
          ? Number(module.rotation) as 0 | 90 | 180 | 270
          : 0,
        slotKey: `starter:${index}`
      };
    });
    const buildId = createUuidV7();
    const revisionId = createUuidV7();
    const name = typeof template.name === "string" && template.name.trim() ? template.name.trim().slice(0, 64) : "Starter Scout";
    const snapshot = { schemaVersion: 3, name, parts: parts.map(({ slotKey: _, ...part }) => part) };
    this.validateDefinitionShapes(parts, definitions);
    const metrics = this.definitionMetrics(parts, definitions);

    await tx.shipBuild.create({ data: { id: buildId, userId, name } });
    await tx.shipBuildRevision.create({
      data: {
        id: revisionId,
        buildId,
        contentReleaseId: release.id,
        version: 1,
        schemaVersion: 3,
        snapshot,
        snapshotHash: this.hashJson(snapshot),
        totalMass: metrics.mass,
        totalPower: metrics.power,
        installedItems: {
          create: parts.map((part) => ({
            id: createUuidV7(),
            inventoryItemId: part.inventoryItemId,
            slotKey: part.slotKey,
            placement: { gridX: part.gridX, gridY: part.gridY, rotation: part.rotation }
          }))
        }
      }
    });
    await tx.shipBuild.update({ where: { id: buildId }, data: { currentRevisionId: revisionId } });
    const installedIds = new Set(parts.map((part) => part.inventoryItemId));
    for (const ids of inventoryByDefinition.values()) {
      for (const id of ids) installedIds.delete(id);
    }
    await tx.inventoryItem.updateMany({
      where: { userId, id: { in: [...installedIds] } },
      data: { state: "INSTALLED" }
    });
    const allItems = await tx.inventoryItem.findMany({
      where: { userId, contentReleaseId: release.id, metadata: { path: ["source"], equals: "starter_bootstrap" } },
      select: { id: true, state: true }
    });
    await tx.inventoryTransition.createMany({
      data: allItems.map((item) => ({
        id: createUuidV7(),
        userId,
        inventoryItemId: item.id,
        fromState: null,
        toState: item.state,
        sourceType: "starter_bootstrap",
        sourceId: buildId,
        idempotencyKey: this.hashText(`starter:${userId}:${item.id}`),
        metadata: {}
      }))
    });
  }

  // Player mutation methods are implemented below the authentication boundary.
  async applyBuildCommands(userId: string, buildId: string, input: ApplyShipBuildCommandsRequestDto): Promise<ShipBuildDto> {
    const requestHash = this.hashJson(input);
    try {
      return await this.withUser(userId, async (tx) => {
        const existing = await tx.playerCommandIdempotency.findUnique({
          where: { userId_scope_key: { userId, scope: `build:${buildId}`, key: input.idempotencyKey } }
        });
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw new ApiError("idempotency_conflict", 409, "Idempotency key was used for another request.");
          }
          if (existing.status === "SUCCEEDED" && existing.response) return existing.response as unknown as ShipBuildDto;
          throw new ApiError("command_in_progress", 409, "Build command is already in progress.");
        }
        const commandId = createUuidV7();
        await tx.playerCommandIdempotency.create({
          data: {
            id: commandId,
            userId,
            scope: `build:${buildId}`,
            key: input.idempotencyKey,
            requestHash,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
          }
        });
        const build = await tx.shipBuild.findFirst({
          where: { id: buildId, userId, status: "ACTIVE" },
          include: {
            currentRevision: {
              include: { installedItems: { include: { inventoryItem: true }, orderBy: { slotKey: "asc" } } }
            }
          }
        });
        if (!build?.currentRevision) throw new ApiError("build_not_found", 404, "Build not found.");
        const lockedBuild = await tx.$queryRaw<Array<{ currentRevisionId: string | null }>>`
          SELECT current_revision_id AS "currentRevisionId"
            FROM ship_builds
           WHERE id = ${build.id}::uuid AND user_id = ${userId}::uuid
           FOR UPDATE
        `;
        if (lockedBuild[0]?.currentRevisionId !== build.currentRevision.id) {
          throw new ApiError("build_revision_conflict", 409, "Build revision has changed.");
        }
        if (build.currentRevision.version !== input.expectedRevision) {
          throw new ApiError("build_revision_conflict", 409, "Build revision has changed.", {
            currentRevision: build.currentRevision.version
          });
        }
        // Launch validation uses FOR SHARE and battle finalization uses FOR UPDATE
        // in this same UUID order. Holding these rows before checking attempts
        // serializes build edits against both launch and durability persistence.
        await tx.$queryRaw`
          SELECT inventory.id
            FROM build_revision_items installed
            JOIN inventory_items inventory ON inventory.id = installed.inventory_item_id
           WHERE installed.build_revision_id = ${build.currentRevision.id}::uuid
             AND inventory.user_id = ${userId}::uuid
           ORDER BY inventory.id
           FOR UPDATE OF inventory
        `;
        const activeAttempt = await tx.missionAttempt.findFirst({
          where: {
            userId,
            buildRevisionId: build.currentRevision.id,
            status: { in: ["CREATED", "CONNECTING", "ACTIVE", "PAUSED"] },
          },
          select: { id: true },
        });
        if (activeAttempt) {
          throw new ApiError("build_in_active_battle", 409, "Build cannot be changed during an active battle.");
        }
        const activeMatchmakingTicket = await tx.matchmakingTicket.findFirst({
          where: {
            userId,
            buildRevisionId: build.currentRevision.id,
            status: { in: ["QUEUED", "MATCHED"] },
          },
          select: { id: true },
        });
        if (activeMatchmakingTicket) {
          throw new ApiError("build_reserved_for_matchmaking", 409, "Build cannot be changed while matchmaking is active.");
        }

        let name = build.name;
        let parts: ShipBuildPartDto[] = build.currentRevision.installedItems.map((item) => ({
          inventoryItemId: item.inventoryItemId,
          definitionId: item.inventoryItem.definitionKey,
          ...this.placement(item.placement)
        }));
        for (const command of input.commands) {
          if (command.type === "rename") {
            name = command.name.trim();
          } else if (command.type === "remove") {
            parts = parts.filter((part) => part.inventoryItemId !== command.inventoryItemId);
          } else {
            const alreadyInBuild = parts.some((part) => part.inventoryItemId === command.inventoryItemId);
            const item = await tx.inventoryItem.findFirst({
              where: {
                id: command.inventoryItemId,
                userId,
                state: { in: command.type === "move" && alreadyInBuild
                  ? ["AVAILABLE", "INSTALLED", "DAMAGED"]
                  : ["AVAILABLE", "INSTALLED"] },
              }
            });
            if (!item) throw new ApiError("inventory_item_unavailable", 422, "Inventory item is unavailable.");
            if (item.contentReleaseId !== build.currentRevision.contentReleaseId) {
              throw new ApiError("content_version_mismatch", 422, "Inventory item belongs to another content release.");
            }
            if (command.type === "move" && !alreadyInBuild) {
              throw new ApiError("build_part_missing", 422, "Cannot move a part that is not installed in this build.");
            }
            if (command.type === "install" && item.state === "INSTALLED" && !alreadyInBuild) {
              throw new ApiError("inventory_item_installed", 422, "Inventory item is installed in another build.");
            }
            parts = [
              ...parts.filter((part) => part.inventoryItemId !== item.id),
              {
                inventoryItemId: item.id,
                definitionId: item.definitionKey,
                gridX: command.gridX,
                gridY: command.gridY,
                rotation: command.rotation
              }
            ];
          }
        }
        this.validatePartPlacements(parts);
        const definitions = await tx.moduleDefinition.findMany({
          where: {
            contentReleaseId: build.currentRevision.contentReleaseId,
            key: { in: [...new Set(parts.map((part) => part.definitionId))] },
            enabled: true
          }
        });
        if (definitions.length !== new Set(parts.map((part) => part.definitionId)).size) {
          throw new ApiError("build_definition_invalid", 422, "Build references unknown module definitions.");
        }
        this.validateDefinitionShapes(parts, definitions);
        const revisionId = createUuidV7();
        const version = build.currentRevision.version + 1;
        const snapshot = { schemaVersion: 3, name, parts };
        const metrics = this.definitionMetrics(parts, definitions);
        const revision = await tx.shipBuildRevision.create({
          data: {
            id: revisionId,
            buildId,
            contentReleaseId: build.currentRevision.contentReleaseId,
            version,
            schemaVersion: 3,
            snapshot,
            snapshotHash: this.hashJson(snapshot),
            totalMass: metrics.mass,
            totalPower: metrics.power,
            installedItems: {
              create: parts.map((part) => ({
                id: createUuidV7(),
                inventoryItemId: part.inventoryItemId,
                slotKey: `part:${part.inventoryItemId}`,
                placement: { gridX: part.gridX, gridY: part.gridY, rotation: part.rotation }
              }))
            }
          }
        });
        const previousIds = build.currentRevision.installedItems.map((item) => item.inventoryItemId);
        const previousStates = new Map(
          build.currentRevision.installedItems.map((item) => [item.inventoryItemId, item.inventoryItem.state]),
        );
        const nextIds = parts.map((part) => part.inventoryItemId);
        const addedIds = nextIds.filter((id) => !previousIds.includes(id));
        await tx.shipBuild.update({ where: { id: buildId }, data: { name, currentRevisionId: revisionId } });
        if (addedIds.length) {
          await tx.inventoryItem.updateMany({ where: { userId, id: { in: addedIds } }, data: { state: "INSTALLED" } });
        }
        const removedIds = previousIds.filter((id) => !nextIds.includes(id));
        const removedInstalledIds = removedIds.filter((id) => previousStates.get(id) === "INSTALLED");
        if (removedInstalledIds.length) {
          await tx.inventoryItem.updateMany({
            where: { userId, id: { in: removedInstalledIds }, state: "INSTALLED" },
            data: { state: "AVAILABLE" },
          });
        }
        if (addedIds.length || removedInstalledIds.length) {
          await tx.inventoryTransition.createMany({
            data: [
              ...addedIds.map((inventoryItemId) => ({
                id: createUuidV7(),
                userId,
                inventoryItemId,
                fromState: "AVAILABLE" as const,
                toState: "INSTALLED" as const,
                sourceType: "build_revision",
                sourceId: revisionId,
                idempotencyKey: this.hashText(`build-add:${commandId}:${inventoryItemId}`),
                metadata: {}
              })),
              ...removedInstalledIds.map((inventoryItemId) => ({
                id: createUuidV7(),
                userId,
                inventoryItemId,
                fromState: "INSTALLED" as const,
                toState: "AVAILABLE" as const,
                sourceType: "build_revision",
                sourceId: revisionId,
                idempotencyKey: this.hashText(`build-remove:${commandId}:${inventoryItemId}`),
                metadata: {}
              }))
            ]
          });
        }
        const response: ShipBuildDto = {
          id: buildId,
          updatedAt: new Date().toISOString(),
          activeRevision: {
            id: revision.id,
            buildId,
            revision: version,
            name,
            parts,
            createdAt: revision.createdAt.toISOString()
          }
        };
        await tx.playerCommandIdempotency.update({
          where: { id: commandId },
          data: { status: "SUCCEEDED", response: response as unknown as Prisma.InputJsonValue }
        });
        await tx.outboxEvent.create({
          data: {
            id: createUuidV7(),
            aggregateType: "ship_build",
            aggregateId: buildId,
            eventType: "ship_build.revised",
            payload: { userId, buildId, revisionId, version },
            idempotencyKey: this.hashText(`build-revised:${commandId}`)
          }
        });
        return response;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) throw new ApiError("command_in_progress", 409, "Build command is already in progress.");
      throw error;
    }
  }
  async importLegacyBuild(userId: string, proposal: LegacyBuildImportProposalDto) {
    const sourceHash = this.hashJson(proposal);
    return this.withUser(userId, async (tx) => {
      const prior = await tx.legacyBuildImport.findUnique({
        where: { userId },
        include: {
          importedBuild: {
            include: {
              currentRevision: {
                include: { installedItems: { include: { inventoryItem: true }, orderBy: { slotKey: "asc" } } }
              }
            }
          }
        }
      });
      if (prior) {
        if (prior.sourceHash !== sourceHash) {
          throw new ApiError("legacy_import_already_used", 409, "Legacy build import was already used for this player.");
        }
        if (prior.status === "IMPORTED" && prior.importedBuild) {
          return { imported: false, build: this.mapBuild(prior.importedBuild) };
        }
        throw new ApiError("legacy_import_unavailable", 409, "Legacy build import cannot be retried.");
      }
      if (new Set(proposal.parts.map((part) => part.sourceInstanceId)).size !== proposal.parts.length) {
        throw new ApiError("legacy_import_invalid", 422, "Legacy build contains duplicate source parts.");
      }
      const functionalLegacyParts = proposal.parts.filter((part) => part.kind !== "panel");
      if (!functionalLegacyParts.length) {
        throw new ApiError("legacy_import_invalid", 422, "Legacy build contains no functional modules.");
      }
      this.validatePartPlacements(functionalLegacyParts.map((part) => ({
        inventoryItemId: part.sourceInstanceId,
        definitionId: part.definitionId,
        gridX: part.gridX,
        gridY: part.gridY,
        rotation: part.rotation
      })));
      const release = await tx.contentRelease.findFirst({
        where: { status: "PUBLISHED" },
        orderBy: [{ publishedAt: "desc" }, { id: "desc" }]
      });
      if (!release) throw new ApiError("content_unavailable", 503, "No published content release is available.");
      const definitionKeys = [...new Set(functionalLegacyParts.map((part) => part.definitionId))];
      const definitions = await tx.moduleDefinition.findMany({
        where: { contentReleaseId: release.id, key: { in: definitionKeys }, enabled: true }
      });
      if (definitions.length !== definitionKeys.length) {
        throw new ApiError("legacy_definition_unknown", 422, "Legacy build contains definitions unavailable in this release.");
      }
      const importId = createUuidV7();
      await tx.legacyBuildImport.create({
        data: {
          id: importId,
          userId,
          sourceSchemaVersion: 3,
          sourceHash,
          sourceSnapshot: proposal as unknown as Prisma.InputJsonValue,
          idempotencyKey: this.hashText(`legacy-import:${userId}`)
        }
      });
      const parts: ShipBuildPartDto[] = [];
      for (const part of functionalLegacyParts) {
        const inventoryItemId = createUuidV7();
        await tx.inventoryItem.create({
          data: {
            id: inventoryItemId,
            userId,
            contentReleaseId: release.id,
            definitionKey: part.definitionId,
            state: "INSTALLED",
            metadata: { source: "legacy_build_v3", sourceInstanceId: part.sourceInstanceId, kind: part.kind }
          }
        });
        parts.push({
          inventoryItemId,
          definitionId: part.definitionId,
          gridX: part.gridX,
          gridY: part.gridY,
          rotation: part.rotation
        });
      }
      const buildId = createUuidV7();
      const revisionId = createUuidV7();
      const existingName = await tx.shipBuild.findFirst({ where: { userId, name: proposal.name }, select: { id: true } });
      const name = existingName ? `${proposal.name.slice(0, 48)} (Legacy)` : proposal.name;
      const snapshot = { ...proposal, serverSchemaVersion: 1, parts };
      this.validateDefinitionShapes(parts, definitions);
      const metrics = this.definitionMetrics(parts, definitions);
      await tx.shipBuild.create({ data: { id: buildId, userId, name } });
      const revision = await tx.shipBuildRevision.create({
        data: {
          id: revisionId,
          buildId,
          contentReleaseId: release.id,
          version: 1,
          schemaVersion: 3,
          snapshot,
          snapshotHash: this.hashJson(snapshot),
          totalMass: metrics.mass,
          totalPower: metrics.power,
          installedItems: {
            create: parts.map((part) => ({
              id: createUuidV7(),
              inventoryItemId: part.inventoryItemId,
              slotKey: `legacy:${part.inventoryItemId}`,
              placement: { gridX: part.gridX, gridY: part.gridY, rotation: part.rotation }
            }))
          }
        }
      });
      await tx.shipBuild.update({ where: { id: buildId }, data: { currentRevisionId: revisionId } });
      await tx.inventoryTransition.createMany({
        data: parts.map((part) => ({
          id: createUuidV7(),
          userId,
          inventoryItemId: part.inventoryItemId,
          fromState: null,
          toState: "INSTALLED" as const,
          sourceType: "legacy_build_import",
          sourceId: importId,
          idempotencyKey: this.hashText(`legacy-item:${importId}:${part.inventoryItemId}`),
          metadata: {}
        }))
      });
      await tx.legacyBuildImport.update({
        where: { id: importId },
        data: { status: "IMPORTED", importedBuildId: buildId, importedAt: new Date() }
      });
      await tx.outboxEvent.create({
        data: {
          id: createUuidV7(),
          aggregateType: "ship_build",
          aggregateId: buildId,
          eventType: "ship_build.legacy_imported",
          payload: { userId, buildId, revisionId },
          idempotencyKey: this.hashText(`legacy-imported:${importId}`)
        }
      });
      return {
        imported: true,
        build: {
          id: buildId,
          updatedAt: new Date().toISOString(),
          activeRevision: {
            id: revision.id,
            buildId,
            revision: 1,
            name,
            parts,
            createdAt: revision.createdAt.toISOString()
          }
        }
      };
    });
  }
  async createMissionAttempt(input: {
    userId: string;
    missionId: string;
    shipBuildRevisionId: string;
    idempotencyKey: string;
    ticketHash: string;
    ticketExpiresAt: Date;
  }): Promise<MissionAttemptRecord> {
    const scopedIdempotencyKey = this.hashText(`mission-attempt:${input.userId}:${input.idempotencyKey}`);
    return this.withUser(input.userId, async (tx) => {
      const existing = await tx.missionAttempt.findUnique({
        where: { idempotencyKey: scopedIdempotencyKey },
        include: { battleSession: true }
      });
      if (existing?.battleSession) {
        await tx.missionAttempt.update({
          where: { id: existing.id },
          data: { wsTicketHash: input.ticketHash, wsTicketExpiresAt: input.ticketExpiresAt }
        });
        return {
          attemptId: existing.id,
          sessionId: existing.battleSession.id,
          mode: "pve",
          simulationConfig: await this.loadSimulationConfig(tx, existing.id)
        };
      }
      const mission = await tx.missionDefinition.findFirst({
        where: { key: input.missionId, enabled: true, contentRelease: { status: "PUBLISHED" } },
        include: { contentRelease: true }
      });
      if (!mission) throw new ApiError("mission_not_found", 404, "Mission not found.");
      const buildRevision = await tx.shipBuildRevision.findFirst({
        where: {
          id: input.shipBuildRevisionId,
          contentReleaseId: mission.contentReleaseId,
          build: { userId: input.userId, status: "ACTIVE", currentRevisionId: input.shipBuildRevisionId }
        },
        select: { id: true }
      });
      if (!buildRevision) throw new ApiError("build_revision_invalid", 422, "Build revision is unavailable for this mission.");
      await this.assertBuildLaunchable(tx, buildRevision.id);
      const attemptId = createUuidV7();
      const sessionId = createUuidV7();
      const seed = this.randomSeed();
      await tx.missionAttempt.create({
        data: {
          id: attemptId,
          userId: input.userId,
          missionDefinitionId: mission.id,
          contentReleaseId: mission.contentReleaseId,
          buildRevisionId: buildRevision.id,
          type: "PVE",
          status: "CONNECTING",
          seed: BigInt(seed),
          simulationVersion: SIMULATION_VERSION,
          wsTicketHash: input.ticketHash,
          wsTicketExpiresAt: input.ticketExpiresAt,
          idempotencyKey: scopedIdempotencyKey
        }
      });
      await tx.battleSession.create({
        data: {
          id: sessionId,
          missionAttemptId: attemptId,
          contentReleaseId: mission.contentReleaseId,
          simulationVersion: SIMULATION_VERSION
        }
      });
      await tx.outboxEvent.create({
        data: {
          id: createUuidV7(),
          aggregateType: "mission_attempt",
          aggregateId: attemptId,
          eventType: "battle.attempt.created",
          payload: { userId: input.userId, attemptId, sessionId, protocolVersion: BATTLE_PROTOCOL_VERSION },
          idempotencyKey: this.hashText(`attempt-created:${attemptId}`)
        }
      });
      return {
        attemptId,
        sessionId,
        mode: "pve",
        simulationConfig: await this.loadSimulationConfig(tx, attemptId)
      };
    });
  }

  async renewMissionAttemptTicket(input: {
    userId: string;
    attemptId: string;
    ticketHash: string;
    ticketExpiresAt: Date;
  }): Promise<MissionAttemptRecord | null> {
    return this.withUser(input.userId, async (tx) => {
      const attempt = await tx.missionAttempt.findFirst({
        where: { id: input.attemptId, userId: input.userId, type: "PVE" },
        include: { battleSession: true, result: true }
      });
      if (!attempt?.battleSession || attempt.result || ["COMPLETED", "FAILED", "ABANDONED"].includes(attempt.status)) return null;
      if (attempt.reconnectDeadline && attempt.reconnectDeadline <= new Date()) return null;
      await tx.missionAttempt.update({
        where: { id: attempt.id },
        data: {
          wsTicketHash: input.ticketHash,
          wsTicketExpiresAt: input.ticketExpiresAt,
          status: attempt.status === "PAUSED" ? "CONNECTING" : attempt.status
        }
      });
      if (attempt.status === "PAUSED") {
        await tx.battleSession.update({ where: { id: attempt.battleSession.id }, data: { status: "RECOVERING" } });
      }
      return {
        attemptId: attempt.id,
        sessionId: attempt.battleSession.id,
        mode: "pve",
        simulationConfig: await this.loadSimulationConfig(tx, attempt.id)
      };
    });
  }

  async getMissionAttemptStatus(userId: string, attemptId: string): Promise<MissionAttemptStatusDto | null> {
    return this.withUser(userId, async (tx) => {
      const attempt = await tx.missionAttempt.findFirst({
        where: { id: attemptId, userId },
        include: { battleSession: true, result: true }
      });
      if (!attempt?.battleSession) return null;
      const statuses = {
        CREATED: "queued",
        CONNECTING: "queued",
        ACTIVE: "active",
        PAUSED: "paused",
        COMPLETED: "completed",
        FAILED: "failed",
        ABANDONED: "failed"
      } as const;
      const reconnectPermitted = !attempt.result
        && !["COMPLETED", "FAILED", "ABANDONED"].includes(attempt.status)
        && (!attempt.reconnectDeadline || attempt.reconnectDeadline > new Date());
      return {
        attemptId: attempt.id,
        sessionId: attempt.battleSession.id,
        status: statuses[attempt.status],
        resultId: attempt.result?.id ?? null,
        reconnect: {
          permitted: reconnectPermitted,
          deadlineAt: attempt.reconnectDeadline?.toISOString() ?? null,
          lastAcknowledgedInputSequence: this.safeNumber(attempt.battleSession.lastInputSequence)
        }
      };
    });
  }

  async createMatchmakingTicket(input: {
    userId: string;
    shipBuildRevisionId: string;
    queue: string;
    idempotencyKey: string;
  }): Promise<MatchmakingTicketRecord> {
    const requestHash = this.hashJson({ queue: input.queue, shipBuildRevisionId: input.shipBuildRevisionId });
    const idempotencyKey = this.hashText(`matchmaking:${input.userId}:${input.idempotencyKey}`);
    try {
      return await this.withUser(input.userId, async (tx) => {
        await tx.matchmakingTicket.updateMany({
          where: { userId: input.userId, status: "QUEUED", expiresAt: { lte: new Date() } },
          data: { status: "EXPIRED" },
        });
        const existing = await tx.matchmakingTicket.findUnique({
          where: { idempotencyKey },
          include: { pvpMatch: { include: { battleSession: true, missionAttempts: true } } },
        });
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw new ApiError("idempotency_key_reused", 409, "Idempotency key was reused with another request.");
          }
          return this.mapMatchmakingTicket(existing, input.userId);
        }
        const active = await tx.matchmakingTicket.findFirst({
          where: { userId: input.userId, status: { in: ["QUEUED", "MATCHED"] } },
          select: { id: true },
        });
        if (active) throw new ApiError("matchmaking_ticket_active", 409, "Player already has an active matchmaking ticket.");

        const now = new Date();
        const season = await tx.season.findFirst({
          where: { status: "ACTIVE", startsAt: { lte: now }, endsAt: { gt: now } },
          orderBy: [{ startsAt: "desc" }, { id: "desc" }],
        });
        if (!season) throw new ApiError("pvp_season_unavailable", 503, "No active PvP season is available.");
        const policy = this.matchmakingPolicy(season.rules, input.queue);
        const mission = await tx.missionDefinition.findFirst({
          where: {
            key: policy.missionId,
            enabled: true,
            contentRelease: { status: "PUBLISHED" },
          },
          include: { contentRelease: true },
        });
        if (!mission) throw new ApiError("pvp_content_unavailable", 503, "PvP mission content is unavailable.");
        const build = await tx.shipBuildRevision.findFirst({
          where: {
            id: input.shipBuildRevisionId,
            contentReleaseId: mission.contentReleaseId,
            build: { userId: input.userId, status: "ACTIVE", currentRevisionId: input.shipBuildRevisionId },
          },
          select: { id: true },
        });
        if (!build) throw new ApiError("build_revision_invalid", 422, "Build revision is unavailable for matchmaking.");
        await this.assertBuildLaunchable(tx, build.id);
        const participant = await tx.seasonParticipant.upsert({
          where: { seasonId_userId: { seasonId: season.id, userId: input.userId } },
          update: {},
          create: { id: createUuidV7(), seasonId: season.id, userId: input.userId },
        });
        const ticket = await tx.matchmakingTicket.create({
          data: {
            id: createUuidV7(),
            userId: input.userId,
            buildRevisionId: build.id,
            seasonId: season.id,
            contentReleaseId: mission.contentReleaseId,
            missionDefinitionId: mission.id,
            queue: input.queue,
            region: policy.region,
            mmr: participant.rating,
            baseMmrWindow: policy.baseMmrWindow,
            expansionPerSecond: policy.expansionPerSecond,
            maxMmrWindow: policy.maxMmrWindow,
            requestHash,
            idempotencyKey,
            expiresAt: new Date(now.getTime() + policy.ticketTtlSeconds * 1_000),
          },
          include: { pvpMatch: { include: { battleSession: true, missionAttempts: true } } },
        });
        await tx.outboxEvent.create({
          data: {
            id: createUuidV7(),
            aggregateType: "matchmaking_ticket",
            aggregateId: ticket.id,
            eventType: "matchmaking.ticket.created",
            payload: { ticketId: ticket.id, userId: input.userId, queue: ticket.queue, region: ticket.region },
            idempotencyKey: this.hashText(`matchmaking-ticket-created:${ticket.id}`),
          },
        });
        return this.mapMatchmakingTicket(ticket, input.userId);
      });
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      const winner = await this.withUser(input.userId, (tx) => tx.matchmakingTicket.findFirst({
        where: { userId: input.userId, OR: [{ idempotencyKey }, { status: { in: ["QUEUED", "MATCHED"] } }] },
        include: { pvpMatch: { include: { battleSession: true, missionAttempts: true } } },
      }));
      if (!winner) throw error;
      if (winner.idempotencyKey === idempotencyKey && winner.requestHash !== requestHash) {
        throw new ApiError("idempotency_key_reused", 409, "Idempotency key was reused with another request.");
      }
      if (winner.idempotencyKey !== idempotencyKey) {
        throw new ApiError("matchmaking_ticket_active", 409, "Player already has an active matchmaking ticket.");
      }
      return this.mapMatchmakingTicket(winner, input.userId);
    }
  }

  async getMatchmakingTicket(userId: string, ticketId: string): Promise<MatchmakingTicketRecord | null> {
    return this.withUser(userId, async (tx) => {
      await tx.matchmakingTicket.updateMany({
        where: { id: ticketId, userId, status: "QUEUED", expiresAt: { lte: new Date() } },
        data: { status: "EXPIRED" },
      });
      const ticket = await tx.matchmakingTicket.findFirst({
        where: { id: ticketId, userId },
        include: { pvpMatch: { include: { battleSession: true, missionAttempts: true } } },
      });
      return ticket ? this.mapMatchmakingTicket(ticket, userId) : null;
    });
  }

  async cancelMatchmakingTicket(userId: string, ticketId: string): Promise<MatchmakingTicketRecord | null> {
    return this.withUser(userId, async (tx) => {
      const now = new Date();
      await tx.matchmakingTicket.updateMany({
        where: { id: ticketId, userId, status: "QUEUED", expiresAt: { lte: now } },
        data: { status: "EXPIRED" },
      });
      await tx.matchmakingTicket.updateMany({
        where: { id: ticketId, userId, status: "QUEUED", expiresAt: { gt: now } },
        data: { status: "CANCELLED", cancelledAt: now },
      });
      const ticket = await tx.matchmakingTicket.findFirst({
        where: { id: ticketId, userId },
        include: { pvpMatch: { include: { battleSession: true, missionAttempts: true } } },
      });
      return ticket ? this.mapMatchmakingTicket(ticket, userId) : null;
    });
  }

  async materializePvpMatch(input: {
    callerUserId: string;
    leftTicketId: string;
    rightTicketId: string;
  }): Promise<MaterializedPvpMatch> {
    const [leftTicketId, rightTicketId] = [input.leftTicketId, input.rightTicketId].sort();
    const ids = {
      match: createUuidV7(),
      leftParticipant: createUuidV7(),
      rightParticipant: createUuidV7(),
      leftAttempt: createUuidV7(),
      rightAttempt: createUuidV7(),
      session: createUuidV7(),
      outbox: createUuidV7(),
    };
    try {
      const rows = await this.withUser(input.callerUserId, (tx) => tx.$queryRaw<Array<{
        match_id: string;
        battle_session_id: string;
        left_ticket_id: string;
        left_attempt_id: string;
        right_ticket_id: string;
        right_attempt_id: string;
      }>>`
        SELECT * FROM spacey_materialize_pvp_match(
          ${leftTicketId}::uuid,
          ${rightTicketId}::uuid,
          ${ids.match}::uuid,
          ${ids.leftParticipant}::uuid,
          ${ids.rightParticipant}::uuid,
          ${ids.leftAttempt}::uuid,
          ${ids.rightAttempt}::uuid,
          ${ids.session}::uuid,
          ${ids.outbox}::uuid,
          ${BigInt(this.randomSeed())}::bigint,
          ${SIMULATION_VERSION}::text
        )
      `);
      const row = rows[0];
      if (!row) throw new ApiError("matchmaking_materialization_failed", 500, "PvP match was not materialized.");
      return {
        matchId: row.match_id,
        sessionId: row.battle_session_id,
        tickets: [
          { ticketId: row.left_ticket_id, attemptId: row.left_attempt_id },
          { ticketId: row.right_ticket_id, attemptId: row.right_attempt_id },
        ],
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      const code = this.postgresCode(error);
      if (["40001", "P0002", "23514", "23505"].includes(code ?? "")) {
        throw new ApiError("matchmaking_pair_stale", 409, "Matchmaking pair is no longer available.");
      }
      throw error;
    }
  }

  async renewPvpConnectionTicket(input: {
    userId: string;
    ticketId: string;
    ticketHash: string;
    ticketExpiresAt: Date;
  }): Promise<PvpConnectionRecord | null> {
    return this.withUser(input.userId, async (tx) => {
      const rows = await tx.$queryRaw<Array<{
        match_id: string;
        battle_session_id: string;
        seed: bigint;
        content_version: string;
        duration_seconds: number;
        participant_id: string;
        user_id: string;
        side: number;
        build_revision_id: string;
        attempt_id: string;
        definition_keys: string[];
        previous_ticket_hash: string | null;
      }>>`
        SELECT * FROM spacey_prepare_pvp_connection(
          ${input.ticketId}::uuid,
          ${input.ticketHash}::text,
          ${input.ticketExpiresAt}::timestamptz
        )
      `;
      if (rows.length === 0) return null;
      if (rows.length !== 2 || rows.some((row) => row.side !== 0 && row.side !== 1)) {
        throw new ApiError("pvp_participants_invalid", 500, "PvP match does not contain two valid participants.");
      }
      const first = rows[0]!;
      if (rows.some((row) => row.match_id !== first.match_id
        || row.battle_session_id !== first.battle_session_id
        || row.content_version !== first.content_version
        || row.seed !== first.seed)) {
        throw new ApiError("pvp_session_invalid", 500, "PvP session rows are inconsistent.");
      }
      const release = await tx.contentRelease.findUnique({
        where: { version: first.content_version },
        include: { moduleDefinitions: { where: { enabled: true } } },
      });
      if (!release) throw new ApiError("pvp_content_unavailable", 503, "PvP content release is unavailable.");
      const definitions = new Map(release.moduleDefinitions.map((definition) => [definition.key, this.record(definition.stats)]));
      const participants = rows
        .sort((left, right) => left.side - right.side)
        .map((row) => ({
          participantId: row.participant_id,
          userId: row.user_id,
          side: row.side === 0 ? "alpha" as const : "beta" as const,
          shipBuildRevisionId: row.build_revision_id,
          buildStats: this.duelBuildStats(row.definition_keys, definitions),
        })) as import("@spacey/simulation").DuelSimulationConfig["participants"];
      const own = rows.find((row) => row.user_id === input.userId);
      if (!own) throw new ApiError("pvp_participant_missing", 500, "Player is not a PvP participant.");
      return {
        ticketId: input.ticketId,
        sessionId: first.battle_session_id,
        attemptId: own.attempt_id,
        userId: own.user_id,
        matchId: first.match_id,
        participantId: own.participant_id,
        side: own.side as 0 | 1,
        previousTicketHash: own.previous_ticket_hash,
        simulationConfig: {
          matchId: first.match_id,
          sessionId: first.battle_session_id,
          seed: this.safeNumber(first.seed),
          contentVersion: first.content_version,
          simulationVersion: SIMULATION_VERSION,
          durationSeconds: first.duration_seconds,
          arenaWidthUnits: 2_000,
          arenaHeightUnits: 1_200,
          participants,
        },
        participants: rows.map((row) => ({
          userId: row.user_id,
          attemptId: row.attempt_id,
          participantId: row.participant_id,
          side: row.side as 0 | 1,
        })),
      };
    });
  }

  private async assertBuildLaunchable(tx: TransactionClient, buildRevisionId: string): Promise<void> {
    try {
      await tx.$queryRaw`SELECT spacey_assert_owned_build_launchable(${buildRevisionId}::uuid)`;
    } catch (error) {
      if (this.postgresCode(error) === "23514") {
        throw new ApiError(
          "build_not_launchable",
          422,
          "Build contains unavailable or destroyed items, or is already used by an active battle.",
        );
      }
      throw error;
    }
  }

  private async loadSimulationConfig(tx: TransactionClient, attemptId: string): Promise<MissionSimulationConfig> {
    const attempt = await tx.missionAttempt.findUnique({
      where: { id: attemptId },
      include: {
        contentRelease: true,
        missionDefinition: true,
        battleSession: true,
        buildRevision: { include: { installedItems: { include: { inventoryItem: true } } } }
      }
    });
    if (!attempt?.battleSession) throw new ApiError("battle_session_missing", 500, "Battle session was not created.");
    const definitionKeys = attempt.buildRevision.installedItems.map((item) => item.inventoryItem.definitionKey);
    const moduleDefinitions = await tx.moduleDefinition.findMany({
      where: { contentReleaseId: attempt.contentReleaseId, key: { in: definitionKeys }, enabled: true }
    });
    const objective = this.record(attempt.missionDefinition.objective);
    const roster = Array.isArray(attempt.missionDefinition.enemyRoster)
      ? attempt.missionDefinition.enemyRoster.map((value) => this.record(value))
      : [];
    const enemyKey = typeof roster[0]?.definitionKey === "string" ? roster[0].definitionKey : "";
    const enemyDefinition = await tx.enemyDefinition.findFirst({
      where: { contentReleaseId: attempt.contentReleaseId, key: enemyKey, enabled: true }
    });
    if (!enemyDefinition) throw new ApiError("mission_content_invalid", 503, "Mission enemy definition is unavailable.");
    const playerStats = moduleDefinitions.map((definition) => this.record(definition.stats));
    const enemyStats = this.record(enemyDefinition.stats);
    const hull = Math.max(1, playerStats.reduce((sum, stats) => sum + this.nonnegativeInteger(stats.hp), 0));
    const thrust = playerStats.reduce((sum, stats) => sum + this.nonnegativeInteger(stats.thrust) + this.nonnegativeInteger(stats.maneuverThrust), 0);
    const weapons = playerStats.filter((stats) => this.nonnegativeInteger(stats.damage) > 0);
    const weapon = weapons.sort((left, right) => this.nonnegativeInteger(right.damage) - this.nonnegativeInteger(left.damage))[0] ?? {};
    const enemyCount = Math.max(1, roster.reduce((sum, item) => sum + this.positiveInteger(item.count, 0), 0));
    const objectiveConfig = objective.type === "survive_seconds"
      ? { type: "survive_seconds" as const, targetSeconds: this.positiveInteger(objective.target, attempt.missionDefinition.durationSeconds) }
      : { type: "destroy_all" as const, targetKills: this.positiveInteger(objective.target, enemyCount) };
    return {
      sessionId: attempt.battleSession.id,
      attemptId: attempt.id,
      missionId: attempt.missionDefinition.key,
      mode: "pve",
      seed: this.safeNumber(attempt.seed),
      contentVersion: attempt.contentRelease.version,
      simulationVersion: SIMULATION_VERSION,
      shipBuildRevisionId: attempt.buildRevisionId,
      durationSeconds: attempt.missionDefinition.durationSeconds,
      objective: objectiveConfig,
      arenaWidthUnits: 2_000,
      arenaHeightUnits: 1_200,
      enemyCount,
      player: {
        hull,
        speedUnitsPerSecond: Math.max(80, Math.min(800, thrust * 2)),
        weaponDamage: Math.max(1, this.nonnegativeInteger(weapon.damage)),
        weaponRangeUnits: Math.max(100, this.positiveInteger(weapon.range, 420)),
        weaponCooldownTicks: Math.max(1, Math.ceil(this.positiveInteger(weapon.cooldownMs, 500) * 30 / 1000)),
        projectileSpeedUnitsPerSecond: Math.max(100, this.positiveInteger(weapon.projectileSpeed, 600))
      },
      enemy: {
        hull: this.positiveInteger(enemyStats.hp, 80),
        speedUnitsPerSecond: this.positiveInteger(enemyStats.speed, 180),
        collisionRadiusUnits: this.positiveInteger(enemyStats.collisionRadius, 20),
        attackDamage: this.positiveInteger(enemyStats.damage, 8),
        attackRangeUnits: this.positiveInteger(enemyStats.attackRange, 260),
        attackCooldownTicks: this.positiveInteger(enemyStats.attackCooldownTicks, 30)
      }
    };
  }

  private duelBuildStats(definitionKeys: string[], definitions: Map<string, Record<string, unknown>>) {
    const stats = definitionKeys.map((key) => definitions.get(key) ?? {});
    const weapons = stats
      .filter((value) => this.nonnegativeInteger(value.damage) > 0)
      .sort((left, right) => this.nonnegativeInteger(right.damage) - this.nonnegativeInteger(left.damage));
    const weapon = weapons[0] ?? {};
    const hull = stats.reduce((sum, value) => sum + this.nonnegativeInteger(value.hp), 0);
    const thrust = stats.reduce(
      (sum, value) => sum + this.nonnegativeInteger(value.thrust) + this.nonnegativeInteger(value.maneuverThrust),
      0,
    );
    return {
      hull: Math.max(1, hull),
      speedUnitsPerSecond: Math.max(80, Math.min(800, thrust * 2)),
      weaponDamage: Math.max(1, this.nonnegativeInteger(weapon.damage)),
      weaponRangeUnits: Math.max(100, this.positiveInteger(weapon.range, 420)),
      weaponCooldownTicks: Math.max(1, Math.ceil(this.positiveInteger(weapon.cooldownMs, 500) * 30 / 1_000)),
      projectileSpeedUnitsPerSecond: Math.max(100, this.positiveInteger(weapon.projectileSpeed, 600)),
      collisionRadiusUnits: Math.max(12, Math.min(80, Math.max(
        ...stats.map((value) => this.positiveInteger(value.collisionRadius, 24)),
      ))),
    };
  }

  private randomSeed() {
    const seed = randomBytes(4).readUInt32BE(0);
    return seed === 0 ? 1 : seed;
  }
}
