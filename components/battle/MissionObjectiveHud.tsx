import type { MissionDef } from "@/game/mission/types";
import type { BattleTelemetry, BattleVitalSnapshot } from "@/game/mission/runtime";

type MissionObjectiveHudProps = {
  mission: MissionDef;
  telemetry: BattleTelemetry | null;
};

type VitalLevel = "normal" | "warning" | "critical";

const vitalLabels = {
  hull: "Hull",
  shield: "Shield",
  energy: "Energy",
  heat: "Heat"
} as const;

export function MissionObjectiveHud({ mission, telemetry }: MissionObjectiveHudProps) {
  const runtime = telemetry?.runtime ?? null;
  const progress = runtime?.objective.progress ?? 0;
  const target = runtime?.objective.target ?? mission.objective.target;
  const progressPercent = clampPercent(progress, target);
  const remainingSec = runtime?.remainingSec ?? mission.durationSec;
  const statusLabel = runtime?.status === "victory"
    ? "Complete"
    : runtime?.status === "defeat"
      ? "Failed"
      : runtime
        ? "Active"
        : "Linking";

  return (
    <section className="mission-objective-hud panel" aria-label="Mission status">
      <div className="mission-hud-heading">
        <span className="mission-eyebrow">Active contract · {statusLabel}</span>
        <strong title={mission.name}>{mission.name}</strong>
      </div>
      <time className="mission-hud-timer" dateTime={`PT${Math.ceil(remainingSec)}S`}>
        T-{formatClock(remainingSec)}
      </time>

      <div className="mission-hud-objective-row">
        <span>{mission.objective.label}</span>
        <strong>{formatProgress(mission, progress, target)}</strong>
      </div>
      <div
        aria-label="Objective progress"
        aria-valuemax={target}
        aria-valuemin={0}
        aria-valuenow={Math.min(target, progress)}
        className="mission-hud-progress"
        role="progressbar"
      >
        <span style={{ width: `${progressPercent}%` }} />
      </div>

      <div className="mission-hud-meta">
        <span className="mission-hud-hazard" title={mission.hazards.join(", ")}>
          Hazard · {mission.hazards[0]}
        </span>
      </div>

      <dl className="mission-hud-vitals">
        {(Object.keys(vitalLabels) as Array<keyof typeof vitalLabels>).map((key) => (
          <Vital
            heat={key === "heat"}
            key={key}
            label={vitalLabels[key]}
            value={telemetry?.vitals[key] ?? null}
          />
        ))}
      </dl>
    </section>
  );
}

function Vital({
  heat,
  label,
  value
}: {
  heat: boolean;
  label: string;
  value: BattleVitalSnapshot | null;
}) {
  const percent = value ? clampPercent(value.current, value.max) : 0;
  const level = value ? getVitalLevel(percent, heat) : "normal";

  return (
    <div className="mission-hud-vital" data-level={level}>
      <dt>{label}</dt>
      <dd>{value ? Math.max(0, Math.ceil(value.current)) : "—"}</dd>
      <span
        aria-label={`${label} level`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(percent)}
        className="mission-hud-vital-meter"
        role="progressbar"
      >
        <span style={{ width: `${percent}%` }} />
      </span>
    </div>
  );
}

function getVitalLevel(percent: number, heat: boolean): VitalLevel {
  if (heat) {
    if (percent >= 85) return "critical";
    if (percent >= 65) return "warning";
    return "normal";
  }
  if (percent <= 25) return "critical";
  if (percent <= 50) return "warning";
  return "normal";
}

function formatProgress(mission: MissionDef, progress: number, target: number) {
  if (mission.objective.type === "destroy_all") {
    return `${Math.floor(progress)}/${target} cleared`;
  }
  return `${Math.floor(progress)}/${target}s`;
}

function formatClock(seconds: number) {
  const wholeSeconds = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(wholeSeconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(wholeSeconds % 60).padStart(2, "0")}`;
}

function clampPercent(value: number, max: number) {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.min(100, Math.max(0, (value / max) * 100));
}
