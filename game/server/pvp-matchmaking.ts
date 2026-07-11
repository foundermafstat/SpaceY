import type { MatchmakingTicketDto } from "@spacey/contracts";

export type PvpMatchmakingClientAction =
  | { type: "poll" }
  | { type: "connect" }
  | { type: "terminal"; message: string };

export function resolvePvpMatchmakingAction(ticket: MatchmakingTicketDto): PvpMatchmakingClientAction {
  if (ticket.status === "queued") return { type: "poll" };
  if (ticket.status === "matched" && ticket.match?.runtimeState === "ready") return { type: "connect" };
  if (ticket.status === "matched") {
    return { type: "terminal", message: "The authoritative PvP runtime is temporarily unavailable." };
  }
  return { type: "terminal", message: `Matchmaking ticket is ${ticket.status}.` };
}
