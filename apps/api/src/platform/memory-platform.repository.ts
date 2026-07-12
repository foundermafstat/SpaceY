import { createHash, randomUUID } from "node:crypto";
import type {
  ApplyShipBuildCommandsRequestDto,
  BattleResultDto,
  BattleResultPageDto,
  BootstrapResponseDto,
  CommitRepairRequestDto,
  CreateRepairQuoteRequestDto,
  CreatePrivacyRequestDto,
  LegacyBuildImportProposalDto,
  MissionAttemptStatusDto,
  PlayerProfileDto,
  PrivacyPreferencesDto,
  PrivacyRequestDto,
  PublicAggregateStatsDto,
  PublicProfileDto,
  RepairQuoteDto,
  RepairResultDto,
  ShipBuildDto,
  ShipBuildPartDto,
  UpdatePrivacyPreferencesRequestDto,
  WalletDto
} from "@spacey/contracts";
import { SIMULATION_VERSION, seedFromString, type DuelSimulationConfig, type MissionSimulationConfig } from "@spacey/simulation";
import { ApiError } from "../common/api-error.js";
import type {
  CreateDeveloperApiKeyRecord,
  CreateDeveloperClientRecord,
  CreateDeveloperWebhookRecord,
  DeveloperApiClientView,
  DeveloperApiKeyView,
  DeveloperWebhookView,
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

type PlayerState = {
  profile: PlayerProfileDto;
  wallet: WalletDto;
  build: ShipBuildDto;
  privacy: PrivacyPreferencesDto;
  deletionPending: boolean;
  deleted: boolean;
};

type MemoryDeveloperClient = {
  ownerUserId: string;
  id: string;
  clientId: string;
  clientSecretHash: string | null;
  previousClientSecretHash: string | null;
  previousClientSecretExpiresAt: Date | null;
  name: string;
  status: "ACTIVE" | "SUSPENDED" | "REVOKED";
  scopes: CreateDeveloperClientRecord["scopes"];
  rateLimitPerMinute: number;
  createdAt: Date;
  updatedAt: Date;
  apiKeys: Map<string, {
    id: string;
    apiClientId: string;
    keyPrefix: string;
    secretHash: string;
    name: string;
    scopes: CreateDeveloperApiKeyRecord["scopes"];
    expiresAt: Date | null;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
  }>;
  webhooks: Map<string, {
    id: string;
    apiClientId: string;
    url: string;
    secretHash: string;
    eventTypes: CreateDeveloperWebhookRecord["eventTypes"];
    status: "ACTIVE" | "PAUSED" | "REVOKED";
    previousSecretHash: string | null;
    previousSecretExpiresAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
};

const release = {
  id: "01900000-0000-7000-8000-000000000001",
  version: "dev-2",
  publishedAt: new Date(0).toISOString()
};

const missions = [
  {
    id: "starter-scout",
    contentVersion: release.version,
    name: "Starter Scout",
    type: "salvage" as const,
    risk: "green" as const,
    briefing: "Recover the abandoned navigation core.",
    durationSeconds: 180,
    objective: { type: "destroy_all" as const, target: 4, label: "Destroy all hostiles" },
    rewardPreview: { credits: 500, scrap: 25 }
  },
  {
    id: "convoy-guard",
    contentVersion: release.version,
    name: "Convoy Guard",
    type: "escort" as const,
    risk: "yellow" as const,
    briefing: "Protect the civilian convoy until it clears the raider lane.",
    durationSeconds: 120,
    objective: { type: "protect_target" as const, target: 60, label: "Protect the convoy for 60 seconds" },
    rewardPreview: { credits: 750, scrap: 40 }
  },
  {
    id: "salvage-sweep",
    contentVersion: release.version,
    name: "Salvage Sweep",
    type: "mining" as const,
    risk: "green" as const,
    briefing: "Collect five marked scrap caches before the recovery window closes.",
    durationSeconds: 120,
    objective: { type: "collect_scrap" as const, target: 5, label: "Collect 5 scrap caches" },
    rewardPreview: { credits: 600, scrap: 60 }
  }
];

const memoryPlayerStats: MissionSimulationConfig["player"] = {
  hull: 595,
  speedUnitsPerSecond: 250,
  weaponDamage: 14,
  weaponRangeUnits: 420,
  weaponCooldownTicks: 13,
  projectileSpeedUnitsPerSecond: 620,
  energyCapacity: 1_200,
  energyInitial: 1_200,
  energyGenerationPerTick: 4,
  engineEnergyPerTick: 1,
  heatCapacity: 300,
  heatDissipationPerTick: 4,
  overheatRecoveryHeat: 150,
  shieldCapacity: 80,
  shieldInitial: 80,
  shieldRegenPerTick: 2,
  shieldRegenDelayTicks: 90,
  shieldEnergyPerTick: 1,
  weapons: [{
    id: "weapon-starter-blaster",
    moduleId: "module-starter-blaster",
    damage: 14,
    rangeUnits: 420,
    cooldownTicks: 13,
    projectileSpeedUnitsPerSecond: 620,
    energyCost: 18,
    heatPerShot: 28,
    actionFlag: 1,
  }],
  modules: [
    { id: "module-starter-core", inventoryItemId: "module-starter-core", category: "core", hp: 240, gridX: 0, gridY: 0, powerPriority: 0 },
    { id: "module-starter-blaster", inventoryItemId: "module-starter-blaster", category: "weapon", hp: 90, gridX: 0, gridY: -1, parentModuleId: "module-starter-core", powerDemandPerTick: 1, powerPriority: 30 },
    { id: "module-starter-engine", inventoryItemId: "module-starter-engine", category: "engine", hp: 110, gridX: 0, gridY: 1, parentModuleId: "module-starter-core", powerDemandPerTick: 1, powerPriority: 40 },
    { id: "module-starter-thruster", inventoryItemId: "module-starter-thruster", category: "engine", hp: 75, gridX: -1, gridY: 1, parentModuleId: "module-starter-engine", powerDemandPerTick: 1, powerPriority: 40 },
    { id: "module-starter-shield", inventoryItemId: "module-starter-shield", category: "shield", hp: 80, gridX: 1, gridY: 0, parentModuleId: "module-starter-core", powerDemandPerTick: 1, powerPriority: 20 },
  ],
};

const scoutEnemy = {
  hull: 80,
  speedUnitsPerSecond: 210,
  collisionRadiusUnits: 20,
  attackDamage: 8,
  attackRangeUnits: 260,
  attackCooldownTicks: 30,
};

const bruiserEnemy = {
  hull: 180,
  speedUnitsPerSecond: 120,
  collisionRadiusUnits: 32,
  attackDamage: 16,
  attackRangeUnits: 220,
  attackCooldownTicks: 42,
};

function memoryMissionSimulationConfig(input: {
  sessionId: string;
  attemptId: string;
  missionId: string;
  shipBuildRevisionId: string;
}): MissionSimulationConfig {
  const common = {
    sessionId: input.sessionId,
    attemptId: input.attemptId,
    missionId: input.missionId,
    mode: "pve" as const,
    seed: seedFromString(`${input.sessionId}:${input.missionId}`),
    contentVersion: release.version,
    simulationVersion: SIMULATION_VERSION,
    shipBuildRevisionId: input.shipBuildRevisionId,
    arenaWidthUnits: 2_000,
    arenaHeightUnits: 1_200,
    player: memoryPlayerStats,
  };
  if (input.missionId === "convoy-guard") {
    return {
      ...common,
      durationSeconds: 120,
      objective: {
        type: "protect_target",
        targetSeconds: 60,
        targetHull: 600,
        collisionRadiusUnits: 48,
      },
      enemyRoster: [
        { definitionKey: "raider-scout", count: 3, stats: scoutEnemy },
        { definitionKey: "raider-bruiser", count: 1, stats: bruiserEnemy },
      ],
    };
  }
  if (input.missionId === "salvage-sweep") {
    return {
      ...common,
      durationSeconds: 120,
      objective: {
        type: "collect_scrap",
        targetScrap: 5,
        scrapCount: 7,
        collectionRadiusUnits: 36,
      },
      enemyRoster: [{ definitionKey: "rival-scout", count: 2, stats: scoutEnemy }],
    };
  }
  return {
    ...common,
    durationSeconds: 90,
    objective: { type: "destroy_all", targetKills: 4 },
    enemyRoster: [
      { definitionKey: "rival-scout", count: 3, stats: scoutEnemy },
      { definitionKey: "rival-bruiser", count: 1, stats: bruiserEnemy },
    ],
  };
}

export class MemoryPlatformRepository implements PlatformRepository {
  private readonly players = new Map<string, PlayerState>();
  private readonly telegramUsers = new Map<string, string>();
  private readonly replayHashes = new Set<string>();
  private readonly sessions = new Map<string, RefreshSessionRecord>();
  private readonly attempts = new Map<string, MissionAttemptStatusDto>();
  private readonly attemptOwners = new Map<string, string>();
  private readonly idempotentAttempts = new Map<string, MissionAttemptRecord>();
  private readonly missionAttemptRequestHashes = new Map<string, string>();
  private readonly missionAttemptTicketHashes = new Map<string, string>();
  private readonly importedLegacyBuilds = new Set<string>();
  private readonly matchmakingTickets = new Map<string, MatchmakingTicketRecord>();
  private readonly matchmakingIdempotency = new Map<string, string>();
  private readonly duelMatches = new Map<string, {
    sessionId: string;
    seed: number;
    participants: Array<{ ticketId: string; userId: string; attemptId: string; participantId: string; side: 0 | 1; buildRevisionId: string }>;
  }>();
  private readonly pvpTicketHashes = new Map<string, string>();
  private readonly pvpTicketVersions = new Map<string, number>();
  private readonly privacyRequests = new Map<string, { userId: string; request: PrivacyRequestDto }>();
  private readonly privacyIdempotency = new Map<string, string>();
  private readonly developerClients = new Map<string, MemoryDeveloperClient>();

  async ping() {}

  async isAccessSessionActive(userId: string, sessionId: string) {
    const player = this.players.get(userId);
    if (!player || player.deletionPending || player.deleted) return false;
    return [...this.sessions.values()].some((session) =>
      session.id === sessionId
      && session.userId === userId
      && session.status === "active"
      && session.expiresAt > new Date()
    );
  }

  async authenticateTelegram(input: {
    initDataHash: string;
    authDate: Date;
    replayExpiresAt: Date;
    identity: TelegramPlayerIdentity;
  }) {
    if (this.replayHashes.has(input.initDataHash)) {
      throw new ApiError("telegram_init_data_replayed", 401, "Telegram authorization payload was already used.");
    }
    this.replayHashes.add(input.initDataHash);

    const existingId = this.telegramUsers.get(input.identity.telegramUserId);
    if (existingId) {
      const player = this.players.get(existingId)!;
      if (player.deletionPending || player.deleted) {
        throw new ApiError("player_inactive", 401, "Player account is not active.");
      }
      player.profile = this.profileFromIdentity(existingId, player.profile.createdAt, input.identity);
      return player.profile;
    }

    const userId = randomUUID();
    const buildId = randomUUID();
    const revisionId = randomUUID();
    const profile = this.profileFromIdentity(userId, new Date().toISOString(), input.identity);
    this.players.set(userId, {
      profile,
      wallet: { credits: 0, scrap: 0, alloy: 0, dataShards: 0 },
      privacy: {
        profilePublic: false,
        analyticsConsent: false,
        analyticsConsentUpdatedAt: null,
        updatedAt: profile.createdAt
      },
      deletionPending: false,
      deleted: false,
      build: {
        id: buildId,
        updatedAt: new Date().toISOString(),
        activeRevision: {
          id: revisionId,
          buildId,
          revision: 1,
          name: "Starter Scout",
          parts: [],
          createdAt: new Date().toISOString()
        }
      }
    });
    this.telegramUsers.set(input.identity.telegramUserId, userId);
    return profile;
  }

  async getProfile(userId: string) {
    return this.players.get(userId)?.profile ?? null;
  }

  async getPrivacyPreferences(userId: string): Promise<PrivacyPreferencesDto | null> {
    const player = this.players.get(userId);
    return player ? { ...player.privacy } : null;
  }

  async updatePrivacyPreferences(
    userId: string,
    input: UpdatePrivacyPreferencesRequestDto
  ): Promise<PrivacyPreferencesDto> {
    const player = this.requirePlayer(userId);
    if (player.deletionPending || player.deleted) {
      throw new ApiError("player_inactive", 409, "Inactive player preferences cannot be changed.");
    }
    const now = new Date().toISOString();
    player.privacy = {
      profilePublic: input.profilePublic,
      analyticsConsent: input.analyticsConsent,
      analyticsConsentUpdatedAt: now,
      updatedAt: now
    };
    return { ...player.privacy };
  }

  async createPrivacyRequest(userId: string, input: CreatePrivacyRequestDto): Promise<PrivacyRequestDto> {
    const player = this.requirePlayer(userId);
    const scope = `${userId}:${input.idempotencyKey}`;
    const existingId = this.privacyIdempotency.get(scope);
    if (existingId) {
      const existing = this.privacyRequests.get(existingId)!.request;
      if (existing.type !== input.type) {
        throw new ApiError("idempotency_key_reused", 409, "Idempotency key was reused with another privacy request.");
      }
      return { ...existing };
    }
    if (player.deletionPending || player.deleted) {
      throw new ApiError("player_inactive", 409, "Inactive player cannot create a privacy request.");
    }

    const now = new Date();
    const request: PrivacyRequestDto = {
      id: randomUUID(),
      type: input.type,
      status: "pending",
      requestedAt: now.toISOString(),
      processingStartedAt: null,
      completedAt: null,
      failedAt: null,
      failureCode: null,
      retentionUntil: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1_000).toISOString(),
      exportArtifact: null
    };
    if (input.type === "delete") {
      player.deletionPending = true;
      player.privacy = {
        profilePublic: false,
        analyticsConsent: false,
        analyticsConsentUpdatedAt: now.toISOString(),
        updatedAt: now.toISOString()
      };
      for (const session of this.sessions.values()) {
        if (session.userId === userId) session.status = "revoked";
      }
    }
    this.privacyRequests.set(request.id, { userId, request });
    this.privacyIdempotency.set(scope, request.id);
    return { ...request };
  }

  async getPrivacyRequest(userId: string, requestId: string): Promise<PrivacyRequestDto | null> {
    const stored = this.privacyRequests.get(requestId);
    return stored?.userId === userId ? { ...stored.request } : null;
  }

  async getPrivacyExportDownloadTarget() {
    return null;
  }

  async createRefreshSession(input: {
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    ipHash: string | null;
    userAgentHash: string | null;
    maxActiveSessions: number;
  }) {
    const player = this.requirePlayer(input.userId);
    if (player.deletionPending || player.deleted) {
      throw new ApiError("player_inactive", 409, "Inactive player cannot create an auth session.");
    }
    const active = [...this.sessions.values()]
      .filter((session) => session.userId === input.userId && session.status === "active")
      .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
    for (const session of active.slice(0, Math.max(0, active.length - input.maxActiveSessions + 1))) {
      session.status = "revoked";
    }
    const session: RefreshSessionRecord = {
      id: randomUUID(),
      userId: input.userId,
      tokenFamily: randomUUID(),
      refreshTokenHash: input.refreshTokenHash,
      status: "active",
      expiresAt: input.expiresAt
    };
    this.sessions.set(session.refreshTokenHash, session);
    return session;
  }

  async rotateRefreshSession(input: {
    currentTokenHash: string;
    nextTokenHash: string;
    nextExpiresAt: Date;
    ipHash: string | null;
    userAgentHash: string | null;
  }): Promise<RotateRefreshSessionResult> {
    const current = this.sessions.get(input.currentTokenHash);
    if (!current) return { kind: "invalid" };
    const player = this.players.get(current.userId);
    if (!player || player.deletionPending || player.deleted) {
      await this.revokeFamily(current.tokenFamily);
      return { kind: "invalid" };
    }
    if (current.status === "rotated") {
      await this.revokeFamily(current.tokenFamily);
      return { kind: "reuse", userId: current.userId };
    }
    if (current.status !== "active" || current.expiresAt <= new Date()) return { kind: "invalid" };

    current.status = "rotated";
    const next: RefreshSessionRecord = {
      id: randomUUID(),
      userId: current.userId,
      tokenFamily: current.tokenFamily,
      refreshTokenHash: input.nextTokenHash,
      status: "active",
      expiresAt: input.nextExpiresAt
    };
    this.sessions.set(next.refreshTokenHash, next);
    return { kind: "rotated", session: next };
  }

  async revokeRefreshSession(tokenHash: string) {
    const session = this.sessions.get(tokenHash);
    if (session) session.status = "revoked";
  }

  async revokeAllRefreshSessions(userId: string) {
    for (const session of this.sessions.values()) {
      if (session.userId === userId) session.status = "revoked";
    }
  }

  async getBootstrap(userId: string): Promise<BootstrapResponseDto> {
    const player = this.requirePlayer(userId);
    const activeAttempt = (attempt: MissionAttemptStatusDto) =>
      attempt.status === "queued" || attempt.status === "active" || attempt.status === "paused";
    const pveAttemptIds = new Set([...this.idempotentAttempts.values()].map((attempt) => attempt.attemptId));
    const activePve = [...this.attempts.entries()]
      .filter(([attemptId, attempt]) => this.attemptOwners.get(attemptId) === userId
        && pveAttemptIds.has(attemptId)
        && activeAttempt(attempt))
      .map(([, attempt]) => ({ mode: "pve" as const, attempt }));
    const activePvp = [...this.matchmakingTickets.values()]
      .filter((ticket) => ticket.userId === userId && (ticket.status === "queued" || ticket.status === "matched"))
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map((ticket) => ({
        mode: "pvp" as const,
        matchmakingTicket: {
          id: ticket.ticketId,
          queue: ticket.queue,
          region: ticket.region,
          mmr: ticket.mmr,
          status: ticket.status,
          createdAt: ticket.createdAt.toISOString(),
          expiresAt: ticket.expiresAt.toISOString(),
          match: ticket.match ? {
            matchId: ticket.match.matchId,
            sessionId: ticket.match.sessionId,
            attemptId: ticket.match.attemptId,
            runtimeState: "ready" as const,
            connection: null,
          } : null,
        },
        attempt: ticket.match ? this.attempts.get(ticket.match.attemptId) ?? null : null,
      }));
    return {
      serverTime: new Date().toISOString(),
      profile: player.profile,
      wallet: player.wallet,
      activeBuild: player.build,
      inventory: [],
      contentRelease: release,
      missions,
      activeGameplay: [...activePve, ...activePvp],
      capabilities: { pvpMatchmaking: true, repair: true }
    };
  }

  async applyBuildCommands(
    userId: string,
    buildId: string,
    input: ApplyShipBuildCommandsRequestDto
  ): Promise<ShipBuildDto> {
    const player = this.requirePlayer(userId);
    if (player.build.id !== buildId) throw new ApiError("build_not_found", 404, "Build not found.");
    const revision = player.build.activeRevision;
    if (revision.revision !== input.expectedRevision) {
      throw new ApiError("build_revision_conflict", 409, "Build revision has changed.", {
        currentRevision: revision.revision
      });
    }

    let name = revision.name;
    let parts = revision.parts.map((part) => ({ ...part }));
    for (const command of input.commands) {
      if (command.type === "rename") {
        name = command.name.trim();
        if (!name || name.length > 64) throw new ApiError("invalid_build_name", 400, "Build name is invalid.");
        continue;
      }
      if (command.type === "remove") {
        parts = parts.filter((part) => part.inventoryItemId !== command.inventoryItemId);
        continue;
      }
      const nextPart: ShipBuildPartDto = {
        inventoryItemId: command.inventoryItemId,
        definitionId: "server-owned-definition",
        gridX: command.gridX,
        gridY: command.gridY,
        rotation: command.rotation
      };
      parts = [...parts.filter((part) => part.inventoryItemId !== command.inventoryItemId), nextPart];
    }

    const coordinates = new Set<string>();
    for (const part of parts) {
      const coordinate = `${part.gridX}:${part.gridY}`;
      if (coordinates.has(coordinate)) throw new ApiError("build_overlap", 422, "Build parts overlap.");
      coordinates.add(coordinate);
    }

    const now = new Date().toISOString();
    player.build = {
      id: buildId,
      updatedAt: now,
      activeRevision: {
        id: randomUUID(),
        buildId,
        revision: revision.revision + 1,
        name,
        parts,
        createdAt: now
      }
    };
    return player.build;
  }

  async importLegacyBuild(userId: string, proposal: LegacyBuildImportProposalDto) {
    const player = this.requirePlayer(userId);
    const scope = `${userId}:${proposal.sourceBuildId}`;
    if (this.importedLegacyBuilds.has(scope)) return { imported: false, build: player.build };
    const now = new Date().toISOString();
    player.build = {
      id: player.build.id,
      updatedAt: now,
      activeRevision: {
        id: randomUUID(),
        buildId: player.build.id,
        revision: player.build.activeRevision.revision + 1,
        name: proposal.name,
        parts: proposal.parts.map((part) => ({
          inventoryItemId: randomUUID(),
          definitionId: part.definitionId,
          gridX: part.gridX,
          gridY: part.gridY,
          rotation: part.rotation
        })),
        createdAt: now
      }
    };
    this.importedLegacyBuilds.add(scope);
    return { imported: true, build: player.build };
  }

  async createMissionAttempt(input: {
    userId: string;
    missionId: string;
    shipBuildRevisionId: string;
    idempotencyKey: string;
  }): Promise<MissionAttemptRecord> {
    this.requirePlayer(input.userId);
    const idempotencyScope = `${input.userId}:${input.idempotencyKey}`;
    const requestHash = createHash("sha256")
      .update(JSON.stringify({ missionId: input.missionId, shipBuildRevisionId: input.shipBuildRevisionId }))
      .digest("hex");
    const existing = this.idempotentAttempts.get(idempotencyScope);
    if (existing) {
      if (this.missionAttemptRequestHashes.get(idempotencyScope) !== requestHash) {
        throw new ApiError("idempotency_key_reused", 409, "Idempotency key was reused with another request.");
      }
      return existing;
    }
    if (!missions.some((mission) => mission.id === input.missionId)) {
      throw new ApiError("mission_not_found", 404, "Mission not found.");
    }
    const attemptId = randomUUID();
    const sessionId = randomUUID();
    const record: MissionAttemptRecord = {
      attemptId,
      sessionId,
      mode: "pve",
      previousTicketHash: null,
      ticketVersion: 0,
      simulationConfig: memoryMissionSimulationConfig({
        sessionId,
        attemptId,
        missionId: input.missionId,
        shipBuildRevisionId: input.shipBuildRevisionId,
      })
    };
    this.idempotentAttempts.set(idempotencyScope, record);
    this.missionAttemptRequestHashes.set(idempotencyScope, requestHash);
    this.attemptOwners.set(attemptId, input.userId);
    this.attempts.set(attemptId, {
      attemptId,
      sessionId,
      status: "queued",
      resultId: null,
      reconnect: { permitted: true, deadlineAt: null, lastAcknowledgedInputSequence: 0 }
    });
    return record;
  }

  async renewMissionAttemptTicket(input: {
    userId: string;
    attemptId: string;
    ticketHash: string;
    ticketExpiresAt: Date;
  }) {
    if (this.attemptOwners.get(input.attemptId) !== input.userId) return null;
    const status = this.attempts.get(input.attemptId);
    if (!status || status.status === "completed" || status.status === "failed") return null;
    const entry = [...this.idempotentAttempts.entries()].find(([, record]) => record.attemptId === input.attemptId);
    if (!entry) return null;
    const [scope, record] = entry;
    const rotated = {
      ...record,
      previousTicketHash: this.missionAttemptTicketHashes.get(input.attemptId) ?? null,
      ticketVersion: record.ticketVersion + 1,
    };
    this.missionAttemptTicketHashes.set(input.attemptId, input.ticketHash);
    this.idempotentAttempts.set(scope, rotated);
    return rotated;
  }

  async getMissionAttemptStatus(userId: string, attemptId: string) {
    this.requirePlayer(userId);
    if (this.attemptOwners.get(attemptId) !== userId) return null;
    return this.attempts.get(attemptId) ?? null;
  }

  async abandonMissionAttempt(userId: string, attemptId: string) {
    this.requirePlayer(userId);
    if (this.attemptOwners.get(attemptId) !== userId) return null;
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return null;
    if (attempt.status !== "completed" && attempt.status !== "failed") {
      attempt.status = "failed";
      attempt.reconnect = {
        ...attempt.reconnect,
        permitted: false,
        deadlineAt: null,
      };
    }
    return attempt;
  }

  async getBattleResult(userId: string, _resultId: string): Promise<BattleResultDto | null> {
    this.requirePlayer(userId);
    return null;
  }

  async listBattleResults(userId: string, _cursor: string | null, _limit: number): Promise<BattleResultPageDto> {
    this.requirePlayer(userId);
    return { items: [], nextCursor: null };
  }

  async createRepairQuote(userId: string, _input: CreateRepairQuoteRequestDto): Promise<RepairQuoteDto> {
    this.requirePlayer(userId);
    throw new ApiError("inventory_item_not_found", 404, "Inventory item not found.");
  }

  async commitRepair(userId: string, _input: CommitRepairRequestDto): Promise<RepairResultDto> {
    this.requirePlayer(userId);
    throw new ApiError("repair_quote_not_found", 404, "Repair quote not found.");
  }

  async createMatchmakingTicket(input: {
    userId: string;
    shipBuildRevisionId: string;
    queue: string;
    idempotencyKey: string;
  }): Promise<MatchmakingTicketRecord> {
    const player = this.requirePlayer(input.userId);
    if (player.build.activeRevision.id !== input.shipBuildRevisionId) {
      throw new ApiError("build_revision_invalid", 422, "Build revision is unavailable for matchmaking.");
    }
    if (input.queue !== "ranked-eu") throw new ApiError("matchmaking_queue_not_found", 404, "Matchmaking queue not found.");
    const scope = `${input.userId}:${input.idempotencyKey}`;
    const existingId = this.matchmakingIdempotency.get(scope);
    if (existingId) {
      const existing = this.matchmakingTickets.get(existingId)!;
      if (existing.queue !== input.queue || existing.buildRevisionId !== input.shipBuildRevisionId) {
        throw new ApiError("idempotency_key_reused", 409, "Idempotency key was reused with another request.");
      }
      return existing;
    }
    for (const ticket of this.matchmakingTickets.values()) {
      if (ticket.userId === input.userId && ticket.status === "queued" && ticket.expiresAt <= new Date()) {
        ticket.status = "expired";
      }
      if (ticket.userId === input.userId && (ticket.status === "queued" || ticket.status === "matched")) {
        throw new ApiError("matchmaking_ticket_active", 409, "Player already has an active matchmaking ticket.");
      }
    }
    const now = new Date();
    const ticket: MatchmakingTicketRecord = {
      ticketId: randomUUID(),
      userId: input.userId,
      buildRevisionId: input.shipBuildRevisionId,
      queue: input.queue,
      region: "eu",
      mmr: 1_000,
      status: "queued",
      createdAt: now,
      expiresAt: new Date(now.getTime() + 300_000),
      policy: { baseMmrWindow: 100, expansionPerSecond: 5, maxMmrWindow: 500 },
      match: null,
    };
    this.matchmakingTickets.set(ticket.ticketId, ticket);
    this.matchmakingIdempotency.set(scope, ticket.ticketId);
    return ticket;
  }

  async getMatchmakingTicket(userId: string, ticketId: string): Promise<MatchmakingTicketRecord | null> {
    this.requirePlayer(userId);
    const ticket = this.matchmakingTickets.get(ticketId);
    if (!ticket || ticket.userId !== userId) return null;
    if (ticket.status === "queued" && ticket.expiresAt <= new Date()) ticket.status = "expired";
    return ticket;
  }

  async cancelMatchmakingTicket(userId: string, ticketId: string): Promise<MatchmakingTicketRecord | null> {
    const ticket = await this.getMatchmakingTicket(userId, ticketId);
    if (!ticket) return null;
    if (ticket.status === "queued") ticket.status = "cancelled";
    return ticket;
  }

  async materializePvpMatch(input: {
    callerUserId: string;
    leftTicketId: string;
    rightTicketId: string;
  }): Promise<MaterializedPvpMatch> {
    const materializedAtMs = Date.now();
    const left = this.matchmakingTickets.get(input.leftTicketId);
    const right = this.matchmakingTickets.get(input.rightTicketId);
    if (!left || !right) throw new ApiError("matchmaking_ticket_missing", 409, "Matchmaking ticket no longer exists.");
    if (left.userId !== input.callerUserId && right.userId !== input.callerUserId) {
      throw new ApiError("matchmaking_ticket_forbidden", 403, "Matchmaking ticket is not owned by this player.");
    }
    if (left.userId === right.userId || left.status !== "queued" || right.status !== "queued") {
      throw new ApiError("matchmaking_pair_stale", 409, "Matchmaking pair is no longer available.");
    }
    if (left.expiresAt <= new Date() || right.expiresAt <= new Date()) {
      throw new ApiError("matchmaking_pair_expired", 409, "Matchmaking pair expired.");
    }
    if (left.queue !== right.queue || left.region !== right.region || !this.mmrCompatible(left, right, Date.now())) {
      throw new ApiError("matchmaking_pair_incompatible", 409, "Matchmaking pair is incompatible.");
    }
    const matchId = randomUUID();
    const sessionId = randomUUID();
    const leftAttemptId = randomUUID();
    const rightAttemptId = randomUUID();
    const leftParticipantId = randomUUID();
    const rightParticipantId = randomUUID();
    left.status = "matched";
    right.status = "matched";
    left.match = { matchId, sessionId, attemptId: leftAttemptId };
    right.match = { matchId, sessionId, attemptId: rightAttemptId };
    this.attemptOwners.set(leftAttemptId, left.userId);
    this.attemptOwners.set(rightAttemptId, right.userId);
    this.attempts.set(leftAttemptId, {
      attemptId: leftAttemptId,
      sessionId,
      status: "queued",
      resultId: null,
      reconnect: { permitted: false, deadlineAt: null, lastAcknowledgedInputSequence: 0 },
    });
    this.attempts.set(rightAttemptId, {
      attemptId: rightAttemptId,
      sessionId,
      status: "queued",
      resultId: null,
      reconnect: { permitted: false, deadlineAt: null, lastAcknowledgedInputSequence: 0 },
    });
    this.duelMatches.set(matchId, {
      sessionId,
      seed: 1,
      participants: [
        { ticketId: left.ticketId, userId: left.userId, attemptId: leftAttemptId, participantId: leftParticipantId, side: 0, buildRevisionId: left.buildRevisionId },
        { ticketId: right.ticketId, userId: right.userId, attemptId: rightAttemptId, participantId: rightParticipantId, side: 1, buildRevisionId: right.buildRevisionId },
      ],
    });
    const runtimeParticipants = [
      { ticketId: left.ticketId, userId: left.userId, attemptId: leftAttemptId, participantId: leftParticipantId, side: 0 as const, buildRevisionId: left.buildRevisionId },
      { ticketId: right.ticketId, userId: right.userId, attemptId: rightAttemptId, participantId: rightParticipantId, side: 1 as const, buildRevisionId: right.buildRevisionId },
    ];
    const simulationConfig: DuelSimulationConfig = {
      matchId,
      sessionId,
      seed: 1,
      contentVersion: release.version,
      simulationVersion: SIMULATION_VERSION,
      durationSeconds: 180,
      arenaWidthUnits: 2_000,
      arenaHeightUnits: 1_200,
      participants: runtimeParticipants.map((candidate) => ({
        participantId: candidate.participantId,
        userId: candidate.userId,
        side: candidate.side === 0 ? "alpha" as const : "beta" as const,
        shipBuildRevisionId: candidate.buildRevisionId,
        buildStats: {
          hull: 300,
          speedUnitsPerSecond: 240,
          weaponDamage: 20,
          weaponRangeUnits: 500,
          weaponCooldownTicks: 15,
          projectileSpeedUnitsPerSecond: 600,
          collisionRadiusUnits: 24,
        },
      })) as DuelSimulationConfig["participants"],
    };
    return {
      matchId,
      sessionId,
      tickets: [
        { ticketId: left.ticketId, attemptId: leftAttemptId },
        { ticketId: right.ticketId, attemptId: rightAttemptId },
      ],
      participants: runtimeParticipants.map(({ userId, attemptId, participantId, side }) => ({ userId, attemptId, participantId, side })),
      simulationConfig,
      readyDeadlineAtMs: materializedAtMs + 20_000,
    };
  }

  async renewPvpConnectionTicket(input: {
    userId: string;
    ticketId: string;
    ticketHash: string;
    ticketExpiresAt: Date;
  }): Promise<PvpConnectionRecord | null> {
    const ticket = await this.getMatchmakingTicket(input.userId, input.ticketId);
    if (!ticket?.match || ticket.status !== "matched") return null;
    const match = this.duelMatches.get(ticket.match.matchId);
    const participant = match?.participants.find((candidate) => candidate.userId === input.userId);
    if (!match || !participant) return null;
    const previousTicketHash = this.pvpTicketHashes.get(input.userId) ?? null;
    this.pvpTicketHashes.set(input.userId, input.ticketHash);
    const ticketVersion = (this.pvpTicketVersions.get(participant.attemptId) ?? 0) + 1;
    this.pvpTicketVersions.set(participant.attemptId, ticketVersion);
    const participants = match.participants.map((candidate) => ({
      participantId: candidate.participantId,
      userId: candidate.userId,
      side: candidate.side === 0 ? "alpha" as const : "beta" as const,
      shipBuildRevisionId: candidate.buildRevisionId,
      buildStats: {
        hull: 300,
        speedUnitsPerSecond: 240,
        weaponDamage: 20,
        weaponRangeUnits: 500,
        weaponCooldownTicks: 15,
        projectileSpeedUnitsPerSecond: 600,
        collisionRadiusUnits: 24,
      },
    })) as import("@spacey/simulation").DuelSimulationConfig["participants"];
    return {
      ticketId: ticket.ticketId,
      sessionId: match.sessionId,
      attemptId: participant.attemptId,
      userId: participant.userId,
      matchId: ticket.match.matchId,
      participantId: participant.participantId,
      side: participant.side,
      previousTicketHash,
      ticketVersion,
      simulationConfig: {
        matchId: ticket.match.matchId,
        sessionId: match.sessionId,
        seed: match.seed,
        contentVersion: release.version,
        simulationVersion: SIMULATION_VERSION,
        durationSeconds: 180,
        arenaWidthUnits: 2_000,
        arenaHeightUnits: 1_200,
        participants,
      },
      participants: match.participants.map(({ userId, attemptId, participantId, side }) => ({ userId, attemptId, participantId, side })),
    };
  }

  async listDeveloperApiClients(userId: string): Promise<DeveloperApiClientView[]> {
    return [...this.developerClients.values()]
      .filter((client) => client.ownerUserId === userId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map((client) => this.memoryDeveloperClientView(client));
  }

  async createDeveloperApiClient(userId: string, input: CreateDeveloperClientRecord): Promise<DeveloperApiClientView> {
    const player = this.requirePlayer(userId);
    if (player.deletionPending || player.deleted) throw new ApiError("player_inactive", 409, "Inactive player cannot create an API client.");
    const now = new Date();
    const client: MemoryDeveloperClient = {
      ownerUserId: userId,
      ...input,
      previousClientSecretHash: null,
      previousClientSecretExpiresAt: null,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
      apiKeys: new Map(),
      webhooks: new Map(),
    };
    this.developerClients.set(client.id, client);
    return this.memoryDeveloperClientView(client);
  }

  async rotateDeveloperOAuthSecret(
    userId: string,
    apiClientId: string,
    nextSecretHash: string,
    previousSecretExpiresAt: Date,
  ): Promise<DeveloperApiClientView | null> {
    const client = this.ownedDeveloperClient(userId, apiClientId);
    if (!client || client.status !== "ACTIVE" || !client.clientSecretHash) return null;
    client.previousClientSecretHash = client.clientSecretHash;
    client.previousClientSecretExpiresAt = previousSecretExpiresAt;
    client.clientSecretHash = nextSecretHash;
    client.updatedAt = new Date();
    return this.memoryDeveloperClientView(client);
  }

  async revokeDeveloperApiClient(userId: string, apiClientId: string): Promise<boolean> {
    const client = this.ownedDeveloperClient(userId, apiClientId);
    if (!client) return false;
    const now = new Date();
    client.status = "REVOKED";
    client.clientSecretHash = null;
    client.previousClientSecretHash = null;
    client.previousClientSecretExpiresAt = null;
    client.updatedAt = now;
    for (const key of client.apiKeys.values()) key.revokedAt ??= now;
    for (const webhook of client.webhooks.values()) {
      webhook.status = "REVOKED";
      webhook.previousSecretHash = null;
      webhook.previousSecretExpiresAt = null;
      webhook.updatedAt = now;
    }
    return true;
  }

  async createDeveloperApiKey(userId: string, input: CreateDeveloperApiKeyRecord): Promise<DeveloperApiClientView | null> {
    const client = this.ownedDeveloperClient(userId, input.apiClientId);
    if (!client || client.status !== "ACTIVE" || !input.scopes.every((scope) => client.scopes.includes(scope))) return null;
    client.apiKeys.set(input.id, { ...input, lastUsedAt: null, revokedAt: null, createdAt: new Date() });
    client.updatedAt = new Date();
    return this.memoryDeveloperClientView(client);
  }

  async rotateDeveloperApiKey(
    userId: string,
    apiClientId: string,
    apiKeyId: string,
    input: CreateDeveloperApiKeyRecord,
    previousKeyExpiresAt: Date,
  ): Promise<DeveloperApiClientView | null> {
    const client = this.ownedDeveloperClient(userId, apiClientId);
    const previous = client?.apiKeys.get(apiKeyId);
    if (!client || client.status !== "ACTIVE" || !previous || previous.revokedAt) return null;
    previous.expiresAt = previous.expiresAt && previous.expiresAt < previousKeyExpiresAt
      ? previous.expiresAt
      : previousKeyExpiresAt;
    client.apiKeys.set(input.id, { ...input, lastUsedAt: null, revokedAt: null, createdAt: new Date() });
    client.updatedAt = new Date();
    return this.memoryDeveloperClientView(client);
  }

  async revokeDeveloperApiKey(userId: string, apiClientId: string, apiKeyId: string): Promise<boolean> {
    const key = this.ownedDeveloperClient(userId, apiClientId)?.apiKeys.get(apiKeyId);
    if (!key) return false;
    key.revokedAt ??= new Date();
    return true;
  }

  async createDeveloperWebhook(userId: string, input: CreateDeveloperWebhookRecord): Promise<DeveloperApiClientView | null> {
    const client = this.ownedDeveloperClient(userId, input.apiClientId);
    if (!client || client.status !== "ACTIVE") return null;
    const now = new Date();
    client.webhooks.set(input.id, {
      ...input,
      status: "ACTIVE",
      previousSecretHash: null,
      previousSecretExpiresAt: null,
      createdAt: now,
      updatedAt: now,
    });
    client.updatedAt = now;
    return this.memoryDeveloperClientView(client);
  }

  async rotateDeveloperWebhookSecret(
    userId: string,
    apiClientId: string,
    webhookId: string,
    nextSecretHash: string,
    previousSecretExpiresAt: Date,
  ): Promise<DeveloperApiClientView | null> {
    const client = this.ownedDeveloperClient(userId, apiClientId);
    const webhook = client?.webhooks.get(webhookId);
    if (!client || client.status !== "ACTIVE" || !webhook || webhook.status !== "ACTIVE") return null;
    webhook.previousSecretHash = webhook.secretHash;
    webhook.previousSecretExpiresAt = previousSecretExpiresAt;
    webhook.secretHash = nextSecretHash;
    webhook.updatedAt = new Date();
    return this.memoryDeveloperClientView(client);
  }

  async revokeDeveloperWebhook(userId: string, apiClientId: string, webhookId: string): Promise<boolean> {
    const webhook = this.ownedDeveloperClient(userId, apiClientId)?.webhooks.get(webhookId);
    if (!webhook) return false;
    webhook.status = "REVOKED";
    webhook.previousSecretHash = null;
    webhook.previousSecretExpiresAt = null;
    webhook.updatedAt = new Date();
    return true;
  }

  async authenticatePublicApiKey(secretHash: string): Promise<PublicApiPrincipal | null> {
    const now = new Date();
    for (const client of this.developerClients.values()) {
      if (client.status !== "ACTIVE") continue;
      const key = [...client.apiKeys.values()].find((candidate) =>
        candidate.secretHash === secretHash && !candidate.revokedAt && (!candidate.expiresAt || candidate.expiresAt > now));
      if (!key) continue;
      key.lastUsedAt = now;
      return {
        clientId: client.clientId,
        scopes: key.scopes.filter((scope) => client.scopes.includes(scope)),
        rateLimitPerMinute: client.rateLimitPerMinute,
      };
    }
    return secretHash === createHash("sha256").update("development-public-key").digest("hex")
      ? { clientId: "development", scopes: ["catalog:read", "leaderboards:read", "profiles:read", "stats:read"], rateLimitPerMinute: 60 }
      : null;
  }

  async authenticatePublicClient(clientId: string, secretHash: string): Promise<PublicApiPrincipal | null> {
    const now = new Date();
    const client = [...this.developerClients.values()].find((candidate) =>
      candidate.clientId === clientId && candidate.status === "ACTIVE");
    if (client && (
      client.clientSecretHash === secretHash ||
      (client.previousClientSecretHash === secretHash && !!client.previousClientSecretExpiresAt && client.previousClientSecretExpiresAt > now)
    )) {
      return { clientId: client.clientId, scopes: [...client.scopes], rateLimitPerMinute: client.rateLimitPerMinute };
    }
    return clientId === "development" && secretHash === createHash("sha256").update("development-client-secret").digest("hex")
      ? { clientId, scopes: ["catalog:read", "leaderboards:read", "profiles:read", "stats:read"], rateLimitPerMinute: 60 }
      : null;
  }

  async getActivePublicClient(clientId: string): Promise<PublicApiPrincipal | null> {
    const client = [...this.developerClients.values()].find((candidate) =>
      candidate.clientId === clientId && candidate.status === "ACTIVE");
    if (client) return { clientId, scopes: [...client.scopes], rateLimitPerMinute: client.rateLimitPerMinute };
    return clientId === "development"
      ? { clientId, scopes: ["catalog:read", "leaderboards:read", "profiles:read", "stats:read"], rateLimitPerMinute: 60 }
      : null;
  }

  async getPublicCatalog() {
    return { contentRelease: release, missions };
  }

  async getPublicLeaderboard(limit: number) {
    return [...this.players.values()]
      .filter((player) => !player.deleted && player.privacy.profilePublic)
      .slice(0, limit).map((player, index) => ({
      rank: index + 1,
      publicPlayerId: createHash("sha256").update(player.profile.id).digest("hex").slice(0, 16),
      displayName: player.profile.displayName,
      score: 0
    }));
  }

  async getPublicProfile(userId: string): Promise<PublicProfileDto | null> {
    const player = this.players.get(userId);
    if (!player || player.deleted || !player.privacy.profilePublic) return null;
    const profile = player.profile;
    return {
      id: profile.id,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      joinedAt: profile.createdAt,
      level: 1,
      seasonRating: null,
      wins: 0,
      losses: 0,
      draws: 0,
    };
  }

  async getPublicAggregateStats(): Promise<PublicAggregateStatsDto> {
    const consented = [...this.players.values()].filter((player) => !player.deleted && player.privacy.analyticsConsent);
    return {
      generatedAt: new Date().toISOString(),
      consentedPlayers: consented.length,
      completedBattles: consented.length > 0
        ? [...this.attempts.values()].filter((attempt) => attempt.status === "completed").length
        : 0,
      completedPvpMatches: 0,
      publishedContentVersion: release.version,
    };
  }

  private profileFromIdentity(userId: string, createdAt: string, identity: TelegramPlayerIdentity): PlayerProfileDto {
    return {
      id: userId,
      telegramUserId: identity.telegramUserId,
      displayName: [identity.firstName, identity.lastName].filter(Boolean).join(" "),
      avatarUrl: identity.photoUrl,
      locale: identity.languageCode ?? "en",
      createdAt
    };
  }

  private ownedDeveloperClient(userId: string, apiClientId: string) {
    const client = this.developerClients.get(apiClientId);
    return client?.ownerUserId === userId ? client : null;
  }

  private memoryDeveloperClientView(client: MemoryDeveloperClient): DeveloperApiClientView {
    const apiKeys: DeveloperApiKeyView[] = [...client.apiKeys.values()]
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map((key) => ({
        id: key.id,
        keyPrefix: key.keyPrefix,
        name: key.name,
        scopes: [...key.scopes],
        lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
        expiresAt: key.expiresAt?.toISOString() ?? null,
        revokedAt: key.revokedAt?.toISOString() ?? null,
        createdAt: key.createdAt.toISOString(),
      }));
    const webhooks: DeveloperWebhookView[] = [...client.webhooks.values()]
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map((webhook) => ({
        id: webhook.id,
        url: webhook.url,
        eventTypes: [...webhook.eventTypes],
        status: webhook.status.toLowerCase() as DeveloperWebhookView["status"],
        previousSecretValidUntil: webhook.previousSecretExpiresAt?.toISOString() ?? null,
        createdAt: webhook.createdAt.toISOString(),
        updatedAt: webhook.updatedAt.toISOString(),
      }));
    return {
      id: client.id,
      clientId: client.clientId,
      name: client.name,
      status: client.status.toLowerCase() as DeveloperApiClientView["status"],
      scopes: [...client.scopes],
      rateLimitPerMinute: client.rateLimitPerMinute,
      previousOAuthSecretValidUntil: client.previousClientSecretExpiresAt?.toISOString() ?? null,
      createdAt: client.createdAt.toISOString(),
      updatedAt: client.updatedAt.toISOString(),
      apiKeys,
      webhooks,
    };
  }

  private requirePlayer(userId: string) {
    const player = this.players.get(userId);
    if (!player) throw new ApiError("player_not_found", 404, "Player not found.");
    return player;
  }

  private mmrCompatible(left: MatchmakingTicketRecord, right: MatchmakingTicketRecord, nowMs: number) {
    const window = (ticket: MatchmakingTicketRecord) => Math.min(
      ticket.policy.maxMmrWindow,
      ticket.policy.baseMmrWindow
        + Math.floor(Math.max(0, nowMs - ticket.createdAt.getTime()) / 1_000) * ticket.policy.expansionPerSecond,
    );
    return Math.abs(left.mmr - right.mmr) <= Math.min(window(left), window(right));
  }

  private async revokeFamily(tokenFamily: string) {
    for (const session of this.sessions.values()) {
      if (session.tokenFamily === tokenFamily) session.status = "revoked";
    }
  }
}
