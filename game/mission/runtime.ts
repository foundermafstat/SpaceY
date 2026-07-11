import type {
  MissionDef,
  MissionId,
  MissionObjectiveType,
  MissionRewardGrant
} from "@/game/mission/types";

export type RuntimeMissionObjectiveType = Extract<
  MissionObjectiveType,
  "destroy_all" | "survive_seconds"
>;

export type MissionRuntimeStatus = "active" | "victory" | "defeat";
export type MissionResultReason = "objective_complete" | "player_destroyed" | "time_expired";

export type BattleVitalSnapshot = {
  current: number;
  max: number;
};

export type BattleVitalsSnapshot = {
  hull: BattleVitalSnapshot;
  shield: BattleVitalSnapshot;
  energy: BattleVitalSnapshot;
  heat: BattleVitalSnapshot;
};

export type MissionRuntimeState = {
  attemptId: string;
  missionId: MissionId;
  status: MissionRuntimeStatus;
  elapsedSec: number;
  remainingSec: number;
  durationSec: number;
  objective: {
    type: RuntimeMissionObjectiveType;
    progress: number;
    target: number;
  };
  enemiesTotal: number;
  enemiesRemaining: number;
  enemiesDestroyed: number;
  damageTaken: number;
  damagedPartIds: string[];
  detachedPartIds: string[];
};

export type MissionRuntimeUpdate = {
  deltaSec: number;
  playerAlive: boolean;
  enemiesRemaining: number;
  damageTaken: number;
  damagedPartIds: string[];
  detachedPartIds: string[];
};

export type MissionResult = {
  attemptId: string;
  missionId: MissionId;
  outcome: Exclude<MissionRuntimeStatus, "active">;
  reason: MissionResultReason;
  durationSec: number;
  remainingSec: number;
  objective: MissionRuntimeState["objective"];
  enemiesDestroyed: number;
  damageTaken: number;
  damagedPartIds: string[];
  detachedPartIds: string[];
  rewards: MissionRewardGrant[];
};

export type BattleTelemetry = {
  runtime: MissionRuntimeState;
  vitals: BattleVitalsSnapshot;
};

export function createMissionRuntime(
  mission: MissionDef,
  enemiesTotal: number,
  attemptId: string
): MissionRuntimeState {
  const objectiveType = assertRuntimeObjective(mission.objective.type);
  const normalizedEnemiesTotal = Math.max(0, Math.floor(enemiesTotal));

  if (objectiveType === "destroy_all" && mission.objective.target !== normalizedEnemiesTotal) {
    throw new Error(
      `Mission ${mission.id} expects ${mission.objective.target} enemies, received ${normalizedEnemiesTotal}.`
    );
  }
  if (objectiveType === "survive_seconds" && mission.objective.target > mission.durationSec) {
    throw new Error(`Mission ${mission.id} objective exceeds its duration.`);
  }

  return {
    attemptId,
    missionId: mission.id,
    status: "active",
    elapsedSec: 0,
    remainingSec: mission.durationSec,
    durationSec: mission.durationSec,
    objective: {
      type: objectiveType,
      progress: 0,
      target: mission.objective.target
    },
    enemiesTotal: normalizedEnemiesTotal,
    enemiesRemaining: normalizedEnemiesTotal,
    enemiesDestroyed: 0,
    damageTaken: 0,
    damagedPartIds: [],
    detachedPartIds: []
  };
}

export function updateMissionRuntime(
  current: MissionRuntimeState,
  update: MissionRuntimeUpdate
): { state: MissionRuntimeState; result: MissionResult | null } {
  if (current.status !== "active") return { state: current, result: null };

  const elapsedSec = Math.min(
    current.durationSec,
    current.elapsedSec + Math.max(0, update.deltaSec)
  );
  const enemiesRemaining = clamp(
    Math.floor(update.enemiesRemaining),
    0,
    current.enemiesTotal
  );
  const enemiesDestroyed = current.enemiesTotal - enemiesRemaining;
  const objectiveProgress = current.objective.type === "destroy_all"
    ? enemiesDestroyed
    : Math.min(current.objective.target, elapsedSec);
  const remainingSec = Math.max(0, current.durationSec - elapsedSec);
  const objectiveComplete = objectiveProgress >= current.objective.target;
  const timedOut = remainingSec <= 0;
  const status: MissionRuntimeStatus = !update.playerAlive
    ? "defeat"
    : objectiveComplete
      ? "victory"
      : timedOut
        ? "defeat"
        : "active";
  const reason: MissionResultReason | null = !update.playerAlive
    ? "player_destroyed"
    : objectiveComplete
      ? "objective_complete"
      : timedOut
        ? "time_expired"
        : null;
  const state: MissionRuntimeState = {
    ...current,
    status,
    elapsedSec,
    remainingSec,
    objective: { ...current.objective, progress: objectiveProgress },
    enemiesRemaining,
    enemiesDestroyed,
    damageTaken: Math.max(0, update.damageTaken),
    damagedPartIds: [...update.damagedPartIds],
    detachedPartIds: [...update.detachedPartIds]
  };

  return {
    state,
    result: reason ? createMissionResult(state, reason) : null
  };
}

function createMissionResult(
  state: MissionRuntimeState,
  reason: MissionResultReason
): MissionResult {
  return {
    attemptId: state.attemptId,
    missionId: state.missionId,
    outcome: state.status === "victory" ? "victory" : "defeat",
    reason,
    durationSec: state.elapsedSec,
    remainingSec: state.remainingSec,
    objective: { ...state.objective },
    enemiesDestroyed: state.enemiesDestroyed,
    damageTaken: state.damageTaken,
    damagedPartIds: [...state.damagedPartIds],
    detachedPartIds: [...state.detachedPartIds],
    rewards: []
  };
}

function assertRuntimeObjective(type: MissionObjectiveType): RuntimeMissionObjectiveType {
  if (type === "destroy_all" || type === "survive_seconds") return type;
  throw new Error(`Mission objective ${type} is not supported by the battle runtime.`);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
