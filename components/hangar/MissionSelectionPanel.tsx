"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { UiButton } from "@/components/ui-kit/UiButton";
import { getMissionById, missionDefs } from "@/game/data/missions";
import { evaluateMissionReadiness } from "@/game/mission/readiness";
import type { MissionDef, MissionId, MissionReadinessIssue } from "@/game/mission/types";
import type { ShipBuild } from "@/game/types";

type MissionSelectionPanelProps = {
  build: ShipBuild;
  selectedMissionId: MissionId | null;
  onClear: () => void;
  onSelect: (missionId: MissionId) => void;
  onShowBuild: () => void;
};

export function MissionSelectionPanel({
  build,
  selectedMissionId,
  onClear,
  onSelect,
  onShowBuild
}: MissionSelectionPanelProps) {
  const [previewMissionId, setPreviewMissionId] = useState<MissionId | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const readinessByMission = useMemo(
    () => new Map(missionDefs.map((mission) => [mission.id, evaluateMissionReadiness(build, mission)])),
    [build]
  );
  const previewMission = previewMissionId ? getMissionById(previewMissionId) : null;
  const previewReadiness = previewMission ? readinessByMission.get(previewMission.id) ?? null : null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!previewMission || !dialog) return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setPreviewMissionId(null);
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (dialog.open) dialog.close();
      previousFocusRef.current?.focus();
    };
  }, [previewMission]);

  function closeBriefing() {
    setPreviewMissionId(null);
  }

  return (
    <section className="mission-board" aria-label="Mission Board">
      <div className="mission-board-heading">
        <div>
          <span className="mission-eyebrow">Mission Board</span>
          <strong>Green contracts</strong>
        </div>
        {selectedMissionId ? (
          <button className="mission-clear-selection" onClick={onClear} type="button">
            Clear selection
          </button>
        ) : (
          <span className="small">Choose the engineering problem before the fight.</span>
        )}
      </div>

      <div className="mission-card-list">
        {missionDefs.map((mission) => {
          const readiness = readinessByMission.get(mission.id);
          const selected = mission.id === selectedMissionId;

          return (
            <button
              aria-pressed={selected}
              className={["mission-card", selected ? "selected" : "", readiness?.blockers.length ? "blocked" : ""].filter(Boolean).join(" ")}
              key={mission.id}
              onClick={() => setPreviewMissionId(mission.id)}
              type="button"
            >
              <span className="mission-card-topline">
                <span className={`mission-risk mission-risk--${mission.risk}`}>{mission.risk}</span>
                <span className={`mission-readiness-score ${readiness?.blockers.length ? "blocked" : ""}`}>
                  {readiness?.blockers.length ? "Blocked" : `${readiness?.score ?? 0}% ready`}
                </span>
              </span>
              <strong>{mission.name}</strong>
              <span className="mission-card-objective">{mission.objective.label}</span>
              <span className="mission-card-meta">
                {formatDuration(mission.durationSec)} · {mission.rewards.credits} Cr · {mission.rewards.scrap} Scrap
              </span>
              <span className="mission-card-action">{selected ? "Selected · View briefing" : "View briefing"}</span>
            </button>
          );
        })}
      </div>

      {previewMission && previewReadiness ? (
        <dialog
          aria-labelledby="mission-briefing-title"
          className="mission-briefing-dialog"
          onCancel={(event) => {
            event.preventDefault();
            closeBriefing();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) closeBriefing();
          }}
          ref={dialogRef}
        >
          <div className="mission-briefing-shell">
            <header className="mission-briefing-header">
              <div>
                <span className="mission-eyebrow">Engineering Brief</span>
                <h2 id="mission-briefing-title">{previewMission.name}</h2>
              </div>
              <button
                aria-label="Close mission briefing"
                className="mission-dialog-close"
                onClick={closeBriefing}
                ref={closeButtonRef}
                type="button"
              >
                ×
              </button>
            </header>

            <div className="mission-briefing-summary">
              <span className={`mission-risk mission-risk--${previewMission.risk}`}>{previewMission.risk} risk</span>
              <span>{formatDuration(previewMission.durationSec)}</span>
              <span>{previewMission.rewards.credits} Cr + {previewMission.rewards.scrap} Scrap</span>
              <span className={previewReadiness.blockers.length ? "mission-state-blocked" : "mission-state-ready"}>
                {previewReadiness.blockers.length ? "Launch blocked" : `${previewReadiness.score}% ready`}
              </span>
            </div>

            <div className="mission-briefing-body">
              <section className="mission-briefing-copy">
                <h3>Briefing</h3>
                <p>{previewMission.briefing}</p>
                <dl className="mission-facts">
                  <div>
                    <dt>Objective</dt>
                    <dd>{previewMission.objective.label}</dd>
                  </div>
                  <div>
                    <dt>Reward preview</dt>
                    <dd>
                      {formatRewardPreview(previewMission)}
                    </dd>
                  </div>
                  <div>
                    <dt>Hard requirements</dt>
                    <dd>
                      {previewMission.hardRequirements.requiredTags?.length
                        ? previewMission.hardRequirements.requiredTags.map(formatTag).join(", ")
                        : "None"}
                    </dd>
                  </div>
                  <div>
                    <dt>Hazards</dt>
                    <dd>{previewMission.hazards.join(", ")}</dd>
                  </div>
                </dl>
              </section>

              <section className="mission-diagnostics" aria-label="Current ship readiness">
                <div className="mission-diagnostics-title">
                  <h3>Current ship</h3>
                  <span>{previewReadiness.score}%</span>
                </div>
                <ReadinessGroup empty="No mission blockers" issues={previewReadiness.blockers} label="Blockers" tone="danger" />
                <ReadinessGroup empty="Recommendations met" issues={previewReadiness.warnings} label="Warnings" tone="warn" />
                <ReadinessGroup empty="No additional notes" issues={previewReadiness.hints} label="Ready" tone="hint" />
                {previewReadiness.recommendedChanges.length ? (
                  <div className="mission-recommended-changes">
                    <strong>Suggested changes</strong>
                    <ul>
                      {previewReadiness.recommendedChanges.map((change) => <li key={change}>{change}</li>)}
                    </ul>
                  </div>
                ) : null}
              </section>
            </div>

            <footer className="mission-briefing-actions">
              <UiButton onClick={() => {
                closeBriefing();
                onShowBuild();
              }} size="sm" variant="secondary">
                Modify Ship
              </UiButton>
              <UiButton disabled={selectedMissionId === previewMission.id} onClick={() => {
                onSelect(previewMission.id);
                closeBriefing();
                onShowBuild();
              }} size="sm" variant="primary">
                {selectedMissionId === previewMission.id ? "Selected" : "Accept Contract"}
              </UiButton>
            </footer>
          </div>
        </dialog>
      ) : null}
    </section>
  );
}

function ReadinessGroup({
  empty,
  issues,
  label,
  tone
}: {
  empty: string;
  issues: MissionReadinessIssue[];
  label: string;
  tone: "danger" | "warn" | "hint";
}) {
  return (
    <div className={`mission-readiness-group ${tone}`}>
      <strong>{label}</strong>
      {issues.length ? (
        <ul>
          {issues.map((issue) => <li key={issue.code}>{issue.message}</li>)}
        </ul>
      ) : (
        <span>{empty}</span>
      )}
    </div>
  );
}

function formatDuration(durationSec: number) {
  if (durationSec < 120) return `${durationSec} sec`;
  const minutes = Math.floor(durationSec / 60);
  const seconds = durationSec % 60;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes} min`;
}

function formatTag(tag: string) {
  return tag.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function formatRewardPreview(mission: MissionDef) {
  return [
    `${mission.rewards.credits} Credits`,
    `${mission.rewards.scrap} Scrap`,
    mission.rewards.alloy ? `${mission.rewards.alloy} Alloy` : null,
    mission.rewards.dataShards ? `${mission.rewards.dataShards} Data Shards` : null,
    ...mission.rewards.bonuses.map((bonus) => bonus.label)
  ].filter(Boolean).join(" · ");
}
