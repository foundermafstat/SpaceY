"use client";

import type {
  AuthSessionDto,
  ApplyShipBuildCommandsRequestDto,
  BattleConnectionDto,
  BattleResultDto,
  BootstrapResponseDto,
  CommitRepairRequestDto,
  CreateMatchmakingTicketRequestDto,
  CreateMissionAttemptRequestDto,
  CreateRepairQuoteRequestDto,
  LegacyBuildImportProposalDto,
  LegacyBuildImportResultDto,
  MissionAttemptStatusDto,
  MatchmakingTicketDto,
  PvpBattleParticipantConnectionDto,
  RefreshSessionResponseDto,
  RepairQuoteDto,
  RepairResultDto,
  ShipBuildDto
} from "@spacey/contracts";

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

export const ACTIVE_MISSION_ATTEMPT_STORAGE_KEY = "spacey.activeMissionAttemptId";

let accessToken: string | null = null;
let refreshPromise: Promise<void> | null = null;

export class ServerApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export function clearAccessToken() {
  accessToken = null;
}

export async function authenticateTelegram(initData: string): Promise<AuthSessionDto> {
  const session = await requestJson<AuthSessionDto>("/api/v1/auth/telegram", {
    method: "POST",
    body: JSON.stringify({ initData })
  });
  accessToken = session.accessToken;
  return session;
}

export async function authenticateDevelopment(): Promise<AuthSessionDto> {
  const session = await requestJson<AuthSessionDto>("/api/v1/auth/development", {
    method: "POST"
  });
  accessToken = session.accessToken;
  return session;
}

export async function refreshAccessToken(): Promise<void> {
  refreshPromise ??= requestJson<RefreshSessionResponseDto>("/api/v1/auth/refresh", {
    method: "POST"
  }).then((session) => {
    accessToken = session.accessToken;
  }).finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

export function getBootstrap(signal?: AbortSignal): Promise<BootstrapResponseDto> {
  return authorizedJson<BootstrapResponseDto>("/api/v1/bootstrap", { signal });
}

export function createMissionAttempt(
  input: CreateMissionAttemptRequestDto,
  signal?: AbortSignal
): Promise<MissionAttemptStatusDto> {
  return authorizedJson<MissionAttemptStatusDto>("/api/v1/mission-attempts", {
    method: "POST",
    body: JSON.stringify(input),
    signal
  });
}

export function applyShipBuildCommands(
  buildId: string,
  input: ApplyShipBuildCommandsRequestDto
): Promise<ShipBuildDto> {
  return authorizedJson<ShipBuildDto>(`/api/v1/builds/${encodeURIComponent(buildId)}/commands`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export function reconnectMissionAttempt(attemptId: string): Promise<BattleConnectionDto> {
  return authorizedJson<BattleConnectionDto>(`/api/v1/mission-attempts/${encodeURIComponent(attemptId)}/connection`, {
    method: "POST"
  });
}

export function abandonMissionAttempt(attemptId: string): Promise<MissionAttemptStatusDto> {
  return authorizedJson<MissionAttemptStatusDto>(`/api/v1/mission-attempts/${encodeURIComponent(attemptId)}/abandon`, {
    method: "POST"
  });
}

export function requestPvpMatchConnection(ticketId: string): Promise<PvpBattleParticipantConnectionDto> {
  return authorizedJson<PvpBattleParticipantConnectionDto>(
    `/api/v1/pvp/matchmaking-tickets/${encodeURIComponent(ticketId)}/connection`,
    { method: "POST" }
  );
}

export function createMatchmakingTicket(
  input: CreateMatchmakingTicketRequestDto
): Promise<MatchmakingTicketDto> {
  return authorizedJson<MatchmakingTicketDto>("/api/v1/pvp/matchmaking-tickets", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function getMatchmakingTicket(ticketId: string): Promise<MatchmakingTicketDto> {
  return authorizedJson<MatchmakingTicketDto>(
    `/api/v1/pvp/matchmaking-tickets/${encodeURIComponent(ticketId)}`
  );
}

export function cancelMatchmakingTicket(ticketId: string): Promise<MatchmakingTicketDto> {
  return authorizedJson<MatchmakingTicketDto>(
    `/api/v1/pvp/matchmaking-tickets/${encodeURIComponent(ticketId)}/cancel`,
    { method: "POST" }
  );
}

export function getMissionAttemptStatus(attemptId: string): Promise<MissionAttemptStatusDto> {
  return authorizedJson<MissionAttemptStatusDto>(`/api/v1/mission-attempts/${encodeURIComponent(attemptId)}`);
}

export function getBattleResult(resultId: string): Promise<BattleResultDto> {
  return authorizedJson<BattleResultDto>(`/api/v1/battle-results/${encodeURIComponent(resultId)}`);
}

export function createRepairQuote(input: CreateRepairQuoteRequestDto): Promise<RepairQuoteDto> {
  return authorizedJson<RepairQuoteDto>("/api/v1/repairs/quotes", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function commitRepair(input: CommitRepairRequestDto): Promise<RepairResultDto> {
  return authorizedJson<RepairResultDto>("/api/v1/repairs", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function submitLegacyBuildV3Proposal(
  proposal: LegacyBuildImportProposalDto
): Promise<LegacyBuildImportResultDto> {
  return authorizedJson<LegacyBuildImportResultDto>("/api/v1/builds/legacy-import-proposals", {
    method: "POST",
    body: JSON.stringify(proposal)
  });
}

async function authorizedJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!accessToken) await refreshAccessToken();
  try {
    return await requestJson<T>(path, withAuthorization(init));
  } catch (error) {
    if (!(error instanceof ServerApiError) || error.status !== 401) throw error;
    clearAccessToken();
    await refreshAccessToken();
    return requestJson<T>(path, withAuthorization(init));
  }
}

function withAuthorization(init: RequestInit): RequestInit {
  if (!accessToken) throw new ServerApiError(401, "access_token_missing", "Access token is missing.");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  return { ...init, headers };
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: "include"
  });

  const body = await parseJson(response);
  if (!response.ok) {
    const error = isRecord(body) && isRecord(body.error) ? body.error : null;
    throw new ServerApiError(
      response.status,
      typeof error?.code === "string" ? error.code : "request_failed",
      typeof error?.message === "string" ? error.message : `Request failed (${response.status}).`
    );
  }
  return body as T;
}

async function parseJson(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return undefined;
  return response.json();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
