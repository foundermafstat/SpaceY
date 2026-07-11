import type {
  ApplyShipBuildCommandsRequestDto,
  BootstrapResponseDto,
  LegacyBuildImportProposalDto,
  LegacyBuildImportResultDto,
  MissionAttemptStatusDto,
  PlayerProfileDto,
  PrivacyPreferencesDto,
  PrivacyRequestDto,
  CreatePrivacyRequestDto,
  UpdatePrivacyPreferencesRequestDto,
  PublicCatalogDto,
  PublicAggregateStatsDto,
  PublicLeaderboardEntryDto,
  PublicProfileDto,
  ShipBuildDto
} from "@spacey/contracts";
import type { MissionSimulationConfig } from "@spacey/simulation";
import type { DuelSimulationConfig } from "@spacey/simulation";

export const PLATFORM_REPOSITORY = Symbol("PLATFORM_REPOSITORY");

export type TelegramPlayerIdentity = {
  telegramUserId: string;
  username: string | null;
  firstName: string;
  lastName: string | null;
  languageCode: string | null;
  isPremium: boolean;
  photoUrl: string | null;
};

export type RefreshSessionRecord = {
  id: string;
  userId: string;
  tokenFamily: string;
  refreshTokenHash: string;
  status: "active" | "rotated" | "revoked" | "expired";
  expiresAt: Date;
};

export type RotateRefreshSessionResult =
  | { kind: "rotated"; session: RefreshSessionRecord }
  | { kind: "reuse"; userId: string }
  | { kind: "invalid" };

export type MissionAttemptRecord = {
  attemptId: string;
  sessionId: string;
  mode: "pve";
  simulationConfig: MissionSimulationConfig;
};

export type MatchmakingQueuePolicy = {
  baseMmrWindow: number;
  expansionPerSecond: number;
  maxMmrWindow: number;
};

export type MatchmakingTicketRecord = {
  ticketId: string;
  userId: string;
  buildRevisionId: string;
  queue: string;
  region: string;
  mmr: number;
  status: "queued" | "matched" | "completed" | "cancelled" | "expired" | "failed";
  createdAt: Date;
  expiresAt: Date;
  policy: MatchmakingQueuePolicy;
  match: null | {
    matchId: string;
    sessionId: string;
    attemptId: string;
  };
};

export type MaterializedPvpMatch = {
  matchId: string;
  sessionId: string;
  tickets: Array<{ ticketId: string; attemptId: string }>;
};

export type PvpConnectionRecord = {
  ticketId: string;
  sessionId: string;
  attemptId: string;
  userId: string;
  matchId: string;
  participantId: string;
  side: 0 | 1;
  previousTicketHash: string | null;
  simulationConfig: DuelSimulationConfig;
  participants: Array<{ userId: string; attemptId: string; participantId: string; side: 0 | 1 }>;
};

export type PublicApiPrincipal = {
  clientId: string;
  scopes: string[];
  rateLimitPerMinute: number;
};

export type PrivacyExportDownloadTarget = {
  objectKey: string;
  objectVersion: string | null;
  artifactExpiresAt: Date;
};

export interface PlatformRepository {
  ping(): Promise<void>;
  authenticateTelegram(input: {
    initDataHash: string;
    authDate: Date;
    replayExpiresAt: Date;
    identity: TelegramPlayerIdentity;
  }): Promise<PlayerProfileDto>;
  getProfile(userId: string): Promise<PlayerProfileDto | null>;
  getPrivacyPreferences(userId: string): Promise<PrivacyPreferencesDto | null>;
  updatePrivacyPreferences(userId: string, input: UpdatePrivacyPreferencesRequestDto): Promise<PrivacyPreferencesDto>;
  createPrivacyRequest(userId: string, input: CreatePrivacyRequestDto): Promise<PrivacyRequestDto>;
  getPrivacyRequest(userId: string, requestId: string): Promise<PrivacyRequestDto | null>;
  getPrivacyExportDownloadTarget(userId: string, requestId: string): Promise<PrivacyExportDownloadTarget | null>;
  createRefreshSession(input: {
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    ipHash: string | null;
    userAgentHash: string | null;
    maxActiveSessions: number;
  }): Promise<RefreshSessionRecord>;
  rotateRefreshSession(input: {
    currentTokenHash: string;
    nextTokenHash: string;
    nextExpiresAt: Date;
    ipHash: string | null;
    userAgentHash: string | null;
  }): Promise<RotateRefreshSessionResult>;
  revokeRefreshSession(tokenHash: string): Promise<void>;
  revokeAllRefreshSessions(userId: string): Promise<void>;
  getBootstrap(userId: string): Promise<BootstrapResponseDto>;
  applyBuildCommands(
    userId: string,
    buildId: string,
    input: ApplyShipBuildCommandsRequestDto
  ): Promise<ShipBuildDto>;
  importLegacyBuild(userId: string, proposal: LegacyBuildImportProposalDto): Promise<LegacyBuildImportResultDto>;
  createMissionAttempt(input: {
    userId: string;
    missionId: string;
    shipBuildRevisionId: string;
    idempotencyKey: string;
    ticketHash: string;
    ticketExpiresAt: Date;
  }): Promise<MissionAttemptRecord>;
  renewMissionAttemptTicket(input: {
    userId: string;
    attemptId: string;
    ticketHash: string;
    ticketExpiresAt: Date;
  }): Promise<MissionAttemptRecord | null>;
  getMissionAttemptStatus(userId: string, attemptId: string): Promise<MissionAttemptStatusDto | null>;
  createMatchmakingTicket(input: {
    userId: string;
    shipBuildRevisionId: string;
    queue: string;
    idempotencyKey: string;
  }): Promise<MatchmakingTicketRecord>;
  getMatchmakingTicket(userId: string, ticketId: string): Promise<MatchmakingTicketRecord | null>;
  cancelMatchmakingTicket(userId: string, ticketId: string): Promise<MatchmakingTicketRecord | null>;
  materializePvpMatch(input: {
    callerUserId: string;
    leftTicketId: string;
    rightTicketId: string;
  }): Promise<MaterializedPvpMatch>;
  renewPvpConnectionTicket(input: {
    userId: string;
    ticketId: string;
    ticketHash: string;
    ticketExpiresAt: Date;
  }): Promise<PvpConnectionRecord | null>;
  authenticatePublicApiKey(secretHash: string): Promise<PublicApiPrincipal | null>;
  authenticatePublicClient(clientId: string, secretHash: string): Promise<PublicApiPrincipal | null>;
  getPublicCatalog(): Promise<PublicCatalogDto>;
  getPublicLeaderboard(limit: number): Promise<PublicLeaderboardEntryDto[]>;
  getPublicProfile(userId: string): Promise<PublicProfileDto | null>;
  getPublicAggregateStats(): Promise<PublicAggregateStatsDto>;
}
