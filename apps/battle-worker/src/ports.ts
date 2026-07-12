import type { EntityId, IsoTimestamp } from "@spacey/contracts";
import type {
  BattleClientMessage,
  BattleMode,
  BattleServerMessage
} from "@spacey/protocol";
import type {
  DuelOutcome,
  DuelSimulationCheckpoint,
  DuelSimulationConfig,
  MissionOutcome,
  MissionSimulationConfig,
  SimulationCheckpoint
} from "@spacey/simulation";

export type PveBattleTicketClaims = {
  sessionId: EntityId;
  attemptId: EntityId;
  userId: EntityId;
  mode: "pve";
};

export type PvpBattleTicketClaims = {
  sessionId: EntityId;
  attemptId: EntityId;
  userId: EntityId;
  mode: "pvp";
  matchId: EntityId;
  participantId: EntityId;
  side: 0 | 1;
};

export type BattleTicketClaims = PveBattleTicketClaims | PvpBattleTicketClaims;

/**
 * Production implementation hashes the opaque ticket with SHA-256, verifies its
 * version/current key against the attempt state, and consumes it atomically.
 * The Valkey TTL is authoritative.
 */
export interface BattleTicketValidator {
  validateAndConsume(rawTicket: string): Promise<BattleTicketClaims | null>;
}

export interface BattleConnection {
  readonly id: string;
  send(message: BattleServerMessage): void | Promise<void>;
  close(code: number, reason: string): void;
  onMessage(handler: (message: BattleClientMessage) => void | Promise<void>): () => void;
  onClose(handler: () => void | Promise<void>): () => void;
}

export type StoredPveBattleSessionCheckpoint = {
  kind: "pve";
  sessionId: EntityId;
  attemptId: EntityId;
  userId: EntityId;
  mode: BattleMode;
  simulation: SimulationCheckpoint;
  disconnectedAtMs: number | null;
  disconnectDeadlineAtMs: number | null;
  hasConnectedBefore?: boolean;
  completedAtMs?: number | null;
  savedAtMs: number;
};

export type StoredPvpParticipantConnection = {
  userId: EntityId;
  attemptId: EntityId;
  participantId: EntityId;
  side: 0 | 1;
  disconnectedAtMs: number | null;
  disconnectDeadlineAtMs: number | null;
  hasConnectedBefore?: boolean;
};

export type StoredPvpBattleSessionCheckpoint = {
  kind: "pvp";
  sessionId: EntityId;
  matchId: EntityId;
  started: boolean;
  readyDeadlineAtMs?: number;
  completedAtMs?: number | null;
  simulation: DuelSimulationCheckpoint;
  participants: [StoredPvpParticipantConnection, StoredPvpParticipantConnection];
  savedAtMs: number;
};

export type StoredBattleSessionCheckpoint = StoredPveBattleSessionCheckpoint | StoredPvpBattleSessionCheckpoint;

export interface BattleCheckpointStore {
  load(sessionId: EntityId): Promise<StoredBattleSessionCheckpoint | null>;
  save(checkpoint: StoredBattleSessionCheckpoint): Promise<void>;
  delete(sessionId: EntityId): Promise<void>;
}

export interface BattleSessionDefinitionStore {
  load(sessionId: EntityId): Promise<CreateBattleSessionRequest | null>;
  save(request: CreateBattleSessionRequest, ttlSeconds: number): Promise<void>;
  delete(sessionId: EntityId): Promise<void>;
}

export interface BattleInputJournal {
  append(sessionId: EntityId, userId: EntityId, input: import("@spacey/simulation").SimulationInputCommand): Promise<void>;
  readAfter(
    sessionId: EntityId,
    userId: EntityId,
    sequence: number
  ): Promise<import("@spacey/simulation").SimulationInputCommand[]>;
  readAll(sessionId: EntityId): Promise<Array<{
    userId: EntityId;
    input: import("@spacey/simulation").SimulationInputCommand;
  }>>;
  delete(sessionId: EntityId): Promise<void>;
}

export type BattleRouteLease = {
  workerId: string;
  endpoint: string;
};

export interface BattleSessionRouter {
  claim(sessionId: EntityId, lease: BattleRouteLease, ttlSeconds: number): Promise<boolean>;
  refresh(sessionId: EntityId, lease: BattleRouteLease, ttlSeconds: number): Promise<boolean>;
  release(sessionId: EntityId, lease: BattleRouteLease): Promise<void>;
}

export type PendingPvpSessionCursor = {
  createdAtMs: number;
  sessionId: EntityId;
};

export interface PendingPvpSessionQueue {
  claimBatch(workerId: string, nowMs: number, limit: number, leaseMs: number): Promise<EntityId[]>;
  release(sessionId: EntityId, workerId: string, availableAtMs: number): Promise<void>;
  complete(sessionId: EntityId, workerId: string): Promise<void>;
}

export interface PendingPvpSessionSource {
  listPendingPvpSessions(
    after: PendingPvpSessionCursor | null,
    limit: number,
  ): Promise<{ sessions: CreatePvpBattleSessionRequest[]; nextCursor: PendingPvpSessionCursor | null }>;
}

export type ReplayArtifactMetadata = {
  storageKey: string;
  checksumSha256: string;
  compression: "gzip";
  sizeBytes: number;
  tickCount: number;
  expiresAt: IsoTimestamp;
};

export type StorePveReplayRequest = {
  kind: "pve";
  simulationConfig: MissionSimulationConfig;
  finalCheckpoint: SimulationCheckpoint;
  inputs: import("@spacey/simulation").SimulationInputCommand[];
  outcome: MissionOutcome;
  completedAtMs: number;
};

export type StorePvpReplayRequest = {
  kind: "pvp";
  simulationConfig: DuelSimulationConfig;
  finalCheckpoint: DuelSimulationCheckpoint;
  inputs: Array<{ userId: EntityId; input: import("@spacey/simulation").SimulationInputCommand }>;
  outcome: DuelOutcome;
  completedAtMs: number;
};

export type StoreReplayRequest = StorePveReplayRequest | StorePvpReplayRequest;

export interface BattleReplayStorage {
  store(request: StoreReplayRequest): Promise<ReplayArtifactMetadata>;
  ping(): Promise<void>;
}

export type FinalizeBattleRequest = {
  idempotencyKey: string;
  sessionId: EntityId;
  attemptId: EntityId;
  userId: EntityId;
  mode: BattleMode;
  simulationConfig: MissionSimulationConfig;
  finalCheckpoint: SimulationCheckpoint;
  replay: ReplayArtifactMetadata | null;
  outcome: MissionOutcome;
};

export type FinalizeBattleResult = {
  resultId: EntityId;
};

type FinalizeDuelRequestBase = {
  idempotencyKey: string;
  sessionId: EntityId;
  matchId: EntityId;
  participants: [
    { userId: EntityId; attemptId: EntityId; participantId: EntityId; side: 0 | 1 },
    { userId: EntityId; attemptId: EntityId; participantId: EntityId; side: 0 | 1 }
  ];
  simulationConfig: DuelSimulationConfig;
  finalCheckpoint: DuelSimulationCheckpoint;
  outcome: DuelOutcome;
};

export type FinalizeDuelRequest = FinalizeDuelRequestBase & (
  | { cancellation: null; replay: ReplayArtifactMetadata | null }
  | { cancellation: "no_show_forfeit" | "no_contest"; replay: null }
);

export type FinalizeDuelResult = {
  resultIds: Record<string, EntityId>;
};

export type AttachReplayRequest = {
  idempotencyKey: string;
  replay: ReplayArtifactMetadata;
} & (
  | { kind: "pve"; attemptId: EntityId }
  | { kind: "pvp"; matchId: EntityId }
);

/** Result finalization commits gameplay state first; replay attachment is a separate idempotent transaction. */
export interface BattleFinalizer {
  finalizeOnce(request: FinalizeBattleRequest): Promise<FinalizeBattleResult>;
  finalizeDuelOnce(request: FinalizeDuelRequest): Promise<FinalizeDuelResult>;
  attachReplayOnce(request: AttachReplayRequest): Promise<void>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

export interface BattleAttemptLifecycle {
  markConnected(input: {
    attemptId: EntityId;
    userId: EntityId;
    connectedAtMs: number;
  }): Promise<void>;
  markDisconnected(input: {
    attemptId: EntityId;
    userId: EntityId;
    mode: BattleMode;
    disconnectedAtMs: number;
    reconnectDeadlineAtMs: number;
  }): Promise<void>;
}

export interface BattleWorkerLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export interface BattleWorkerClock {
  nowMs(): number;
}

export type CreatePveBattleSessionRequest = {
  kind: "pve";
  userId: EntityId;
  simulationConfig: MissionSimulationConfig;
};

export type CreatePvpBattleSessionRequest = {
  kind: "pvp";
  participants: [
    { userId: EntityId; attemptId: EntityId; participantId: EntityId; side: 0 | 1 },
    { userId: EntityId; attemptId: EntityId; participantId: EntityId; side: 0 | 1 }
  ];
  simulationConfig: DuelSimulationConfig;
  /** Anchored to match materialization, not to whichever worker happens to claim it. */
  readyDeadlineAtMs?: number;
  /** PostgreSQL already committed results; recovery must only finish replay attachment/cleanup. */
  databaseFinalized?: boolean;
};

export type CreateBattleSessionRequest = CreatePveBattleSessionRequest | CreatePvpBattleSessionRequest;

export interface BattleSessionRuntime {
  readonly activeSessionCount: number;
  attachConnection(claims: BattleTicketClaims, connection: BattleConnection): Promise<boolean>;
  advanceOneTick(nowMs?: number): Promise<void>;
  flushCheckpoints(): Promise<void>;
}
