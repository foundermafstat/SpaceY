import { createHash } from "node:crypto";

import type { BattleTicketClaims } from "./ports.js";

export function battleTicketKey(rawTicket: string): string {
  return `spacey:ws-ticket:${createHash("sha256").update(rawTicket).digest("hex")}`;
}

export const battleTicketStateKeyPrefix = "spacey:ws-ticket-state:";
export const battleTicketUserKeyPrefix = "spacey:ws-ticket-user:";

export function parseBattleTicketClaims(serialized: string): BattleTicketClaims | null {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return null;
  }
  if (!isRecord(value)
    || !isNonEmptyString(value.sessionId)
    || !isNonEmptyString(value.attemptId)
    || !isNonEmptyString(value.userId)
    || (value.mode !== "pve" && value.mode !== "pvp")) {
    return null;
  }
  if (value.mode === "pvp") {
    if (!isNonEmptyString(value.matchId)
      || !isNonEmptyString(value.participantId)
      || (value.side !== 0 && value.side !== 1)) return null;
    return {
      sessionId: value.sessionId,
      attemptId: value.attemptId,
      userId: value.userId,
      mode: "pvp",
      matchId: value.matchId,
      participantId: value.participantId,
      side: value.side
    };
  }
  return {
    sessionId: value.sessionId,
    attemptId: value.attemptId,
    userId: value.userId,
    mode: "pve"
  };
}

export function checkpointKey(sessionId: string): string {
  return `spacey:battle:checkpoint:${sessionId}`;
}

export function definitionKey(sessionId: string): string {
  return `spacey:battle:definition:${sessionId}`;
}

export function inputJournalKey(sessionId: string): string {
  return `spacey:battle:input-journal:${sessionId}`;
}

export function routeKey(sessionId: string): string {
  return `spacey:battle:route:${sessionId}`;
}

export const pendingPvpSessionsKey = "spacey:battle:pending:pvp:sessions";
export const pendingPvpClaimsKey = "spacey:battle:pending:pvp:claims";
export const pendingPvpClaimLeasesKey = "spacey:battle:pending:pvp:claim-leases";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
