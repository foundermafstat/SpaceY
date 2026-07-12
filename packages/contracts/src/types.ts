export type EntityId = string;
export type IsoTimestamp = string;
export type Cursor = string;
export type JsonValueDto = string | number | boolean | null | JsonValueDto[] | { [key: string]: JsonValueDto };

export type ApiErrorDto = {
  error: {
    code: string;
    message: string;
    correlationId: string;
    details?: Record<string, unknown>;
  };
};

export type CursorPageDto<T> = {
  items: T[];
  nextCursor: Cursor | null;
};

export type WalletCurrencyDto = "credits" | "scrap" | "alloy" | "dataShards";

export type WalletDto = Record<WalletCurrencyDto, number>;

export type PlayerProfileDto = {
  id: EntityId;
  telegramUserId: string;
  displayName: string;
  avatarUrl: string | null;
  locale: string;
  createdAt: IsoTimestamp;
};

export type PrivacyPreferencesDto = {
  profilePublic: boolean;
  analyticsConsent: boolean;
  analyticsConsentUpdatedAt: IsoTimestamp | null;
  updatedAt: IsoTimestamp;
};

export type UpdatePrivacyPreferencesRequestDto = {
  profilePublic: boolean;
  analyticsConsent: boolean;
};

export type PrivacyRequestTypeDto = "export" | "delete";
export type PrivacyRequestStatusDto = "pending" | "processing" | "completed" | "failed";

export type CreatePrivacyRequestDto = {
  type: PrivacyRequestTypeDto;
  idempotencyKey: string;
};

export type PrivacyExportArtifactDto = {
  state: "stored_encrypted";
  contentType: "application/json";
  contentSha256: string;
  sizeBytes: number;
  expiresAt: IsoTimestamp;
};

export type PrivacyRequestDto = {
  id: EntityId;
  type: PrivacyRequestTypeDto;
  status: PrivacyRequestStatusDto;
  requestedAt: IsoTimestamp;
  processingStartedAt: IsoTimestamp | null;
  completedAt: IsoTimestamp | null;
  failedAt: IsoTimestamp | null;
  failureCode: string | null;
  retentionUntil: IsoTimestamp;
  exportArtifact: PrivacyExportArtifactDto | null;
};

export type PrivacyExportDownloadDto = {
  url: string;
  expiresAt: IsoTimestamp;
};

export type TelegramAuthRequestDto = {
  initData: string;
};

export type AuthSessionDto = {
  accessToken: string;
  accessTokenExpiresInSeconds: number;
  refreshSessionExpiresAt: IsoTimestamp;
  profile: PlayerProfileDto;
};

export type RefreshSessionResponseDto = Omit<AuthSessionDto, "profile">;

export type ContentReleaseRefDto = {
  id: EntityId;
  version: string;
  publishedAt: IsoTimestamp;
};

export type MissionObjectiveDto = {
  type: "destroy_all" | "survive_seconds" | "collect_scrap" | "protect_target" | "hold_position";
  target: number;
  label: string;
};

export type MissionCatalogItemDto = {
  id: string;
  contentVersion: string;
  name: string;
  type: "salvage" | "escort" | "mining" | "intercept" | "defense";
  risk: "green" | "yellow" | "red";
  briefing: string;
  durationSeconds: number;
  objective: MissionObjectiveDto;
  rewardPreview: Partial<WalletDto>;
};

export type InventoryItemDto = {
  id: EntityId;
  definitionId: string;
  contentVersion: string;
  rarity: "common" | "uncommon" | "superRare";
  state: "available" | "installed" | "damaged" | "destroyed";
  durability: number;
  category: string;
  shape: { cells: Array<[number, number]> };
  stats: Record<string, JsonValueDto>;
  visualKey: string;
  installedBuildRevisionId: EntityId | null;
  createdAt: IsoTimestamp;
};

export type ShipBuildPartDto = {
  inventoryItemId: EntityId;
  definitionId: string;
  gridX: number;
  gridY: number;
  rotation: 0 | 90 | 180 | 270;
};

export type ShipBuildRevisionDto = {
  id: EntityId;
  buildId: EntityId;
  revision: number;
  name: string;
  parts: ShipBuildPartDto[];
  createdAt: IsoTimestamp;
};

export type ShipBuildDto = {
  id: EntityId;
  activeRevision: ShipBuildRevisionDto;
  updatedAt: IsoTimestamp;
};

export type ShipBuildCommandDto =
  | { type: "rename"; name: string }
  | { type: "install"; inventoryItemId: EntityId; gridX: number; gridY: number; rotation: 0 | 90 | 180 | 270 }
  | { type: "move"; inventoryItemId: EntityId; gridX: number; gridY: number; rotation: 0 | 90 | 180 | 270 }
  | { type: "remove"; inventoryItemId: EntityId };

export type ApplyShipBuildCommandsRequestDto = {
  expectedRevision: number;
  idempotencyKey: string;
  commands: ShipBuildCommandDto[];
};

export type LegacyBuildImportProposalDto = {
  schemaVersion: 3;
  sourceBuildId: string;
  name: string;
  frameId: string;
  cabin?: {
    definitionId: string;
    gridX: number;
    gridY: number;
    rotation: 0 | 90 | 180 | 270;
  };
  parts: Array<{
    sourceInstanceId: string;
    kind: "panel" | "module" | "element";
    definitionId: string;
    gridX: number;
    gridY: number;
    rotation: 0 | 90 | 180 | 270;
  }>;
};

export type LegacyBuildImportResultDto = {
  imported: boolean;
  build: ShipBuildDto;
};

export type BootstrapResponseDto = {
  serverTime: IsoTimestamp;
  profile: PlayerProfileDto;
  wallet: WalletDto;
  activeBuild: ShipBuildDto | null;
  inventory: InventoryItemDto[];
  contentRelease: ContentReleaseRefDto;
  missions: MissionCatalogItemDto[];
  activeGameplay: ActiveGameplayDto[];
  capabilities: {
    pvpMatchmaking: boolean;
    repair: boolean;
  };
};

export type CreateMissionAttemptRequestDto = {
  missionId: string;
  shipBuildRevisionId: EntityId;
  idempotencyKey: string;
};

export type CreateMatchmakingTicketRequestDto = {
  shipBuildRevisionId: EntityId;
  queue: string;
  idempotencyKey: string;
};

export type MatchmakingTicketStatusDto = "queued" | "matched" | "completed" | "cancelled" | "expired" | "failed";

export type MatchmakingTicketDto = {
  id: EntityId;
  queue: string;
  region: string;
  mmr: number;
  status: MatchmakingTicketStatusDto;
  createdAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
  match: null | {
    matchId: EntityId;
    sessionId: EntityId;
    attemptId: EntityId;
    runtimeState: "duel_protocol_unavailable" | "ready";
    connection: null;
  };
};

/** One-time connection for one participant in a server-authoritative PvP duel. */
export type PvpBattleParticipantConnectionDto = BattleConnectionDto & {
  mode: "pvp";
  matchId: EntityId;
  participantId: EntityId;
  side: 0 | 1;
};

export type BattleConnectionDto = {
  sessionId: EntityId;
  attemptId: EntityId;
  mode: "pve" | "pvp";
  websocketUrl: string;
  ticket: string;
  ticketExpiresAt: IsoTimestamp;
  protocolVersion: string;
};

export type MissionAttemptStatusDto = {
  attemptId: EntityId;
  sessionId: EntityId;
  status: "queued" | "active" | "paused" | "completed" | "failed";
  resultId: EntityId | null;
  reconnect: {
    permitted: boolean;
    deadlineAt: IsoTimestamp | null;
    lastAcknowledgedInputSequence: number;
  };
};

export type ActiveGameplayDto =
  | {
      mode: "pve";
      attempt: MissionAttemptStatusDto;
    }
  | {
      mode: "pvp";
      matchmakingTicket: MatchmakingTicketDto;
      attempt: MissionAttemptStatusDto | null;
    };

export type BattleResultDto = {
  id: EntityId;
  attemptId: EntityId;
  mode: "pve" | "pvp";
  outcome: "victory" | "defeat" | "forfeit" | "draw";
  reason: string;
  mission: {
    id: string;
    name: string;
  };
  durationTicks: number;
  finalStateHash: string;
  rewards: Partial<WalletDto>;
  grantedItems: Array<{
    inventoryItemId: EntityId;
    definitionId: string;
    rarity: "common" | "uncommon" | "superRare";
  }>;
  experience: number;
  walletAfter: WalletDto;
  progressionAfter: ProgressionDto;
  moduleDamage: Array<{
    inventoryItemId: EntityId;
    definitionId: string;
    simulationModuleId?: string;
    hpBefore?: number;
    hpAfter?: number;
    hpLoss?: number;
    detached?: boolean;
    durabilityBefore: number;
    durabilityAfter: number;
    damage: number;
    state: "available" | "installed" | "damaged" | "destroyed";
  }>;
  mmr: null | {
    before: number;
    after: number;
  };
  replayStatus: "pending" | "available" | "failed";
  finalizedAt: IsoTimestamp;
};

export type BattleResultPageDto = {
  items: BattleResultDto[];
  nextCursor: string | null;
};

export type CreateRepairQuoteRequestDto = {
  inventoryItemId: EntityId;
  idempotencyKey: string;
};

export type RepairQuoteDto = {
  id: EntityId;
  inventoryItemId: EntityId;
  definitionId: string;
  durabilityBefore: number;
  durabilityAfter: 10000;
  currency: "credits";
  cost: number;
  expiresAt: IsoTimestamp;
};

export type CommitRepairRequestDto = {
  quoteId: EntityId;
  idempotencyKey: string;
};

export type RepairResultDto = {
  quoteId: EntityId;
  inventoryItem: InventoryItemDto;
  walletAfter: WalletDto;
  ledgerEntryId: EntityId;
  repairedAt: IsoTimestamp;
};

export type WalletLedgerEntryDto = {
  id: EntityId;
  currency: WalletCurrencyDto;
  amount: number;
  balanceAfter: number;
  reason: string;
  referenceType: string;
  referenceId: EntityId;
  createdAt: IsoTimestamp;
};

export type ProgressionDto = {
  level: number;
  experience: number;
  researchNodeIds: string[];
  seasonId: EntityId | null;
  seasonRating: number | null;
};

export type PublicCatalogDto = {
  contentRelease: ContentReleaseRefDto;
  missions: MissionCatalogItemDto[];
};

export type PublicLeaderboardEntryDto = {
  rank: number;
  publicPlayerId: string;
  displayName: string;
  score: number;
};

export type PublicProfileDto = {
  id: EntityId;
  displayName: string;
  avatarUrl: string | null;
  joinedAt: IsoTimestamp;
  level: number;
  seasonRating: number | null;
  wins: number;
  losses: number;
  draws: number;
};

export type PublicAggregateStatsDto = {
  generatedAt: IsoTimestamp;
  consentedPlayers: number;
  completedBattles: number;
  completedPvpMatches: number;
  publishedContentVersion: string | null;
};

export type SignedWebhookEnvelopeDto<T = unknown> = {
  id: EntityId;
  type: string;
  apiVersion: string;
  createdAt: IsoTimestamp;
  data: T;
};
