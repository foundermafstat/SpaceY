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
  BattleResultDto,
  BattleResultPageDto,
  BootstrapResponseDto,
  CommitRepairRequestDto,
  CreateRepairQuoteRequestDto,
  CreatePrivacyRequestDto,
  InventoryItemDto,
  LegacyBuildImportProposalDto,
  MatchmakingTicketDto,
  MissionAttemptStatusDto,
  PlayerProfileDto,
  PrivacyPreferencesDto,
  PrivacyRequestDto,
  PublicAggregateStatsDto,
  PublicCatalogDto,
  PublicLeaderboardEntryDto,
  PublicProfileDto,
  RepairQuoteDto,
  RepairResultDto,
  ShipBuildDto,
  ShipBuildPartDto,
  UpdatePrivacyPreferencesRequestDto,
  WalletDto
} from "@spacey/contracts";
import { BATTLE_PROTOCOL_VERSION, PVP_DUEL_PROTOCOL_READY } from "@spacey/protocol";
import {
  SIMULATION_VERSION,
  type DuelShipBuildStats,
  type DuelSimulationConfig,
  type EnemySimulationRosterEntry,
  type MissionSimulationConfig,
  type ShipModuleCategory,
  type ShipSimulationStats,
} from "@spacey/simulation";
import { ApiError } from "../common/api-error.js";
import { env } from "../config/env.js";
import { fullRepairCost } from "../game/repair-price.js";
import type {
  CreateDeveloperApiKeyRecord,
  CreateDeveloperClientRecord,
  CreateDeveloperWebhookRecord,
  DeveloperApiClientView,
  DeveloperApiKeyView,
  DeveloperWebhookView,
  PublicApiScope,
  PublicWebhookEventType,
} from "../public/developer-api.types.js";
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

type DeveloperClientRow = {
  id: string;
  clientId: string;
  name: string;
  status: string;
  scopes: string[];
  rateLimitPerMinute: number;
  previousOAuthSecretValidUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type DeveloperApiKeyRow = {
  id: string;
  apiClientId: string;
  keyPrefix: string;
  name: string;
  scopes: string[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

type DeveloperWebhookRow = {
  id: string;
  apiClientId: string;
  url: string;
  eventTypes: string[];
  status: string;
  previousSecretValidUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

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

  async isAccessSessionActive(userId: string, sessionId: string) {
    return this.withUser(userId, async (tx) => {
      const session = await tx.authSession.findFirst({
        where: {
          id: sessionId,
          userId,
          status: "ACTIVE",
          revokedAt: null,
          expiresAt: { gt: new Date() },
          user: { status: "ACTIVE" },
        },
        select: { id: true },
      });
      return session !== null;
    });
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
    try {
      await this.prisma.telegramAuthReplay.create({
        data: {
          id: createUuidV7(),
          initDataHash: input.initDataHash,
          telegramUserId: BigInt(input.identity.telegramUserId),
          authDate: input.authDate,
          expiresAt: input.replayExpiresAt,
        },
      });
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
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
        await tx.telegramAuthReplay.update({
          where: { initDataHash: input.initDataHash },
          data: { userId },
        });
        await this.provisionStarterBuild(tx, userId);
        return this.profileFromRecords(user, input.identity.telegramUserId);
      });
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
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
      const current = await tx.user.findUnique({
        where: { id: userId },
        select: { status: true, analyticsConsentAt: true },
      });
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
      if ((current.analyticsConsentAt !== null) !== input.analyticsConsent) {
        const outboxId = createUuidV7();
        await tx.outboxEvent.create({
          data: {
            id: outboxId,
            aggregateType: "aggregate-stats",
            aggregateId: "global",
            eventType: "aggregate.stats.updated",
            payload: { reason: "analytics_consent_changed" },
            idempotencyKey: `aggregate-stats:${outboxId}`,
          },
        });
      }
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
              status: "DELETION_PENDING",
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
      await tx.$executeRaw`SELECT set_config('spacey.user_id', ${input.userId}, true)`;
      const user = await tx.user.findUnique({ where: { id: input.userId }, select: { status: true } });
      if (user?.status !== "ACTIVE") {
        throw new ApiError("player_inactive", 409, "Inactive player cannot create an auth session.");
      }
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
      const rows = await tx.$queryRaw<Array<{
        id: string;
        user_id: string;
        token_family: string;
        status: string;
        expires_at: Date;
      }>>`
        SELECT id, user_id, token_family, status::text, expires_at
        FROM auth_sessions
        WHERE refresh_token_hash = ${input.currentTokenHash}
        FOR UPDATE
      `;
      const current = rows[0];
      if (!current) return { kind: "invalid" } as const;
      await tx.$executeRaw`SELECT set_config('spacey.user_id', ${current.user_id}, true)`;
      const user = await tx.user.findUnique({ where: { id: current.user_id }, select: { status: true } });
      if (user?.status !== "ACTIVE") {
        await tx.authSession.updateMany({
          where: { tokenFamily: current.token_family, status: { not: "REVOKED" } },
          data: { status: "REVOKED", revokedAt: new Date() },
        });
        return { kind: "invalid" } as const;
      }
      if (current.status === "ROTATED") {
        const now = new Date();
        await tx.authSession.updateMany({
          where: { tokenFamily: current.token_family, status: { not: "REVOKED" } },
          data: { status: "REVOKED", revokedAt: now }
        });
        await tx.authSession.update({ where: { id: current.id }, data: { reuseDetectedAt: now } });
        return { kind: "reuse", userId: current.user_id } as const;
      }
      if (current.status !== "ACTIVE" || current.expires_at <= new Date()) {
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
          userId: current.user_id,
          tokenFamily: current.token_family,
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
      const staleConnectingCutoff = new Date(Date.now() - 60_000);
      await tx.missionAttempt.updateMany({
        where: {
          userId,
          status: "CONNECTING",
          startedAt: null,
          createdAt: { lte: staleConnectingCutoff },
        },
        data: {
          status: "ABANDONED",
          endedAt: new Date(),
          wsTicketHash: null,
          wsTicketExpiresAt: null,
          reconnectDeadline: null,
        },
      });
      await tx.battleSession.updateMany({
        where: {
          status: "CREATED",
          missionAttempt: { is: { userId, status: "ABANDONED" } },
        },
        data: { status: "ENDED", endedAt: new Date() },
      });
      const [user, release, build, balances, inventory, activeAttempts, activeMatchmakingTickets] = await Promise.all([
        tx.user.findUnique({ where: { id: userId }, include: { telegramIdentity: true } }),
        tx.contentRelease.findFirst({
          where: { status: "PUBLISHED" },
          orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
          include: {
            missions: { where: { enabled: true }, orderBy: { key: "asc" }, include: { dropTable: true } },
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
        tx.inventoryItem.findMany({
          where: { userId },
          include: {
            contentRelease: {
              include: {
                moduleDefinitions: { select: { key: true, category: true, rarity: true, shape: true, stats: true } },
              },
            },
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
        tx.missionAttempt.findMany({
          where: { userId, status: { in: ["CREATED", "CONNECTING", "ACTIVE", "PAUSED"] } },
          include: { battleSession: true, result: true },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 10,
        }),
        tx.matchmakingTicket.findMany({
          where: { userId, status: { in: ["QUEUED", "MATCHED"] } },
          include: { pvpMatch: { include: { battleSession: true, missionAttempts: true } } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 10,
        }),
      ]);
      if (!user?.telegramIdentity) throw new ApiError("player_not_found", 404, "Player not found.");
      if (!release?.publishedAt) throw new ApiError("content_unavailable", 503, "No published content release is available.");
      const mappedAttempts = activeAttempts.flatMap((attempt) => {
        const mapped = attempt.battleSession ? this.mapMissionAttemptStatus(attempt) : null;
        return mapped ? [{ type: attempt.type, status: mapped }] : [];
      });
      const attemptById = new Map(mappedAttempts.map(({ status }) => [status.attemptId, status]));
      return {
        serverTime: new Date().toISOString(),
        profile: this.profileFromRecords(user, user.telegramIdentity.telegramUserId.toString()),
        wallet: this.mapWallet(balances),
        activeBuild: build ? this.mapBuild(build) : null,
        inventory: inventory.map((item) => {
          const definition = item.contentRelease.moduleDefinitions.find((candidate) => candidate.key === item.definitionKey);
          const installedInCurrent = build?.currentRevision?.installedItems.some((installed) => installed.inventoryItemId === item.id)
            ? build.currentRevision.id
            : null;
          const itemMetadata = this.record(item.metadata);
          const rarity = itemMetadata.rarity === "uncommon" || itemMetadata.rarity === "superRare"
            ? itemMetadata.rarity
            : definition?.rarity === "uncommon" || definition?.rarity === "superRare"
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
            ...this.modulePresentation(definition, item.definitionKey),
            installedBuildRevisionId: installedInCurrent,
            createdAt: item.createdAt.toISOString()
          };
        }),
        contentRelease: {
          id: release.id,
          version: release.version,
          publishedAt: release.publishedAt.toISOString()
        },
        missions: release.missions.map((mission) => this.mapMission(mission, release.version)),
        activeGameplay: [
          ...mappedAttempts
            .filter((attempt) => attempt.type === "PVE")
            .map(({ status }) => ({ mode: "pve" as const, attempt: status })),
          ...activeMatchmakingTickets.map((ticket) => {
            const matchmakingTicket = this.mapMatchmakingTicketDto(ticket, userId);
            return {
              mode: "pvp" as const,
              matchmakingTicket,
              attempt: matchmakingTicket.match
                ? attemptById.get(matchmakingTicket.match.attemptId) ?? null
                : null,
            };
          }),
        ],
        capabilities: {
          pvpMatchmaking: env.PVP_MATCHMAKING_ENABLED,
          repair: true,
        },
      };
    });
  }

  async listDeveloperApiClients(userId: string): Promise<DeveloperApiClientView[]> {
    return this.withUser(userId, (tx) => this.loadDeveloperApiClients(tx, userId));
  }

  async createDeveloperApiClient(userId: string, input: CreateDeveloperClientRecord): Promise<DeveloperApiClientView> {
    return this.withUser(userId, async (tx) => {
      const users = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT status::text AS status FROM users WHERE id = ${userId}::uuid FOR UPDATE
      `;
      if (users[0]?.status !== "ACTIVE") throw new ApiError("player_inactive", 409, "Inactive player cannot create an API client.");
      const counts = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM api_clients
         WHERE owner_user_id = ${userId}::uuid AND status <> 'REVOKED'::api_client_status
      `;
      if (Number(counts[0]?.count ?? 0) >= 10) {
        throw new ApiError("api_client_limit_reached", 409, "A player may have at most 10 active API clients.");
      }
      await tx.$executeRaw`
        INSERT INTO api_clients
          (id, owner_user_id, client_id, client_secret_hash, name, status, scopes, rate_limit_per_minute, created_at, updated_at)
        VALUES
          (${input.id}::uuid, ${userId}::uuid, ${input.clientId}, ${input.clientSecretHash}, ${input.name},
           'ACTIVE'::api_client_status, ${input.scopes}::text[], ${input.rateLimitPerMinute}, NOW(), NOW())
      `;
      const clients = await this.loadDeveloperApiClients(tx, userId);
      return clients.find((client) => client.id === input.id)!;
    });
  }

  async rotateDeveloperOAuthSecret(
    userId: string,
    apiClientId: string,
    nextSecretHash: string,
    previousSecretExpiresAt: Date,
  ): Promise<DeveloperApiClientView | null> {
    return this.withUser(userId, async (tx) => {
      const updated = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE api_clients
           SET previous_client_secret_hash = client_secret_hash,
               previous_client_secret_expires_at = ${previousSecretExpiresAt},
               client_secret_hash = ${nextSecretHash},
               updated_at = NOW()
         WHERE id = ${apiClientId}::uuid
           AND owner_user_id = ${userId}::uuid
           AND status = 'ACTIVE'::api_client_status
           AND client_secret_hash IS NOT NULL
        RETURNING id::text
      `;
      if (!updated[0]) return null;
      return (await this.loadDeveloperApiClients(tx, userId)).find((client) => client.id === apiClientId) ?? null;
    });
  }

  async revokeDeveloperApiClient(userId: string, apiClientId: string): Promise<boolean> {
    return this.withUser(userId, async (tx) => {
      const clients = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id::text FROM api_clients
         WHERE id = ${apiClientId}::uuid AND owner_user_id = ${userId}::uuid
         FOR UPDATE
      `;
      if (!clients[0]) return false;
      await tx.$executeRaw`
        UPDATE api_keys SET revoked_at = COALESCE(revoked_at, NOW())
         WHERE api_client_id = ${apiClientId}::uuid
      `;
      await tx.$executeRaw`
        UPDATE webhook_subscriptions
           SET status = 'REVOKED'::webhook_status,
               previous_secret_hash = NULL,
               previous_secret_expires_at = NULL,
               updated_at = NOW()
         WHERE api_client_id = ${apiClientId}::uuid
      `;
      await tx.$executeRaw`
        UPDATE api_clients
           SET status = 'REVOKED'::api_client_status,
               client_secret_hash = NULL,
               previous_client_secret_hash = NULL,
               previous_client_secret_expires_at = NULL,
               revoked_at = COALESCE(revoked_at, NOW()),
               updated_at = NOW()
         WHERE id = ${apiClientId}::uuid
      `;
      return true;
    });
  }

  async createDeveloperApiKey(userId: string, input: CreateDeveloperApiKeyRecord): Promise<DeveloperApiClientView | null> {
    return this.withUser(userId, async (tx) => {
      const client = await this.lockDeveloperApiClient(tx, userId, input.apiClientId);
      if (!client || !input.scopes.every((scope) => client.scopes.includes(scope))) return null;
      const counts = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM api_keys
         WHERE api_client_id = ${input.apiClientId}::uuid
           AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())
      `;
      if (Number(counts[0]?.count ?? 0) >= 10) throw new ApiError("api_key_limit_reached", 409, "An API client may have at most 10 active keys.");
      await this.insertDeveloperApiKey(tx, input);
      return (await this.loadDeveloperApiClients(tx, userId)).find((item) => item.id === input.apiClientId) ?? null;
    });
  }

  async rotateDeveloperApiKey(
    userId: string,
    apiClientId: string,
    apiKeyId: string,
    input: CreateDeveloperApiKeyRecord,
    previousKeyExpiresAt: Date,
  ): Promise<DeveloperApiClientView | null> {
    return this.withUser(userId, async (tx) => {
      const client = await this.lockDeveloperApiClient(tx, userId, apiClientId);
      if (!client) return null;
      const previous = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT key.id::text
          FROM api_keys key
         WHERE key.id = ${apiKeyId}::uuid AND key.api_client_id = ${apiClientId}::uuid
           AND key.revoked_at IS NULL AND (key.expires_at IS NULL OR key.expires_at > NOW())
         FOR UPDATE
      `;
      if (!previous[0]) return null;
      await tx.$executeRaw`
        UPDATE api_keys
           SET expires_at = LEAST(COALESCE(expires_at, ${previousKeyExpiresAt}), ${previousKeyExpiresAt})
         WHERE id = ${apiKeyId}::uuid
      `;
      await this.insertDeveloperApiKey(tx, input);
      return (await this.loadDeveloperApiClients(tx, userId)).find((item) => item.id === apiClientId) ?? null;
    });
  }

  async revokeDeveloperApiKey(userId: string, apiClientId: string, apiKeyId: string): Promise<boolean> {
    return this.withUser(userId, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE api_keys key SET revoked_at = COALESCE(key.revoked_at, NOW())
          FROM api_clients client
         WHERE key.id = ${apiKeyId}::uuid AND key.api_client_id = ${apiClientId}::uuid
           AND client.id = key.api_client_id AND client.owner_user_id = ${userId}::uuid
        RETURNING key.id::text
      `;
      return !!rows[0];
    });
  }

  async createDeveloperWebhook(userId: string, input: CreateDeveloperWebhookRecord): Promise<DeveloperApiClientView | null> {
    return this.withUser(userId, async (tx) => {
      if (!await this.lockDeveloperApiClient(tx, userId, input.apiClientId)) return null;
      const counts = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM webhook_subscriptions
         WHERE api_client_id = ${input.apiClientId}::uuid AND status <> 'REVOKED'::webhook_status
      `;
      if (Number(counts[0]?.count ?? 0) >= 10) throw new ApiError("webhook_limit_reached", 409, "An API client may have at most 10 webhook subscriptions.");
      await tx.$executeRaw`
        INSERT INTO webhook_subscriptions
          (id, api_client_id, url, secret_hash, event_types, status, created_at, updated_at)
        VALUES
          (${input.id}::uuid, ${input.apiClientId}::uuid, ${input.url}, ${input.secretHash}, ${input.eventTypes}::text[],
           'ACTIVE'::webhook_status, NOW(), NOW())
      `;
      return (await this.loadDeveloperApiClients(tx, userId)).find((item) => item.id === input.apiClientId) ?? null;
    });
  }

  async rotateDeveloperWebhookSecret(
    userId: string,
    apiClientId: string,
    webhookId: string,
    nextSecretHash: string,
    previousSecretExpiresAt: Date,
  ): Promise<DeveloperApiClientView | null> {
    return this.withUser(userId, async (tx) => {
      if (!await this.lockDeveloperApiClient(tx, userId, apiClientId)) return null;
      const updated = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE webhook_subscriptions
           SET previous_secret_hash = secret_hash,
               previous_secret_expires_at = ${previousSecretExpiresAt},
               secret_hash = ${nextSecretHash},
               updated_at = NOW()
         WHERE id = ${webhookId}::uuid AND api_client_id = ${apiClientId}::uuid
           AND status = 'ACTIVE'::webhook_status
        RETURNING id::text
      `;
      if (!updated[0]) return null;
      return (await this.loadDeveloperApiClients(tx, userId)).find((item) => item.id === apiClientId) ?? null;
    });
  }

  async revokeDeveloperWebhook(userId: string, apiClientId: string, webhookId: string): Promise<boolean> {
    return this.withUser(userId, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE webhook_subscriptions subscription
           SET status = 'REVOKED'::webhook_status,
               previous_secret_hash = NULL,
               previous_secret_expires_at = NULL,
               updated_at = NOW()
          FROM api_clients client
         WHERE subscription.id = ${webhookId}::uuid
           AND subscription.api_client_id = ${apiClientId}::uuid
           AND client.id = subscription.api_client_id
           AND client.owner_user_id = ${userId}::uuid
        RETURNING subscription.id::text
      `;
      return !!rows[0];
    });
  }

  async authenticatePublicApiKey(secretHash: string): Promise<PublicApiPrincipal | null> {
    const rows = await this.prisma.$queryRaw<Array<{ clientId: string; scopes: string[]; rateLimitPerMinute: number }>>`
      SELECT client_id AS "clientId", scopes, rate_limit_per_minute AS "rateLimitPerMinute"
        FROM spacey_authenticate_public_api_key(${secretHash})
    `;
    const principal = rows[0];
    return principal ? { ...principal } : null;
  }

  async authenticatePublicClient(clientId: string, secretHash: string): Promise<PublicApiPrincipal | null> {
    const rows = await this.prisma.$queryRaw<Array<{ clientId: string; scopes: string[]; rateLimitPerMinute: number }>>`
      SELECT client_id AS "clientId", scopes, rate_limit_per_minute AS "rateLimitPerMinute"
        FROM spacey_authenticate_public_oauth_client(${clientId}, ${secretHash})
    `;
    const principal = rows[0];
    return principal ? { ...principal } : null;
  }

  async getActivePublicClient(clientId: string): Promise<PublicApiPrincipal | null> {
    const rows = await this.prisma.$queryRaw<Array<{ clientId: string; scopes: string[]; rateLimitPerMinute: number }>>`
      SELECT client_id AS "clientId", scopes, rate_limit_per_minute AS "rateLimitPerMinute"
        FROM spacey_get_active_public_client(${clientId})
    `;
    const principal = rows[0];
    return principal ? { ...principal } : null;
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
      const current = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
      if (current?.status !== "ACTIVE") {
        throw new ApiError("player_inactive", 401, "Player account is not active.");
      }
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
      await tx.telegramAuthReplay.update({
        where: { initDataHash: input.initDataHash },
        data: { userId },
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

  private modulePresentation(
    definition: { category: string; shape: unknown; stats: unknown } | null | undefined,
    definitionKey: string,
  ): Pick<InventoryItemDto, "category" | "shape" | "stats" | "visualKey"> {
    const rawShape = this.record(definition?.shape);
    const cells = Array.isArray(rawShape.cells)
      ? rawShape.cells.flatMap((cell) => Array.isArray(cell)
          && cell.length === 2
          && Number.isSafeInteger(cell[0])
          && Number.isSafeInteger(cell[1])
        ? [[Number(cell[0]), Number(cell[1])] as [number, number]]
        : [])
      : [];
    const stats = this.record(definition?.stats) as InventoryItemDto["stats"];
    return {
      category: definition?.category || "unknown",
      shape: { cells: cells.length > 0 ? cells : [[0, 0]] },
      stats,
      visualKey: typeof stats.visualKey === "string" && stats.visualKey ? stats.visualKey : definitionKey,
    };
  }

  private walletSnapshot(value: unknown): WalletDto | null {
    const snapshot = this.record(value);
    const keys = ["credits", "scrap", "alloy", "dataShards"] as const;
    if (keys.some((key) => !Number.isSafeInteger(snapshot[key]) || Number(snapshot[key]) < 0)) return null;
    return {
      credits: Number(snapshot.credits),
      scrap: Number(snapshot.scrap),
      alloy: Number(snapshot.alloy),
      dataShards: Number(snapshot.dataShards),
    };
  }

  private progressionSnapshot(value: unknown): BattleResultDto["progressionAfter"] | null {
    const snapshot = this.record(value);
    const researchNodeIds = Array.isArray(snapshot.researchNodeIds)
      ? snapshot.researchNodeIds.filter((key): key is string => typeof key === "string")
      : null;
    const seasonId = snapshot.seasonId === null || typeof snapshot.seasonId === "string" ? snapshot.seasonId : undefined;
    const seasonRating = snapshot.seasonRating === null || Number.isSafeInteger(snapshot.seasonRating)
      ? snapshot.seasonRating as number | null
      : undefined;
    if (!Number.isSafeInteger(snapshot.level)
      || Number(snapshot.level) < 1
      || !Number.isSafeInteger(snapshot.experience)
      || Number(snapshot.experience) < 0
      || !researchNodeIds
      || seasonId === undefined
      || seasonRating === undefined
      || (typeof seasonRating === "number" && seasonRating < 0)) return null;
    return {
      level: Number(snapshot.level),
      experience: Number(snapshot.experience),
      researchNodeIds: [...new Set(researchNodeIds)],
      seasonId,
      seasonRating,
    };
  }

  private mapMissionAttemptStatus(attempt: {
    id: string;
    status: "CREATED" | "CONNECTING" | "ACTIVE" | "PAUSED" | "COMPLETED" | "FAILED" | "ABANDONED";
    reconnectDeadline: Date | null;
    battleSession: { id: string; lastInputSequence: bigint } | null;
    result: { id: string } | null;
  }): MissionAttemptStatusDto {
    if (!attempt.battleSession) {
      throw new ApiError("battle_session_missing", 500, "Mission attempt has no battle session.");
    }
    const statuses = {
      CREATED: "queued",
      CONNECTING: "queued",
      ACTIVE: "active",
      PAUSED: "paused",
      COMPLETED: "completed",
      FAILED: "failed",
      ABANDONED: "failed",
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
        lastAcknowledgedInputSequence: this.safeNumber(attempt.battleSession.lastInputSequence),
      },
    };
  }

  private async loadBattleResult(
    tx: TransactionClient,
    userId: string,
    resultId: string,
  ): Promise<BattleResultDto | null> {
    const result = await tx.missionResult.findFirst({
      where: { id: resultId, missionAttempt: { userId } },
      include: {
        missionAttempt: {
          include: {
            missionDefinition: true,
            replayMetadata: true,
            pvpMatch: { include: { replayMetadata: true } },
          },
        },
      },
    });
    if (!result) return null;
    const attempt = result.missionAttempt;
    const transitionSourceId = attempt.pvpMatchId ?? result.id;
    const rewardsRecord = this.record(result.rewards);
    const metrics = this.record(result.metrics);
    const replayAvailable = Boolean(attempt.replayMetadata || attempt.pvpMatch?.replayMetadata);
    const replayFailed = metrics.cancellation === "no_show_forfeit"
      || metrics.cancellation === "no_contest";
    const walletAfterSnapshot = this.walletSnapshot(rewardsRecord.walletAfter);
    const progressionAfterSnapshot = this.progressionSnapshot(metrics.progressionAfter);
    const [balances, progression, research, seasonParticipant, participant, transitions] = await Promise.all([
      walletAfterSnapshot ? Promise.resolve([]) : tx.walletBalance.findMany({ where: { userId } }),
      progressionAfterSnapshot ? Promise.resolve(null) : tx.playerProgression.findUnique({ where: { userId } }),
      progressionAfterSnapshot ? Promise.resolve([]) : tx.userResearch.findMany({
        where: { userId, status: "COMPLETED" },
        include: { researchDefinition: true },
        orderBy: [{ completedAt: "asc" }, { id: "asc" }],
      }),
      progressionAfterSnapshot ? Promise.resolve(null) : tx.seasonParticipant.findFirst({
        where: { userId, season: { status: "ACTIVE" } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
      attempt.pvpMatchId ? tx.pvpMatchParticipant.findFirst({
        where: { pvpMatchId: attempt.pvpMatchId, userId },
      }) : Promise.resolve(null),
      tx.inventoryTransition.findMany({
        where: {
          userId,
          sourceId: transitionSourceId,
          sourceType: attempt.type === "PVP" ? "PVP_MATCH" : "MISSION_RESULT",
        },
        include: { inventoryItem: true },
        orderBy: [{ inventoryItemId: "asc" }, { createdAt: "asc" }],
      }),
    ]);
    const currencies = Array.isArray(rewardsRecord.currencies)
      ? rewardsRecord.currencies.map((value) => this.record(value))
      : [];
    const rewards: Partial<WalletDto> = {};
    const walletNames = {
      CREDITS: "credits",
      SCRAP: "scrap",
      ALLOY: "alloy",
      DATA_SHARDS: "dataShards",
    } as const;
    for (const currency of currencies) {
      const name = walletNames[String(currency.currency) as keyof typeof walletNames];
      const amount = this.nonnegativeInteger(currency.amount);
      if (name && amount > 0) rewards[name] = amount;
    }
    const grantedItems = Array.isArray(rewardsRecord.items)
      ? rewardsRecord.items.flatMap((value) => {
          const item = this.record(value);
          if (typeof item.inventoryItemId !== "string" || typeof item.definitionKey !== "string") return [];
          const rarity: BattleResultDto["grantedItems"][number]["rarity"] =
            item.rarity === "uncommon" || item.rarity === "superRare" ? item.rarity : "common";
          return [{
            inventoryItemId: item.inventoryItemId,
            definitionId: item.definitionKey,
            rarity,
          }];
        })
      : [];
    const moduleDamage = transitions.flatMap((transition) => {
      const metadata = this.record(transition.metadata);
      const durability = this.record(metadata.durability);
      const authoritativeModule = this.record(metadata.authoritativeModule);
      const before = this.nonnegativeInteger(durability.before);
      const after = this.nonnegativeInteger(durability.after);
      if (before <= after) return [];
      const hpBefore = this.nonnegativeInteger(authoritativeModule.hpBefore);
      const hpAfter = this.nonnegativeInteger(authoritativeModule.hpAfter);
      const hpLoss = this.nonnegativeInteger(authoritativeModule.hpLoss);
      const authoritativeFields = typeof authoritativeModule.moduleId === "string"
        && authoritativeModule.moduleId.length > 0
        && authoritativeModule.inventoryItemId === transition.inventoryItemId
        && hpBefore > 0
        && hpBefore - hpAfter === hpLoss
        && hpLoss > 0
        && typeof authoritativeModule.detached === "boolean"
        ? {
            simulationModuleId: authoritativeModule.moduleId,
            hpBefore,
            hpAfter,
            hpLoss,
            detached: authoritativeModule.detached,
          }
        : {};
      const states = {
        AVAILABLE: "available",
        INSTALLED: "installed",
        DAMAGED: "damaged",
        DESTROYED: "destroyed",
        CONSUMED: "destroyed",
      } as const;
      return [{
        inventoryItemId: transition.inventoryItemId,
        definitionId: transition.inventoryItem.definitionKey,
        ...authoritativeFields,
        durabilityBefore: before,
        durabilityAfter: after,
        damage: before - after,
        state: states[transition.toState],
      }];
    });
    const outcomes = {
      VICTORY: "victory",
      DEFEAT: "defeat",
      DRAW: "draw",
      FORFEIT: "forfeit",
      ERROR: "defeat",
    } as const;
    return {
      id: result.id,
      attemptId: attempt.id,
      mode: attempt.type === "PVP" ? "pvp" : "pve",
      outcome: outcomes[result.outcome],
      reason: typeof metrics.reason === "string" ? metrics.reason : result.outcome.toLowerCase(),
      mission: { id: attempt.missionDefinition.key, name: attempt.missionDefinition.title },
      durationTicks: result.finalTick,
      finalStateHash: result.stateHash,
      rewards,
      grantedItems,
      experience: this.nonnegativeInteger(rewardsRecord.experience),
      walletAfter: walletAfterSnapshot ?? this.mapWallet(balances),
      progressionAfter: progressionAfterSnapshot ?? {
        level: progression?.level ?? 1,
        experience: this.safeNumber(progression?.experience ?? 0n),
        researchNodeIds: research.map((item) => item.researchDefinition.key),
        seasonId: seasonParticipant?.seasonId ?? null,
        seasonRating: seasonParticipant?.rating ?? null,
      },
      moduleDamage,
      mmr: participant ? {
        before: participant.mmrBefore,
        after: participant.mmrAfter ?? participant.mmrBefore,
      } : null,
      replayStatus: replayAvailable ? "available" : replayFailed ? "failed" : "pending",
      finalizedAt: result.finishedAt.toISOString(),
    };
  }

  private async inventoryItemIsInActiveGameplay(tx: TransactionClient, userId: string, inventoryItemId: string) {
    const rows = await tx.$queryRaw<Array<{ active: boolean }>>`
      SELECT (
        EXISTS (
          SELECT 1
          FROM build_revision_items installed
          JOIN mission_attempts attempt ON attempt.build_revision_id = installed.build_revision_id
          WHERE installed.inventory_item_id = ${inventoryItemId}::uuid
            AND attempt.user_id = ${userId}::uuid
            AND attempt.status IN ('CREATED', 'CONNECTING', 'ACTIVE', 'PAUSED')
        ) OR EXISTS (
          SELECT 1
          FROM build_revision_items installed
          JOIN matchmaking_tickets ticket ON ticket.build_revision_id = installed.build_revision_id
          WHERE installed.inventory_item_id = ${inventoryItemId}::uuid
            AND ticket.user_id = ${userId}::uuid
            AND ticket.status IN ('QUEUED', 'MATCHED')
        )
      ) AS active
    `;
    return rows[0]?.active === true;
  }

  private mapRepairQuote(quote: {
    id: string;
    inventoryItemId: string;
    definitionKey: string;
    durabilityBefore: number;
    cost: bigint;
    expiresAt: Date;
  }): RepairQuoteDto {
    return {
      id: quote.id,
      inventoryItemId: quote.inventoryItemId,
      definitionId: quote.definitionKey,
      durabilityBefore: quote.durabilityBefore,
      durabilityAfter: 10_000,
      currency: "credits",
      cost: this.safeNumber(quote.cost),
      expiresAt: quote.expiresAt.toISOString(),
    };
  }

  private async loadCommittedRepair(
    tx: TransactionClient,
    userId: string,
    quoteId: string,
    inventoryItemId: string,
    ledgerEntryId: string,
    repairedAt: Date,
  ): Promise<RepairResultDto> {
    const [item, balances, currentBuild] = await Promise.all([
      tx.inventoryItem.findFirst({
        where: { id: inventoryItemId, userId },
        include: {
          contentRelease: {
            include: {
              moduleDefinitions: { select: { key: true, category: true, rarity: true, shape: true, stats: true } },
            },
          },
        },
      }),
      tx.walletBalance.findMany({ where: { userId } }),
      tx.shipBuild.findFirst({
        where: { userId, status: "ACTIVE" },
        include: { currentRevision: { include: { installedItems: true } } },
      }),
    ]);
    if (!item) throw new ApiError("inventory_item_not_found", 404, "Repaired inventory item not found.");
    const definition = item.contentRelease.moduleDefinitions.find((candidate) => candidate.key === item.definitionKey);
    const itemMetadata = this.record(item.metadata);
    const rarity = itemMetadata.rarity === "uncommon" || itemMetadata.rarity === "superRare"
      ? itemMetadata.rarity
      : definition?.rarity === "uncommon" || definition?.rarity === "superRare"
        ? definition.rarity
        : "common";
    const states = {
      AVAILABLE: "available",
      INSTALLED: "installed",
      DAMAGED: "damaged",
      DESTROYED: "destroyed",
      CONSUMED: "destroyed",
    } as const;
    const installedBuildRevisionId = currentBuild?.currentRevision?.installedItems.some(
      (installed) => installed.inventoryItemId === item.id,
    ) ? currentBuild.currentRevision.id : null;
    return {
      quoteId,
      inventoryItem: {
        id: item.id,
        definitionId: item.definitionKey,
        contentVersion: item.contentRelease.version,
        rarity,
        state: states[item.state],
        durability: item.durability,
        ...this.modulePresentation(definition, item.definitionKey),
        installedBuildRevisionId,
        createdAt: item.createdAt.toISOString(),
      },
      walletAfter: this.mapWallet(balances),
      ledgerEntryId,
      repairedAt: repairedAt.toISOString(),
    };
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
    const objectiveType = ["destroy_all", "survive_seconds", "collect_scrap", "protect_target"]
      .includes(String(objective.type))
      ? String(objective.type) as "destroy_all" | "survive_seconds" | "collect_scrap" | "protect_target"
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

  private mapMatchmakingTicketDto(ticket: Parameters<PrismaPlatformRepository["mapMatchmakingTicket"]>[0], userId: string): MatchmakingTicketDto {
    const record = this.mapMatchmakingTicket(ticket, userId);
    return {
      id: record.ticketId,
      queue: record.queue,
      region: record.region,
      mmr: record.mmr,
      status: record.status,
      createdAt: record.createdAt.toISOString(),
      expiresAt: record.expiresAt.toISOString(),
      match: record.match ? {
        matchId: record.match.matchId,
        sessionId: record.match.sessionId,
        attemptId: record.match.attemptId,
        runtimeState: PVP_DUEL_PROTOCOL_READY ? "ready" : "duel_protocol_unavailable",
        connection: null,
      } : null,
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

  private async loadDeveloperApiClients(tx: TransactionClient, userId: string): Promise<DeveloperApiClientView[]> {
    const [clients, keys, webhooks] = await Promise.all([
      tx.$queryRaw<DeveloperClientRow[]>`
        SELECT id::text, client_id AS "clientId", name, status::text, scopes,
               rate_limit_per_minute AS "rateLimitPerMinute",
               CASE WHEN previous_client_secret_expires_at > NOW()
                    THEN previous_client_secret_expires_at ELSE NULL END AS "previousOAuthSecretValidUntil",
               created_at AS "createdAt", updated_at AS "updatedAt"
          FROM api_clients
         WHERE owner_user_id = ${userId}::uuid
         ORDER BY created_at, id
      `,
      tx.$queryRaw<DeveloperApiKeyRow[]>`
        SELECT key.id::text, key.api_client_id::text AS "apiClientId", key.key_prefix AS "keyPrefix",
               key.name, key.scopes, key.last_used_at AS "lastUsedAt", key.expires_at AS "expiresAt",
               key.revoked_at AS "revokedAt", key.created_at AS "createdAt"
          FROM api_keys key
          JOIN api_clients client ON client.id = key.api_client_id
         WHERE client.owner_user_id = ${userId}::uuid
         ORDER BY key.created_at, key.id
      `,
      tx.$queryRaw<DeveloperWebhookRow[]>`
        SELECT subscription.id::text, subscription.api_client_id::text AS "apiClientId", subscription.url,
               subscription.event_types AS "eventTypes", subscription.status::text,
               CASE WHEN subscription.previous_secret_expires_at > NOW()
                    THEN subscription.previous_secret_expires_at ELSE NULL END AS "previousSecretValidUntil",
               subscription.created_at AS "createdAt", subscription.updated_at AS "updatedAt"
          FROM webhook_subscriptions subscription
          JOIN api_clients client ON client.id = subscription.api_client_id
         WHERE client.owner_user_id = ${userId}::uuid
         ORDER BY subscription.created_at, subscription.id
      `,
    ]);
    return clients.map((client) => ({
      id: client.id,
      clientId: client.clientId,
      name: client.name,
      status: client.status.toLowerCase() as DeveloperApiClientView["status"],
      scopes: client.scopes as PublicApiScope[],
      rateLimitPerMinute: client.rateLimitPerMinute,
      previousOAuthSecretValidUntil: client.previousOAuthSecretValidUntil?.toISOString() ?? null,
      createdAt: client.createdAt.toISOString(),
      updatedAt: client.updatedAt.toISOString(),
      apiKeys: keys.filter((key) => key.apiClientId === client.id).map((key): DeveloperApiKeyView => ({
        id: key.id,
        keyPrefix: key.keyPrefix,
        name: key.name,
        scopes: key.scopes as PublicApiScope[],
        lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
        expiresAt: key.expiresAt?.toISOString() ?? null,
        revokedAt: key.revokedAt?.toISOString() ?? null,
        createdAt: key.createdAt.toISOString(),
      })),
      webhooks: webhooks.filter((webhook) => webhook.apiClientId === client.id).map((webhook): DeveloperWebhookView => ({
        id: webhook.id,
        url: webhook.url,
        eventTypes: webhook.eventTypes as PublicWebhookEventType[],
        status: webhook.status.toLowerCase() as DeveloperWebhookView["status"],
        previousSecretValidUntil: webhook.previousSecretValidUntil?.toISOString() ?? null,
        createdAt: webhook.createdAt.toISOString(),
        updatedAt: webhook.updatedAt.toISOString(),
      })),
    }));
  }

  private async lockDeveloperApiClient(tx: TransactionClient, userId: string, apiClientId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string; scopes: string[] }>>`
      SELECT id::text, scopes FROM api_clients
       WHERE id = ${apiClientId}::uuid AND owner_user_id = ${userId}::uuid
         AND status = 'ACTIVE'::api_client_status
       FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  private async insertDeveloperApiKey(tx: TransactionClient, input: CreateDeveloperApiKeyRecord) {
    await tx.$executeRaw`
      INSERT INTO api_keys
        (id, api_client_id, key_prefix, secret_hash, name, scopes, expires_at, created_at)
      VALUES
        (${input.id}::uuid, ${input.apiClientId}::uuid, ${input.keyPrefix}, ${input.secretHash}, ${input.name},
         ${input.scopes}::text[], ${input.expiresAt}, NOW())
    `;
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
  }): Promise<MissionAttemptRecord> {
    const scopedIdempotencyKey = this.hashText(`mission-attempt:${input.userId}:${input.idempotencyKey}`);
    const requestHash = this.hashJson({
      missionId: input.missionId,
      shipBuildRevisionId: input.shipBuildRevisionId,
    });
    try {
      return await this.withUser(input.userId, async (tx) => {
      await tx.$queryRaw`
        SELECT id
        FROM mission_attempts
        WHERE idempotency_key = ${scopedIdempotencyKey}
        FOR UPDATE
      `;
      const existing = await tx.missionAttempt.findUnique({
        where: { idempotencyKey: scopedIdempotencyKey },
        include: { battleSession: true }
      });
      if (existing?.battleSession) {
        if (existing.requestHash !== requestHash) {
          throw new ApiError("idempotency_key_reused", 409, "Idempotency key was reused with another request.");
        }
        return {
          attemptId: existing.id,
          sessionId: existing.battleSession.id,
          mode: "pve",
          simulationConfig: await this.loadSimulationConfig(tx, existing.id),
          previousTicketHash: existing.wsTicketHash,
          ticketVersion: existing.ticketVersion,
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
          ticketVersion: 0,
          idempotencyKey: scopedIdempotencyKey,
          requestHash,
        }
      });
      const simulationConfig = await this.buildMissionSimulationConfig(tx, attemptId, sessionId);
      await tx.battleSession.create({
        data: {
          id: sessionId,
          missionAttemptId: attemptId,
          contentReleaseId: mission.contentReleaseId,
          simulationVersion: SIMULATION_VERSION,
          simulationConfig,
          simulationConfigHash: this.hashJson(simulationConfig),
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
        simulationConfig,
        previousTicketHash: null,
        ticketVersion: 0,
      };
      });
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      return this.withUser(input.userId, async (tx) => {
        await tx.$queryRaw`
          SELECT id
          FROM mission_attempts
          WHERE idempotency_key = ${scopedIdempotencyKey}
          FOR UPDATE
        `;
        const winner = await tx.missionAttempt.findUnique({
          where: { idempotencyKey: scopedIdempotencyKey },
          include: { battleSession: true },
        });
        if (!winner?.battleSession) throw error;
        if (winner.requestHash !== requestHash) {
          throw new ApiError("idempotency_key_reused", 409, "Idempotency key was reused with another request.");
        }
        return {
          attemptId: winner.id,
          sessionId: winner.battleSession.id,
          mode: "pve",
          simulationConfig: await this.loadSimulationConfig(tx, winner.id),
          previousTicketHash: winner.wsTicketHash,
          ticketVersion: winner.ticketVersion,
        };
      });
    }
  }

  async renewMissionAttemptTicket(input: {
    userId: string;
    attemptId: string;
    ticketHash: string;
    ticketExpiresAt: Date;
  }): Promise<MissionAttemptRecord | null> {
    return this.withUser(input.userId, async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM mission_attempts
        WHERE id = ${input.attemptId}::uuid
          AND user_id = ${input.userId}::uuid
          AND type = 'PVE'::mission_attempt_type
        FOR UPDATE
      `;
      if (!locked[0]) return null;
      const attempt = await tx.missionAttempt.findFirst({
        where: { id: input.attemptId, userId: input.userId, type: "PVE" },
        include: { battleSession: true, result: true }
      });
      if (!attempt?.battleSession || attempt.result || ["COMPLETED", "FAILED", "ABANDONED"].includes(attempt.status)) return null;
      if (attempt.reconnectDeadline && attempt.reconnectDeadline <= new Date()) return null;
      const rotated = await tx.missionAttempt.update({
        where: { id: attempt.id },
        data: {
          wsTicketHash: input.ticketHash,
          wsTicketExpiresAt: input.ticketExpiresAt,
          ticketVersion: { increment: 1 },
          status: attempt.status === "PAUSED" ? "CONNECTING" : attempt.status
        },
        select: { ticketVersion: true },
      });
      if (attempt.status === "PAUSED") {
        await tx.battleSession.update({ where: { id: attempt.battleSession.id }, data: { status: "RECOVERING" } });
      }
      return {
        attemptId: attempt.id,
        sessionId: attempt.battleSession.id,
        mode: "pve",
        simulationConfig: await this.loadSimulationConfig(tx, attempt.id),
        previousTicketHash: attempt.wsTicketHash,
        ticketVersion: rotated.ticketVersion,
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
      return this.mapMissionAttemptStatus(attempt);
    });
  }

  async abandonMissionAttempt(userId: string, attemptId: string): Promise<MissionAttemptStatusDto | null> {
    return this.withUser(userId, async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM mission_attempts
        WHERE id = ${attemptId}::uuid
          AND user_id = ${userId}::uuid
          AND type = 'PVE'::mission_attempt_type
        FOR UPDATE
      `;
      if (!locked[0]) return null;
      const attempt = await tx.missionAttempt.findFirst({
        where: { id: attemptId, userId, type: "PVE" },
        include: { battleSession: true, result: true },
      });
      if (!attempt?.battleSession) return null;
      if (attempt.result || ["COMPLETED", "FAILED", "ABANDONED"].includes(attempt.status)) {
        return this.mapMissionAttemptStatus(attempt);
      }
      await tx.missionAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "ABANDONED",
          endedAt: new Date(),
          disconnectedAt: null,
          reconnectDeadline: null,
          wsTicketHash: null,
          wsTicketExpiresAt: null,
        },
      });
      await tx.battleSession.update({
        where: { id: attempt.battleSession.id },
        data: { status: "ENDED", endedAt: new Date() },
      });
      const abandoned = await tx.missionAttempt.findUnique({
        where: { id: attempt.id },
        include: { battleSession: true, result: true },
      });
      return abandoned?.battleSession ? this.mapMissionAttemptStatus(abandoned) : null;
    });
  }

  async getBattleResult(userId: string, resultId: string): Promise<BattleResultDto | null> {
    return this.withUser(userId, (tx) => this.loadBattleResult(tx, userId, resultId));
  }

  async listBattleResults(userId: string, cursor: string | null, limit: number): Promise<BattleResultPageDto> {
    return this.withUser(userId, async (tx) => {
      const boundedLimit = Math.max(1, Math.min(50, limit));
      const cursorRow = cursor ? await tx.missionResult.findFirst({
        where: { id: cursor, missionAttempt: { userId } },
        select: { id: true, finishedAt: true },
      }) : null;
      if (cursor && !cursorRow) throw new ApiError("result_cursor_invalid", 400, "Battle result cursor is invalid.");
      const rows = await tx.missionResult.findMany({
        where: {
          missionAttempt: { userId },
          ...(cursorRow ? {
            OR: [
              { finishedAt: { lt: cursorRow.finishedAt } },
              { finishedAt: cursorRow.finishedAt, id: { lt: cursorRow.id } },
            ],
          } : {}),
        },
        orderBy: [{ finishedAt: "desc" }, { id: "desc" }],
        select: { id: true },
        take: boundedLimit + 1,
      });
      const pageRows = rows.slice(0, boundedLimit);
      const loaded = await Promise.all(pageRows.map((row) => this.loadBattleResult(tx, userId, row.id)));
      const items = loaded.filter((result): result is BattleResultDto => result !== null);
      return {
        items,
        nextCursor: rows.length > boundedLimit ? pageRows.at(-1)?.id ?? null : null,
      };
    });
  }

  async createRepairQuote(userId: string, input: CreateRepairQuoteRequestDto): Promise<RepairQuoteDto> {
    const requestHash = this.hashJson({ inventoryItemId: input.inventoryItemId });
    try {
      return await this.withUser(userId, async (tx) => {
        const existing = await tx.repairQuote.findUnique({
          where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
        });
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw new ApiError("idempotency_key_reused", 409, "Idempotency key was reused with another repair quote request.");
          }
          if (existing.status !== "ACTIVE" || existing.expiresAt <= new Date()) {
            throw new ApiError("repair_quote_expired", 409, "Repair quote is no longer active.");
          }
          return this.mapRepairQuote(existing);
        }

        const item = await tx.inventoryItem.findFirst({
          where: { id: input.inventoryItemId, userId },
          include: { contentRelease: true },
        });
        if (!item) throw new ApiError("inventory_item_not_found", 404, "Inventory item not found.");
        if (item.state !== "DAMAGED" || item.durability <= 0 || item.durability >= 10_000) {
          throw new ApiError("inventory_item_not_repairable", 409, "Only a damaged, non-destroyed item can be repaired.");
        }
        const inUse = await this.inventoryItemIsInActiveGameplay(tx, userId, item.id);
        if (inUse) throw new ApiError("inventory_item_in_active_gameplay", 409, "An item in active gameplay cannot be repaired.");
        const definition = await tx.moduleDefinition.findUnique({
          where: {
            contentReleaseId_key: {
              contentReleaseId: item.contentReleaseId,
              key: item.definitionKey,
            },
          },
          select: { stats: true },
        });
        const configuredFullCost = this.positiveInteger(this.record(definition?.stats).repairCostCredits, 0);
        if (!definition || configuredFullCost <= 0) {
          throw new ApiError("repair_price_unavailable", 503, "Published module content does not define a repair price.");
        }
        const now = new Date();
        const quote = await tx.repairQuote.create({
          data: {
            id: createUuidV7(),
            userId,
            inventoryItemId: item.id,
            definitionKey: item.definitionKey,
            durabilityBefore: item.durability,
            currency: "CREDITS",
            cost: BigInt(fullRepairCost(configuredFullCost, item.durability)),
            requestHash,
            idempotencyKey: input.idempotencyKey,
            expiresAt: new Date(now.getTime() + 5 * 60_000),
          },
        });
        return this.mapRepairQuote(quote);
      });
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      return this.withUser(userId, async (tx) => {
        const winner = await tx.repairQuote.findUnique({
          where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
        });
        if (!winner) throw error;
        if (winner.requestHash !== requestHash) {
          throw new ApiError("idempotency_key_reused", 409, "Idempotency key was reused with another repair quote request.");
        }
        if (winner.status !== "ACTIVE" || winner.expiresAt <= new Date()) {
          throw new ApiError("repair_quote_expired", 409, "Repair quote is no longer active.");
        }
        return this.mapRepairQuote(winner);
      });
    }
  }

  async commitRepair(userId: string, input: CommitRepairRequestDto): Promise<RepairResultDto> {
    const scopedCommitKey = this.hashText(`repair-commit:${userId}:${input.idempotencyKey}`);
    const commitRequestHash = this.hashJson({ quoteId: input.quoteId });
    try {
      return await this.withUser(userId, async (tx) => {
      const locked = await tx.$queryRaw<Array<{
        id: string;
        status: string;
        expires_at: Date;
        inventory_item_id: string;
        durability_before: number;
        cost: bigint;
        commit_idempotency_key: string | null;
        commit_request_hash: string | null;
        ledger_entry_id: string | null;
        committed_at: Date | null;
      }>>`
        SELECT id, status::text, expires_at, inventory_item_id, durability_before, cost,
               commit_idempotency_key, commit_request_hash, ledger_entry_id, committed_at
        FROM repair_quotes
        WHERE id = ${input.quoteId}::uuid AND user_id = ${userId}::uuid
        FOR UPDATE
      `;
      const quote = locked[0];
      if (!quote) throw new ApiError("repair_quote_not_found", 404, "Repair quote not found.");
      if (quote.status === "COMMITTED") {
        if (quote.commit_idempotency_key !== scopedCommitKey
          || quote.commit_request_hash !== commitRequestHash
          || !quote.ledger_entry_id
          || !quote.committed_at) {
          throw new ApiError("repair_quote_already_committed", 409, "Repair quote was committed by another command.");
        }
        return this.loadCommittedRepair(tx, userId, quote.id, quote.inventory_item_id, quote.ledger_entry_id, quote.committed_at);
      }
      if (quote.status !== "ACTIVE" || quote.expires_at <= new Date()) {
        throw new ApiError("repair_quote_expired", 409, "Repair quote has expired.");
      }

      const items = await tx.$queryRaw<Array<{
        id: string;
        definition_key: string;
        durability: number;
        state: string;
        content_release_id: string;
        created_at: Date;
      }>>`
        SELECT id, definition_key, durability, state::text, content_release_id, created_at
        FROM inventory_items
        WHERE id = ${quote.inventory_item_id}::uuid AND user_id = ${userId}::uuid
        FOR UPDATE
      `;
      const item = items[0];
      if (!item || item.state !== "DAMAGED" || item.durability !== quote.durability_before) {
        throw new ApiError("repair_quote_stale", 409, "Inventory item changed after the quote was issued.");
      }
      if (await this.inventoryItemIsInActiveGameplay(tx, userId, item.id)) {
        throw new ApiError("inventory_item_in_active_gameplay", 409, "An item in active gameplay cannot be repaired.");
      }

      const balances = await tx.$queryRaw<Array<{ id: string; balance: bigint }>>`
        SELECT id, balance
        FROM wallet_balances
        WHERE user_id = ${userId}::uuid AND currency = 'CREDITS'::wallet_currency
        FOR UPDATE
      `;
      const balance = balances[0];
      if (!balance || balance.balance < quote.cost) {
        throw new ApiError("wallet_balance_insufficient", 409, "Not enough credits for this repair.");
      }
      const nextBalance = balance.balance - quote.cost;
      await tx.walletBalance.update({
        where: { id: balance.id },
        data: { balance: nextBalance, version: { increment: 1 } },
      });
      const currentInstall = await tx.$queryRaw<Array<{ installed: boolean }>>`
        SELECT EXISTS (
          SELECT 1
          FROM build_revision_items installed
          JOIN ship_builds build ON build.current_revision_id = installed.build_revision_id
          WHERE installed.inventory_item_id = ${item.id}::uuid
            AND build.user_id = ${userId}::uuid
            AND build.status = 'ACTIVE'::build_status
        ) AS installed
      `;
      const nextState = currentInstall[0]?.installed ? "INSTALLED" as const : "AVAILABLE" as const;
      await tx.inventoryItem.update({
        where: { id: item.id },
        data: { durability: 10_000, state: nextState },
      });
      const ledgerEntryId = createUuidV7();
      const repairedAt = new Date();
      await tx.walletLedgerEntry.create({
        data: {
          id: ledgerEntryId,
          userId,
          walletBalanceId: balance.id,
          currency: "CREDITS",
          delta: -quote.cost,
          balanceAfter: nextBalance,
          sourceType: "REPAIR",
          sourceId: quote.id,
          idempotencyKey: this.hashText(`repair:${userId}:${input.idempotencyKey}`),
          metadata: { quoteId: quote.id, inventoryItemId: item.id },
        },
      });
      await tx.inventoryTransition.create({
        data: {
          id: createUuidV7(),
          userId,
          inventoryItemId: item.id,
          fromState: "DAMAGED",
          toState: nextState,
          sourceType: "REPAIR",
          sourceId: quote.id,
          idempotencyKey: this.hashText(`repair-item:${quote.id}`),
          metadata: { durability: { before: item.durability, after: 10_000 }, cost: quote.cost.toString() },
        },
      });
      await tx.repairQuote.update({
        where: { id: quote.id },
        data: {
          status: "COMMITTED",
          commitIdempotencyKey: scopedCommitKey,
          commitRequestHash,
          ledgerEntryId,
          committedAt: repairedAt,
        },
      });
      return this.loadCommittedRepair(tx, userId, quote.id, item.id, ledgerEntryId, repairedAt);
      });
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      return this.withUser(userId, async (tx) => {
        const winner = await tx.repairQuote.findFirst({
          where: { userId, commitIdempotencyKey: scopedCommitKey },
        });
        if (!winner) throw error;
        if (winner.id !== input.quoteId
          || winner.commitRequestHash !== commitRequestHash
          || !winner.ledgerEntryId
          || !winner.committedAt) {
          throw new ApiError("idempotency_key_reused", 409, "Idempotency key was reused with another repair command.");
        }
        return this.loadCommittedRepair(
          tx,
          userId,
          winner.id,
          winner.inventoryItemId,
          winner.ledgerEntryId,
          winner.committedAt,
        );
      });
    }
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
      const runtime = await this.withUser(input.callerUserId, async (tx) => {
        const materialized = await tx.$queryRaw<Array<{
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
        `;
        const created = materialized[0];
        if (!created) return { materialized, simulationConfig: null, createdAt: null };
        const simulationConfig = await this.buildDuelSimulationConfig(
          tx,
          created.match_id,
          created.battle_session_id,
        );
        const session = await tx.battleSession.update({
          where: { id: created.battle_session_id },
          data: {
            simulationConfig,
            simulationConfigHash: this.hashJson(simulationConfig),
          },
          select: { createdAt: true },
        });
        return { materialized, simulationConfig, createdAt: session.createdAt };
      });
      const row = runtime.materialized[0];
      if (!row || !runtime.simulationConfig || !runtime.createdAt) {
        throw new ApiError("matchmaking_materialization_failed", 500, "PvP match was not materialized.");
      }
      const participants = runtime.simulationConfig.participants.map((participant) => ({
        userId: participant.userId,
        attemptId: participant.side === "alpha" ? row.left_attempt_id : row.right_attempt_id,
        participantId: participant.participantId,
        side: participant.side === "alpha" ? 0 as const : 1 as const,
      }));
      return {
        matchId: row.match_id,
        sessionId: row.battle_session_id,
        tickets: [
          { ticketId: row.left_ticket_id, attemptId: row.left_attempt_id },
          { ticketId: row.right_ticket_id, attemptId: row.right_attempt_id },
        ],
        participants,
        simulationConfig: runtime.simulationConfig,
        readyDeadlineAtMs: runtime.createdAt.getTime() + 20_000,
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
      const simulationConfig = await this.loadDuelSimulationConfig(tx, first.match_id, first.battle_session_id);
      const own = rows.find((row) => row.user_id === input.userId);
      if (!own) throw new ApiError("pvp_participant_missing", 500, "Player is not a PvP participant.");
      const rotated = await tx.missionAttempt.update({
        where: { id: own.attempt_id },
        data: { ticketVersion: { increment: 1 } },
        select: { ticketVersion: true },
      });
      return {
        ticketId: input.ticketId,
        sessionId: first.battle_session_id,
        attemptId: own.attempt_id,
        userId: own.user_id,
        matchId: first.match_id,
        participantId: own.participant_id,
        side: own.side as 0 | 1,
        previousTicketHash: own.previous_ticket_hash,
        ticketVersion: rotated.ticketVersion,
        simulationConfig,
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
      // PostgreSQL returns `void`; cast it before Prisma attempts to decode the
      // result, while preserving the function's locking and validation errors.
      await tx.$queryRaw`SELECT spacey_assert_owned_build_launchable(${buildRevisionId}::uuid)::text AS result`;
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
    const session = await tx.battleSession.findUnique({
      where: { missionAttemptId: attemptId },
      select: { id: true, simulationConfig: true, simulationConfigHash: true },
    });
    if (!session) throw new ApiError("battle_session_missing", 500, "Battle session was not created.");
    if (session.simulationConfigHash !== "0".repeat(64)) {
      return this.storedMissionSimulationConfig(session);
    }

    const simulationConfig = await this.buildMissionSimulationConfig(tx, attemptId, session.id);
    await tx.battleSession.update({
      where: { id: session.id },
      data: {
        simulationConfig,
        simulationConfigHash: this.hashJson(simulationConfig),
      },
    });
    return simulationConfig;
  }

  private async buildMissionSimulationConfig(
    tx: TransactionClient,
    attemptId: string,
    sessionId: string,
  ): Promise<MissionSimulationConfig> {
    const attempt = await tx.missionAttempt.findUnique({
      where: { id: attemptId },
      include: {
        contentRelease: true,
        missionDefinition: true,
        buildRevision: { include: { installedItems: { include: { inventoryItem: true } } } }
      }
    });
    if (!attempt) throw new ApiError("mission_attempt_missing", 500, "Mission attempt was not created.");
    if (attempt.simulationVersion !== SIMULATION_VERSION) {
      throw new ApiError("simulation_version_unsupported", 500, "Mission attempt uses an unsupported simulation version.");
    }
    const definitionKeys = attempt.buildRevision.installedItems.map((item) => item.inventoryItem.definitionKey);
    const moduleDefinitions = await tx.moduleDefinition.findMany({
      where: { contentReleaseId: attempt.contentReleaseId, key: { in: definitionKeys }, enabled: true }
    });
    const objective = this.record(attempt.missionDefinition.objective);
    const roster = Array.isArray(attempt.missionDefinition.enemyRoster)
      ? attempt.missionDefinition.enemyRoster.map((value) => this.record(value))
      : [];
    const enemyKeys = roster
      .map((entry) => typeof entry.definitionKey === "string" ? entry.definitionKey : "")
      .filter(Boolean);
    const enemyDefinitions = await tx.enemyDefinition.findMany({
      where: { contentReleaseId: attempt.contentReleaseId, key: { in: enemyKeys }, enabled: true }
    });
    const moduleDefinitionMap = new Map(moduleDefinitions.map((definition) => [definition.key, definition]));
    if (moduleDefinitionMap.size !== new Set(definitionKeys).size) {
      throw new ApiError("mission_content_invalid", 503, "Build references an unavailable module definition.");
    }
    const enemyDefinitionMap = new Map(enemyDefinitions.map((definition) => [definition.key, definition]));
    if (enemyDefinitionMap.size !== new Set(enemyKeys).size) {
      throw new ApiError("mission_content_invalid", 503, "Mission enemy roster references an unavailable definition.");
    }
    const enemyRoster = this.missionEnemyRoster(roster, enemyDefinitionMap);
    const enemyCount = enemyRoster.reduce((sum, entry) => sum + entry.count, 0);
    const objectiveConfig = this.missionObjectiveConfig(
      objective,
      enemyCount,
      attempt.missionDefinition.durationSeconds,
    );
    return {
      sessionId,
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
      enemyRoster,
      player: this.missionShipStats(attempt.buildRevision.installedItems, moduleDefinitionMap),
    };
  }

  private missionEnemyRoster(
    roster: Record<string, unknown>[],
    definitions: Map<string, { key: string; stats: unknown }>,
  ): EnemySimulationRosterEntry[] {
    return roster.map((entry, index) => {
      const definitionKey = typeof entry.definitionKey === "string" ? entry.definitionKey : "";
      const definition = definitions.get(definitionKey);
      const count = this.positiveInteger(entry.count, 0);
      if (!definition || count <= 0) {
        throw new ApiError("mission_content_invalid", 503, `Enemy roster entry ${index} is invalid.`);
      }
      const stats = this.record(definition.stats);
      return {
        definitionKey,
        count,
        stats: {
          hull: this.positiveInteger(stats.hp, 80),
          speedUnitsPerSecond: this.positiveInteger(stats.speed, 180),
          collisionRadiusUnits: this.positiveInteger(stats.collisionRadius, 20),
          attackDamage: this.positiveInteger(stats.damage, 8),
          attackRangeUnits: this.positiveInteger(stats.attackRange, 260),
          attackCooldownTicks: this.positiveInteger(stats.attackCooldownTicks, 30),
        },
      };
    });
  }

  private missionObjectiveConfig(
    objective: Record<string, unknown>,
    enemyCount: number,
    durationSeconds: number,
  ): MissionSimulationConfig["objective"] {
    const target = this.positiveInteger(objective.target, 0);
    switch (objective.type) {
      case "destroy_all":
        if (enemyCount <= 0 || target !== enemyCount) {
          throw new ApiError("mission_content_invalid", 503, "Destroy-all target must equal the complete enemy roster.");
        }
        return { type: "destroy_all", targetKills: target };
      case "survive_seconds":
        if (target <= 0 || target > durationSeconds) {
          throw new ApiError("mission_content_invalid", 503, "Survival target must fit the mission duration.");
        }
        return { type: "survive_seconds", targetSeconds: target };
      case "protect_target":
        if (target <= 0 || target > durationSeconds) {
          throw new ApiError("mission_content_invalid", 503, "Protect-target duration is invalid.");
        }
        return {
          type: "protect_target",
          targetSeconds: target,
          targetHull: this.positiveInteger(objective.targetHull, 600),
          collisionRadiusUnits: this.positiveInteger(objective.collisionRadiusUnits, 48),
        };
      case "collect_scrap": {
        const scrapCount = this.positiveInteger(objective.scrapCount, target);
        if (target <= 0 || scrapCount < target) {
          throw new ApiError("mission_content_invalid", 503, "Collect-scrap population cannot be smaller than its target.");
        }
        return {
          type: "collect_scrap",
          targetScrap: target,
          scrapCount,
          collectionRadiusUnits: this.positiveInteger(objective.collectionRadiusUnits, 32),
        };
      }
      default:
        throw new ApiError("mission_content_invalid", 503, `Objective ${String(objective.type)} is not supported by ${SIMULATION_VERSION}.`);
    }
  }

  private missionShipStats(
    installedItems: Array<{
      inventoryItemId: string;
      placement: unknown;
      inventoryItem: { definitionKey: string };
    }>,
    definitions: Map<string, { key: string; category: string; kind: string; stats: unknown }>,
  ): ShipSimulationStats {
    const parts = installedItems.map((item) => {
      const definition = definitions.get(item.inventoryItem.definitionKey);
      if (!definition) throw new ApiError("mission_content_invalid", 503, "Installed module definition is unavailable.");
      return {
        id: item.inventoryItemId,
        definition,
        stats: this.record(definition.stats),
        placement: this.placement(item.placement),
      };
    }).sort((left, right) =>
      left.placement.gridY - right.placement.gridY
      || left.placement.gridX - right.placement.gridX
      || this.compareStableId(left.id, right.id)
    );
    if (parts.length === 0) throw new ApiError("mission_content_invalid", 503, "Ship build has no installed modules.");

    const categoryById = new Map(parts.map((part) => [part.id, this.simulationModuleCategory(part.definition)]));
    const parentById = this.moduleParents(parts, categoryById);
    const modules = parts.map((part) => {
      const category = categoryById.get(part.id) ?? "utility";
      const powerDraw = this.nonnegativeInteger(part.stats.powerDrawPerSecond ?? part.stats.powerDraw);
      const heatGeneration = this.nonnegativeInteger(part.stats.heatGenerationPerSecond);
      return {
        id: part.id,
        inventoryItemId: part.id,
        visualKey: typeof part.stats.visualKey === "string" && part.stats.visualKey
          ? part.stats.visualKey
          : part.definition.key,
        category,
        hp: this.positiveInteger(part.stats.hp, 1),
        gridX: part.placement.gridX,
        gridY: part.placement.gridY,
        ...(parentById.get(part.id) ? { parentModuleId: parentById.get(part.id) } : {}),
        collisionRadiusUnits: this.positiveInteger(part.stats.collisionRadius, 12),
        powerDemandPerTick: powerDraw > 0 ? Math.max(1, Math.ceil(powerDraw / 30)) : 0,
        powerPriority: this.modulePowerPriority(category),
        heatGenerationPerTick: heatGeneration > 0 ? Math.max(1, Math.ceil(heatGeneration / 30)) : 0,
      };
    });
    const weaponParts = parts.filter((part) => this.nonnegativeInteger(part.stats.damage) > 0);
    if (weaponParts.length === 0 || weaponParts.length > 31) {
      throw new ApiError("mission_content_invalid", 503, "Ship build must contain between one and 31 weapons.");
    }
    const weapons = weaponParts.map((part, index) => ({
      id: `weapon-${part.id}`,
      moduleId: part.id,
      damage: this.positiveInteger(part.stats.damage, 1),
      rangeUnits: this.positiveInteger(part.stats.range, 420),
      cooldownTicks: Math.max(1, Math.ceil(this.positiveInteger(part.stats.cooldownMs, 500) * 30 / 1_000)),
      projectileSpeedUnitsPerSecond: this.positiveInteger(part.stats.projectileSpeed, 600),
      energyCost: this.nonnegativeInteger(part.stats.energyCost ?? part.stats.powerDraw),
      heatPerShot: this.nonnegativeInteger(part.stats.heatPerShot),
      actionFlag: 2 ** index,
    }));
    const hull = Math.max(1, parts.reduce((sum, part) => sum + this.positiveInteger(part.stats.hp, 1), 0));
    const thrust = parts.reduce((sum, part) =>
      sum + this.nonnegativeInteger(part.stats.thrust) + this.nonnegativeInteger(part.stats.maneuverThrust), 0);
    const powerOutputPerSecond = parts.reduce((sum, part) =>
      sum + this.nonnegativeInteger(part.stats.energyGenerationPerSecond ?? part.stats.powerOutput), 0);
    const configuredEnergyCapacity = parts.reduce((sum, part) => sum + this.nonnegativeInteger(part.stats.energyCapacity), 0);
    const energyCapacity = Math.max(100, configuredEnergyCapacity || powerOutputPerSecond * 10);
    const configuredHeatCapacity = parts.reduce((sum, part) => sum + this.nonnegativeInteger(part.stats.heatCapacity), 0);
    const heatCapacity = Math.max(100, configuredHeatCapacity || hull * 2);
    const heatDissipationPerSecond = parts.reduce((sum, part) =>
      sum + this.nonnegativeInteger(part.stats.heatDissipationPerSecond), 0);
    const shieldCapacity = parts.reduce((sum, part) => sum + this.nonnegativeInteger(part.stats.shieldCapacity), 0);
    const shieldRegenPerSecond = parts.reduce((sum, part) =>
      sum + this.nonnegativeInteger(part.stats.shieldRegenPerSecond), 0);
    const shieldPowerPerSecond = parts.reduce((sum, part) =>
      sum + (this.simulationModuleCategory(part.definition) === "shield"
        ? this.nonnegativeInteger(part.stats.shieldPowerPerSecond ?? part.stats.powerDraw)
        : 0), 0);
    const enginePowerPerSecond = parts.reduce((sum, part) =>
      sum + (this.simulationModuleCategory(part.definition) === "engine"
        ? this.nonnegativeInteger(part.stats.enginePowerPerSecond ?? part.stats.powerDraw)
        : 0), 0);
    const primaryWeapon = weapons[0]!;
    return {
      hull,
      speedUnitsPerSecond: Math.max(80, Math.min(800, thrust * 2)),
      weaponDamage: primaryWeapon.damage,
      weaponRangeUnits: primaryWeapon.rangeUnits,
      weaponCooldownTicks: primaryWeapon.cooldownTicks,
      projectileSpeedUnitsPerSecond: primaryWeapon.projectileSpeedUnitsPerSecond,
      energyCapacity,
      energyInitial: energyCapacity,
      energyGenerationPerTick: Math.max(1, Math.ceil(powerOutputPerSecond / 30)),
      engineEnergyPerTick: enginePowerPerSecond > 0 ? Math.max(1, Math.ceil(enginePowerPerSecond / 30)) : 0,
      heatCapacity,
      heatDissipationPerTick: heatDissipationPerSecond > 0
        ? Math.max(1, Math.ceil(heatDissipationPerSecond / 30))
        : Math.max(1, Math.ceil(heatCapacity / 300)),
      overheatRecoveryHeat: Math.trunc(heatCapacity / 2),
      shieldCapacity,
      shieldInitial: shieldCapacity,
      shieldRegenPerTick: shieldRegenPerSecond > 0 ? Math.max(1, Math.ceil(shieldRegenPerSecond / 30)) : 0,
      shieldRegenDelayTicks: Math.max(1, Math.ceil(Math.max(
        ...parts.map((part) => this.nonnegativeInteger(part.stats.shieldRegenDelayMs)),
        3_000,
      ) * 30 / 1_000)),
      shieldEnergyPerTick: shieldPowerPerSecond > 0 ? Math.max(1, Math.ceil(shieldPowerPerSecond / 30)) : 0,
      weapons,
      modules,
    };
  }

  private simulationModuleCategory(definition: { category: string; kind: string }): ShipModuleCategory {
    if (definition.kind === "core") return "core";
    if (definition.kind === "reactor") return "reactor";
    if (definition.category === "engines") return "engine";
    if (definition.category === "weapons") return "weapon";
    if (definition.kind === "shield-generator") return "shield";
    return "utility";
  }

  private modulePowerPriority(category: ShipModuleCategory): number {
    return { core: 0, reactor: 10, shield: 20, weapon: 30, engine: 40, utility: 50 }[category];
  }

  private moduleParents(
    parts: Array<{ id: string; placement: { gridX: number; gridY: number } }>,
    categoryById: Map<string, ShipModuleCategory>,
  ): Map<string, string> {
    const roots = parts.filter((part) => categoryById.get(part.id) === "core");
    if (roots.length === 0) throw new ApiError("mission_content_invalid", 503, "Ship build requires a core module.");
    const parentById = new Map<string, string>();
    const connected = [...roots];
    const pending = parts.filter((part) => categoryById.get(part.id) !== "core");
    while (pending.length > 0) {
      pending.sort((left, right) => {
        const leftDistance = Math.min(...connected.map((part) => this.gridDistance(left, part)));
        const rightDistance = Math.min(...connected.map((part) => this.gridDistance(right, part)));
        return leftDistance - rightDistance || this.compareStableId(left.id, right.id);
      });
      const part = pending.shift()!;
      const parent = [...connected].sort((left, right) =>
        this.gridDistance(part, left) - this.gridDistance(part, right) || this.compareStableId(left.id, right.id)
      )[0]!;
      parentById.set(part.id, parent.id);
      connected.push(part);
    }
    return parentById;
  }

  private gridDistance(
    left: { placement: { gridX: number; gridY: number } },
    right: { placement: { gridX: number; gridY: number } },
  ): number {
    return Math.abs(left.placement.gridX - right.placement.gridX)
      + Math.abs(left.placement.gridY - right.placement.gridY);
  }

  private compareStableId(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
  }

  private storedMissionSimulationConfig(session: {
    id: string;
    simulationConfig: unknown;
    simulationConfigHash: string;
  }): MissionSimulationConfig {
    const config = this.record(session.simulationConfig);
    if (config.sessionId !== session.id
      || config.mode !== "pve"
      || this.hashJson(config) !== session.simulationConfigHash) {
      throw new ApiError("battle_simulation_config_invalid", 500, "Stored battle simulation config failed integrity validation.");
    }
    return config as unknown as MissionSimulationConfig;
  }

  private async loadDuelSimulationConfig(
    tx: TransactionClient,
    matchId: string,
    sessionId: string,
  ): Promise<DuelSimulationConfig> {
    const session = await tx.battleSession.findUnique({
      where: { id: sessionId },
      select: { id: true, pvpMatchId: true, simulationConfig: true, simulationConfigHash: true },
    });
    if (!session || session.pvpMatchId !== matchId) {
      throw new ApiError("battle_session_missing", 500, "PvP battle session was not created.");
    }
    if (session.simulationConfigHash !== "0".repeat(64)) {
      return this.storedDuelSimulationConfig(session, matchId);
    }

    const simulationConfig = await this.buildDuelSimulationConfig(tx, matchId, sessionId);
    await tx.battleSession.update({
      where: { id: sessionId },
      data: {
        simulationConfig,
        simulationConfigHash: this.hashJson(simulationConfig),
      },
    });
    return simulationConfig;
  }

  private async buildDuelSimulationConfig(
    tx: TransactionClient,
    matchId: string,
    sessionId: string,
  ): Promise<DuelSimulationConfig> {
    const rows = await tx.$queryRaw<Array<{
      match_id: string;
      battle_session_id: string;
      seed: bigint;
      simulation_version: string;
      content_version: string;
      duration_seconds: number;
      participant_id: string;
      user_id: string;
      side: number;
      build_revision_id: string;
      definition_keys: string[];
    }>>`SELECT * FROM spacey_load_pvp_simulation_source(${matchId}::uuid)`;
    if (rows.length !== 2 || rows.some((row) => row.side !== 0 && row.side !== 1)) {
      throw new ApiError("pvp_participants_invalid", 500, "PvP match does not contain two valid participants.");
    }
    const first = rows[0]!;
    if (rows.some((row) => row.match_id !== matchId
      || row.battle_session_id !== sessionId
      || row.seed !== first.seed
      || row.simulation_version !== first.simulation_version
      || row.content_version !== first.content_version
      || row.duration_seconds !== first.duration_seconds)) {
      throw new ApiError("pvp_session_invalid", 500, "PvP simulation source rows are inconsistent.");
    }
    if (first.simulation_version !== SIMULATION_VERSION) {
      throw new ApiError("simulation_version_unsupported", 500, "PvP match uses an unsupported simulation version.");
    }
    const release = await tx.contentRelease.findUnique({
      where: { version: first.content_version },
      include: { moduleDefinitions: { where: { enabled: true } } },
    });
    if (!release) throw new ApiError("pvp_content_unavailable", 503, "PvP content release is unavailable.");
    const definitions = new Map(
      release.moduleDefinitions.map((definition) => [definition.key, definition]),
    );
    const revisions = await tx.shipBuildRevision.findMany({
      where: { id: { in: rows.map((row) => row.build_revision_id) } },
      include: { installedItems: { include: { inventoryItem: true } } },
    });
    const revisionsById = new Map(revisions.map((revision) => [revision.id, revision]));
    const participants = rows
      .sort((left, right) => left.side - right.side)
      .map((row) => {
        const revision = revisionsById.get(row.build_revision_id);
        if (!revision) throw new ApiError("pvp_build_unavailable", 503, "PvP build revision is unavailable.");
        return {
          participantId: row.participant_id,
          userId: row.user_id,
          side: row.side === 0 ? "alpha" as const : "beta" as const,
          shipBuildRevisionId: row.build_revision_id,
          buildStats: this.duelBuildStats(revision.installedItems, definitions),
        };
      }) as DuelSimulationConfig["participants"];
    return {
      matchId,
      sessionId,
      seed: this.safeNumber(first.seed),
      contentVersion: first.content_version,
      simulationVersion: SIMULATION_VERSION,
      durationSeconds: first.duration_seconds,
      arenaWidthUnits: 2_000,
      arenaHeightUnits: 1_200,
      participants,
    };
  }

  private storedDuelSimulationConfig(session: {
    id: string;
    simulationConfig: unknown;
    simulationConfigHash: string;
  }, matchId: string): DuelSimulationConfig {
    const config = this.record(session.simulationConfig);
    if (config.sessionId !== session.id
      || config.matchId !== matchId
      || !Array.isArray(config.participants)
      || this.hashJson(config) !== session.simulationConfigHash) {
      throw new ApiError("battle_simulation_config_invalid", 500, "Stored PvP simulation config failed integrity validation.");
    }
    return config as unknown as DuelSimulationConfig;
  }

  private duelBuildStats(
    installedItems: Array<{
      inventoryItemId: string;
      placement: unknown;
      inventoryItem: { definitionKey: string };
    }>,
    definitions: Map<string, { key: string; category: string; kind: string; stats: unknown }>,
  ): DuelShipBuildStats {
    const buildStats = this.missionShipStats(installedItems, definitions);
    const collisionRadiusUnits = Math.max(12, Math.min(80, Math.max(
      ...installedItems.map((item) => this.positiveInteger(
        this.record(definitions.get(item.inventoryItem.definitionKey)?.stats).collisionRadius,
        24,
      )),
    )));
    return { ...buildStats, collisionRadiusUnits };
  }

  private randomSeed() {
    const seed = randomBytes(4).readUInt32BE(0);
    return seed === 0 ? 1 : seed;
  }
}
