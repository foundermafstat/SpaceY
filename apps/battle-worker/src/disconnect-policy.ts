export const DEFAULT_DISCONNECT_GRACE_MS = 60_000;

export type DisconnectMode = "pve" | "pvp";
export type DisconnectedAction = "advance" | "pause" | "neutral_input" | "forfeit";

export type ConnectionPolicyState = {
  mode: DisconnectMode;
  connected: boolean;
  disconnectedAtMs: number | null;
  deadlineAtMs: number | null;
  forfeited: boolean;
};

export function createConnectionPolicy(mode: DisconnectMode): ConnectionPolicyState {
  return {
    mode,
    connected: true,
    disconnectedAtMs: null,
    deadlineAtMs: null,
    forfeited: false
  };
}

export function restoreConnectionPolicy(
  mode: DisconnectMode,
  disconnectedAtMs: number | null,
  deadlineAtMs: number | null
): ConnectionPolicyState {
  return {
    mode,
    connected: disconnectedAtMs === null,
    disconnectedAtMs,
    deadlineAtMs,
    forfeited: false
  };
}

export function markDisconnected(
  state: ConnectionPolicyState,
  nowMs: number,
  graceMs = DEFAULT_DISCONNECT_GRACE_MS
): ConnectionPolicyState {
  if (!state.connected || state.forfeited) return state;
  return {
    ...state,
    connected: false,
    disconnectedAtMs: nowMs,
    deadlineAtMs: nowMs + graceMs
  };
}

export function reconnect(
  state: ConnectionPolicyState,
  nowMs: number
): { accepted: boolean; state: ConnectionPolicyState } {
  if (state.forfeited || (state.deadlineAtMs !== null && nowMs >= state.deadlineAtMs)) {
    return { accepted: false, state: { ...state, forfeited: true } };
  }
  return {
    accepted: true,
    state: {
      ...state,
      connected: true,
      disconnectedAtMs: null,
      deadlineAtMs: null
    }
  };
}

export function disconnectedAction(
  state: ConnectionPolicyState,
  nowMs: number
): { action: DisconnectedAction; state: ConnectionPolicyState } {
  if (state.forfeited) return { action: "forfeit", state };
  if (state.connected) return { action: "advance", state };
  if (state.deadlineAtMs === null || nowMs >= state.deadlineAtMs) {
    return { action: "forfeit", state: { ...state, forfeited: true } };
  }
  return { action: state.mode === "pve" ? "pause" : "neutral_input", state };
}
