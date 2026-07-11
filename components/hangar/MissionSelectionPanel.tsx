"use client";

import type { MissionCatalogItemDto, WalletCurrencyDto } from "@spacey/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { UiButton } from "@/components/ui-kit/UiButton";

type MissionSelectionPanelProps = {
  missions: MissionCatalogItemDto[];
  selectedMissionId: string | null;
  onClear: () => void;
  onSelect: (missionId: string) => void;
  onShowBuild: () => void;
};

export function MissionSelectionPanel({
  missions,
  selectedMissionId,
  onClear,
  onSelect,
  onShowBuild
}: MissionSelectionPanelProps) {
  const [previewMissionId, setPreviewMissionId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const previewMission = useMemo(
    () => missions.find((mission) => mission.id === previewMissionId) ?? null,
    [missions, previewMissionId]
  );

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

  return (
    <section className="mission-board" aria-label="Mission Board">
      <div className="mission-board-heading">
        <div>
          <span className="mission-eyebrow">Mission Board</span>
          <strong>Published contracts</strong>
        </div>
        {selectedMissionId ? (
          <button className="mission-clear-selection" onClick={onClear} type="button">Clear selection</button>
        ) : (
          <span className="small">Catalog and rewards are supplied by the active server content release.</span>
        )}
      </div>

      <div className="mission-card-list">
        {missions.map((mission) => {
          const selected = mission.id === selectedMissionId;
          return (
            <button
              aria-pressed={selected}
              className={["mission-card", selected ? "selected" : ""].filter(Boolean).join(" ")}
              key={mission.id}
              onClick={() => setPreviewMissionId(mission.id)}
              type="button"
            >
              <span className="mission-card-topline">
                <span className={`mission-risk mission-risk--${mission.risk}`}>{mission.risk}</span>
                <span className="mission-readiness-score">Server validation</span>
              </span>
              <strong>{mission.name}</strong>
              <span className="mission-card-objective">{mission.objective.label}</span>
              <span className="mission-card-meta">
                {formatDuration(mission.durationSeconds)} · {formatRewardPreview(mission)}
              </span>
              <span className="mission-card-action">{selected ? "Selected · View briefing" : "View briefing"}</span>
            </button>
          );
        })}
      </div>

      {previewMission ? (
        <dialog
          aria-labelledby="mission-briefing-title"
          className="mission-briefing-dialog"
          onCancel={(event) => {
            event.preventDefault();
            setPreviewMissionId(null);
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) setPreviewMissionId(null);
          }}
          ref={dialogRef}
        >
          <div className="mission-briefing-shell">
            <header className="mission-briefing-header">
              <div>
                <span className="mission-eyebrow">Server Content Brief</span>
                <h2 id="mission-briefing-title">{previewMission.name}</h2>
              </div>
              <button
                aria-label="Close mission briefing"
                className="mission-dialog-close"
                onClick={() => setPreviewMissionId(null)}
                ref={closeButtonRef}
                type="button"
              >×</button>
            </header>

            <div className="mission-briefing-summary">
              <span className={`mission-risk mission-risk--${previewMission.risk}`}>{previewMission.risk} risk</span>
              <span>{formatDuration(previewMission.durationSeconds)}</span>
              <span>{formatRewardPreview(previewMission)}</span>
              <span className="mission-state-ready">Validated on launch</span>
            </div>

            <div className="mission-briefing-body">
              <section className="mission-briefing-copy">
                <h3>Briefing</h3>
                <p>{previewMission.briefing}</p>
                <dl className="mission-facts">
                  <div><dt>Objective</dt><dd>{previewMission.objective.label}</dd></div>
                  <div><dt>Target</dt><dd>{previewMission.objective.target}</dd></div>
                  <div><dt>Content version</dt><dd>{previewMission.contentVersion}</dd></div>
                  <div><dt>Reward preview</dt><dd>{formatRewardPreview(previewMission)}</dd></div>
                </dl>
              </section>
              <section className="mission-diagnostics" aria-label="Server validation">
                <div className="mission-diagnostics-title">
                  <h3>Authority</h3>
                  <span>Server</span>
                </div>
                <div className="mission-readiness-group hint">
                  <strong>Launch checks</strong>
                  <span>The API validates the selected immutable build revision, inventory ownership and content version.</span>
                </div>
                <div className="mission-readiness-group hint">
                  <strong>Rewards</strong>
                  <span>The battle worker finalizes rewards; this client only displays the result.</span>
                </div>
              </section>
            </div>

            <footer className="mission-briefing-actions">
              <UiButton onClick={() => {
                setPreviewMissionId(null);
                onShowBuild();
              }} size="sm" variant="secondary">Inspect Ship</UiButton>
              <UiButton disabled={selectedMissionId === previewMission.id} onClick={() => {
                onSelect(previewMission.id);
                setPreviewMissionId(null);
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

function formatDuration(durationSeconds: number) {
  if (durationSeconds < 120) return `${durationSeconds} sec`;
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes} min`;
}

function formatRewardPreview(mission: MissionCatalogItemDto) {
  const labels: Record<WalletCurrencyDto, string> = {
    credits: "Cr",
    scrap: "Scrap",
    alloy: "Alloy",
    dataShards: "Data"
  };
  return (Object.entries(mission.rewardPreview) as Array<[WalletCurrencyDto, number | undefined]>)
    .flatMap(([currency, amount]) => typeof amount === "number" && amount > 0 ? [`${amount} ${labels[currency]}`] : [])
    .join(" · ") || "Server-calculated";
}
