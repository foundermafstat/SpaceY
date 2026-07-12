"use client";

import type {
  ActiveGameplayDto,
  InventoryItemDto,
  ShipBuildCommandDto,
  ShipBuildPartDto
} from "@spacey/contracts";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MissionSelectionPanel } from "@/components/hangar/MissionSelectionPanel";
import { WalletStrip } from "@/components/hangar/WalletStrip";
import { UiButton } from "@/components/ui-kit/UiButton";
import {
  ACTIVE_MISSION_ATTEMPT_STORAGE_KEY,
  abandonMissionAttempt,
  cancelMatchmakingTicket,
  createMatchmakingTicket,
  createMissionAttempt,
  getMissionAttemptStatus
} from "@/game/server/api-client";
import { useServerSession } from "@/game/server/session-context";

type HangarSection = "contracts" | "build" | "inventory";

export default function HangarPage() {
  const router = useRouter();
  const { bootstrap, mutateActiveBuild, refreshBootstrap } = useServerSession();
  const build = bootstrap.activeBuild;
  const parts = build?.activeRevision.parts ?? [];
  const availableInventory = bootstrap.inventory.filter((item) => item.state === "available");
  const [section, setSection] = useState<HangarSection>("contracts");
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [selectedInventoryId, setSelectedInventoryId] = useState<string | null>(null);
  const [buildName, setBuildName] = useState(build?.activeRevision.name ?? "");
  const [saving, setSaving] = useState(false);
  const [launchingMission, setLaunchingMission] = useState(false);
  const [matchmaking, setMatchmaking] = useState(false);
  const [activeGameplay, setActiveGameplay] = useState<ActiveGameplayDto | null>(bootstrap.activeGameplay[0] ?? null);
  const [endingActiveGameplay, setEndingActiveGameplay] = useState(false);
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const [serverMessageIsError, setServerMessageIsError] = useState(false);
  const missionLaunchRef = useRef<{ key: string; idempotencyKey: string } | null>(null);

  const selectedMission = bootstrap.missions.find((mission) => mission.id === selectedMissionId) ?? null;
  const selectedPart = parts.find((part) => part.inventoryItemId === selectedPartId) ?? null;
  const selectedInventory = availableInventory.find((item) => item.id === selectedInventoryId) ?? null;

  useEffect(() => {
    setBuildName(build?.activeRevision.name ?? "");
  }, [build?.activeRevision.id, build?.activeRevision.name]);

  useEffect(() => {
    if (selectedMissionId && !bootstrap.missions.some((mission) => mission.id === selectedMissionId)) {
      setSelectedMissionId(null);
    }
  }, [bootstrap.missions, selectedMissionId]);

  useEffect(() => {
    const syncHash = () => {
      const hash = window.location.hash.slice(1);
      if (hash === "contracts" || hash === "build" || hash === "inventory") setSection(hash);
    };
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  useEffect(() => {
    const serverGameplay = bootstrap.activeGameplay[0] ?? null;
    if (serverGameplay) {
      setActiveGameplay(serverGameplay);
      if (serverGameplay.mode === "pve") {
        window.sessionStorage.setItem(ACTIVE_MISSION_ATTEMPT_STORAGE_KEY, serverGameplay.attempt.attemptId);
      } else {
        window.sessionStorage.removeItem(ACTIVE_MISSION_ATTEMPT_STORAGE_KEY);
      }
      return;
    }
    const attemptId = window.sessionStorage.getItem(ACTIVE_MISSION_ATTEMPT_STORAGE_KEY);
    if (!attemptId) {
      setActiveGameplay(null);
      return;
    }
    let active = true;
    void getMissionAttemptStatus(attemptId).then((status) => {
      if (!active) return;
      if (status.status === "completed" || status.status === "failed") {
        window.sessionStorage.removeItem(ACTIVE_MISSION_ATTEMPT_STORAGE_KEY);
        setActiveGameplay(null);
        return;
      }
      setActiveGameplay({ mode: "pve", attempt: status });
    }).catch(() => {
      if (active) setServerMessage("Saved mission attempt status is temporarily unavailable.");
    });
    return () => {
      active = false;
    };
  }, [bootstrap.activeGameplay]);

  const showSection = useCallback((nextSection: HangarSection) => {
    setSection(nextSection);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${nextSection}`);
  }, []);

  const commit = useCallback(async (command: ShipBuildCommandDto, successMessage: string) => {
    if (saving) return false;
    setSaving(true);
    setServerMessage(null);
    setServerMessageIsError(false);
    try {
      await mutateActiveBuild([command]);
      setServerMessage(successMessage);
      try {
        await refreshBootstrap();
      } catch {
        setServerMessage(`${successMessage} Inventory refresh is pending.`);
      }
      return true;
    } catch (error) {
      await refreshBootstrap().catch(() => undefined);
      setServerMessageIsError(true);
      setServerMessage(error instanceof Error ? error.message : "The server rejected the build command.");
      return false;
    } finally {
      setSaving(false);
    }
  }, [mutateActiveBuild, refreshBootstrap, saving]);

  const moveSelectedPart = useCallback((deltaX: number, deltaY: number) => {
    if (!selectedPart) return;
    void commit({
      type: "move",
      inventoryItemId: selectedPart.inventoryItemId,
      gridX: selectedPart.gridX + deltaX,
      gridY: selectedPart.gridY + deltaY,
      rotation: selectedPart.rotation
    }, "Build revision saved.");
  }, [commit, selectedPart]);

  const installAt = useCallback((gridX: number, gridY: number) => {
    if (!selectedInventory) return;
    void commit({
      type: "install",
      inventoryItemId: selectedInventory.id,
      gridX,
      gridY,
      rotation: 0
    }, `${selectedInventory.definitionId} installed.`).then((saved) => {
      if (saved) setSelectedInventoryId(null);
    });
  }, [commit, selectedInventory]);

  const launchPve = useCallback(async () => {
    const shipBuildRevisionId = build?.activeRevision.id;
    if (!selectedMission || !shipBuildRevisionId || launchingMission || activeGameplay) return;
    const key = `${selectedMission.id}:${shipBuildRevisionId}`;
    if (!missionLaunchRef.current || missionLaunchRef.current.key !== key) {
      missionLaunchRef.current = { key, idempotencyKey: crypto.randomUUID() };
    }
    setLaunchingMission(true);
    setServerMessage(null);
    setServerMessageIsError(false);
    try {
      const attempt = await createMissionAttempt({
        missionId: selectedMission.id,
        shipBuildRevisionId,
        idempotencyKey: missionLaunchRef.current.idempotencyKey
      });
      window.sessionStorage.setItem(ACTIVE_MISSION_ATTEMPT_STORAGE_KEY, attempt.attemptId);
      router.push(`/battle?attemptId=${encodeURIComponent(attempt.attemptId)}`);
    } catch (error) {
      setServerMessageIsError(true);
      setServerMessage(error instanceof Error ? error.message : "Mission attempt could not be created.");
      setLaunchingMission(false);
    }
  }, [activeGameplay, build?.activeRevision.id, launchingMission, router, selectedMission]);

  const endActiveGameplay = useCallback(async () => {
    if (!activeGameplay || endingActiveGameplay) return;
    setEndingActiveGameplay(true);
    setServerMessage(null);
    setServerMessageIsError(false);
    try {
      if (activeGameplay.mode === "pve") {
        await abandonMissionAttempt(activeGameplay.attempt.attemptId);
      } else {
        await cancelMatchmakingTicket(activeGameplay.matchmakingTicket.id);
      }
      window.sessionStorage.removeItem(ACTIVE_MISSION_ATTEMPT_STORAGE_KEY);
      setActiveGameplay(null);
      await refreshBootstrap().catch(() => undefined);
      setServerMessage(activeGameplay.mode === "pve"
        ? "Mission attempt abandoned; the build is available again."
        : "Ranked matchmaking cancelled; the build is available again.");
    } catch (error) {
      setServerMessageIsError(true);
      setServerMessage(error instanceof Error ? error.message : "Active gameplay could not be ended.");
    } finally {
      setEndingActiveGameplay(false);
    }
  }, [activeGameplay, endingActiveGameplay, refreshBootstrap]);

  const resumeActiveGameplay = useCallback(() => {
    if (!activeGameplay) return;
    router.push(activeGameplay.mode === "pve"
      ? `/battle?attemptId=${encodeURIComponent(activeGameplay.attempt.attemptId)}`
      : `/battle?matchmakingTicket=${encodeURIComponent(activeGameplay.matchmakingTicket.id)}`);
  }, [activeGameplay, router]);

  const launchPvp = useCallback(async () => {
    const shipBuildRevisionId = build?.activeRevision.id;
    if (!shipBuildRevisionId || matchmaking || activeGameplay) return;
    setMatchmaking(true);
    setServerMessage(null);
    setServerMessageIsError(false);
    try {
      const ticket = await createMatchmakingTicket({
        queue: "ranked-eu",
        shipBuildRevisionId,
        idempotencyKey: crypto.randomUUID()
      });
      router.push(`/battle?matchmakingTicket=${encodeURIComponent(ticket.id)}`);
    } catch (error) {
      setServerMessageIsError(true);
      setServerMessage(error instanceof Error ? error.message : "PvP matchmaking could not be started.");
      setMatchmaking(false);
    }
  }, [activeGameplay, build?.activeRevision.id, matchmaking, router]);

  return (
    <main className="app-shell game-shell">
      <section className="mobile-frame game-frame game-frame--hangar">
        <div className="screen hangar-screen server-hangar-screen">
          <header className="topbar hangar-topbar">
            <div className="brand">
              <strong>{build?.activeRevision.name ?? "Server Ship"}</strong>
              <span>{selectedMission ? selectedMission.name : `${bootstrap.profile.displayName} · No contract`}</span>
            </div>
            <div className="hangar-stat-strip">
              <MiniStat label="REV" value={build ? String(build.activeRevision.revision) : "—"} />
              <MiniStat label="PARTS" value={String(parts.length)} />
              <MiniStat label="ITEMS" value={String(availableInventory.length)} />
              <MiniStat label="CONTENT" value={bootstrap.contentRelease.version} />
            </div>
            <WalletStrip wallet={bootstrap.wallet} />
            {bootstrap.capabilities.pvpMatchmaking ? (
              <button
                className="button primary small"
                disabled={!build || matchmaking || Boolean(activeGameplay)}
                onClick={() => void launchPvp()}
                type="button"
              >{matchmaking ? "Queueing…" : "Ranked PvP"}</button>
            ) : null}
            {selectedMission ? (
              <button
                className="button primary small"
                disabled={!build || launchingMission || Boolean(activeGameplay)}
                onClick={() => void launchPve()}
                type="button"
              >{launchingMission ? "Creating Attempt…" : "Launch Contract"}</button>
            ) : (
              <span className="button primary small" aria-disabled="true">Select Contract</span>
            )}
          </header>

          <section className="build-status-panel" aria-label="Server build status">
            <StatusColumn title="Authority" items={["Server owned"]} tone="hint" />
            <StatusColumn title="Revision" items={[build ? `Immutable v${build.activeRevision.revision}` : "No active build"]} tone={build ? "hint" : "danger"} />
            <StatusColumn
              title={saving ? "Saving" : "Validation"}
              items={[serverMessage ?? (saving ? "Applying command…" : "Validated on server command and launch")]}
              tone={serverMessageIsError ? "warn" : "hint"}
            />
            {activeGameplay ? (
              <div className="status-column warn">
                <strong>
                  {activeGameplay.mode === "pve" ? "Active contract" : "Ranked PvP"}
                  {" · "}
                  {activeGameplay.mode === "pve"
                    ? activeGameplay.attempt.status
                    : activeGameplay.matchmakingTicket.status}
                </strong>
                <span>
                  {activeGameplay.mode === "pve"
                    ? activeGameplay.attempt.attemptId
                    : activeGameplay.matchmakingTicket.match?.matchId ?? activeGameplay.matchmakingTicket.id}
                </span>
                <div className="footer-actions">
                  <button
                    className="button small"
                    onClick={resumeActiveGameplay}
                    type="button"
                  >Resume</button>
                  {activeGameplay.mode === "pve" || activeGameplay.matchmakingTicket.status === "queued" ? (
                    <button
                      className="button small"
                      disabled={endingActiveGameplay}
                      onClick={() => void endActiveGameplay()}
                      type="button"
                    >{endingActiveGameplay
                        ? activeGameplay.mode === "pve" ? "Abandoning…" : "Cancelling…"
                        : activeGameplay.mode === "pve" ? "Abandon" : "Cancel"}</button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>

          <section className="hangar-stage server-hangar-stage" aria-label="Server ship assembly grid">
            {build ? (
              <ServerShipGrid
                installDefinitionId={selectedInventory?.definitionId ?? null}
                onEmptyCell={installAt}
                onSelectPart={(part) => {
                  setSelectedPartId(part.inventoryItemId);
                  setSelectedInventoryId(null);
                  showSection("build");
                }}
                parts={parts}
                selectedPartId={selectedPartId}
              />
            ) : (
              <div className="server-hangar-empty panel">
                <h2>No active build</h2>
                <p>The server must create a starter build before modules can be installed.</p>
              </div>
            )}
            <div className="server-hangar-watermark">
              <span>SERVER AUTHORITATIVE</span>
              <strong>{bootstrap.contentRelease.version}</strong>
            </div>
          </section>

          <nav className="hangar-bottom-nav" aria-label="Hangar controls">
            <details className="module-drawer" open>
              <summary>
                <span>{section === "contracts" ? selectedMission?.name ?? "Mission Board" : section === "build" ? selectedPart?.definitionId ?? "Build Revision" : selectedInventory?.definitionId ?? "Inventory"}</span>
                <span className="small">
                  {section === "contracts"
                    ? selectedMission?.objective.label ?? "Select a server contract"
                    : section === "build"
                      ? `Revision ${build?.activeRevision.revision ?? "—"} · ${parts.length} installed`
                      : `${availableInventory.length} available server-owned items`}
                </span>
              </summary>
              <div className="build-mode-tabs" role="tablist" aria-label="Hangar section">
                <button aria-selected={section === "contracts"} className={section === "contracts" ? "selected" : ""} onClick={() => showSection("contracts")} role="tab">Contracts</button>
                <button aria-selected={section === "build"} className={section === "build" ? "selected" : ""} onClick={() => showSection("build")} role="tab">Build</button>
                <button aria-selected={section === "inventory"} className={section === "inventory" ? "selected" : ""} onClick={() => showSection("inventory")} role="tab">Inventory</button>
              </div>

              {section === "contracts" ? (
                <div className="mission-drawer-content">
                  <MissionSelectionPanel
                    missions={bootstrap.missions}
                    onClear={() => setSelectedMissionId(null)}
                    onSelect={setSelectedMissionId}
                    onShowBuild={() => showSection("build")}
                    selectedMissionId={selectedMissionId}
                  />
                </div>
              ) : section === "build" ? (
                <BuildCommandPanel
                  buildName={buildName}
                  disabled={saving || !build}
                  onMove={moveSelectedPart}
                  onNameChange={setBuildName}
                  onRemove={() => {
                    if (!selectedPart) return;
                    void commit({ type: "remove", inventoryItemId: selectedPart.inventoryItemId }, "Part returned to inventory.")
                      .then((saved) => {
                        if (saved) setSelectedPartId(null);
                      });
                  }}
                  onRename={() => {
                    const name = buildName.trim();
                    if (name) void commit({ type: "rename", name }, "Build name saved.");
                  }}
                  onRotate={() => {
                    if (!selectedPart) return;
                    void commit({
                      type: "move",
                      inventoryItemId: selectedPart.inventoryItemId,
                      gridX: selectedPart.gridX,
                      gridY: selectedPart.gridY,
                      rotation: nextRotation(selectedPart.rotation)
                    }, "Part rotation saved.");
                  }}
                  selectedPart={selectedPart}
                />
              ) : (
                <InventoryPalette
                  inventory={bootstrap.inventory}
                  onSelect={setSelectedInventoryId}
                  selectedId={selectedInventoryId}
                />
              )}
            </details>
          </nav>
        </div>
      </section>
    </main>
  );
}

function ServerShipGrid({
  parts,
  selectedPartId,
  installDefinitionId,
  onSelectPart,
  onEmptyCell
}: {
  parts: ShipBuildPartDto[];
  selectedPartId: string | null;
  installDefinitionId: string | null;
  onSelectPart: (part: ShipBuildPartDto) => void;
  onEmptyCell: (gridX: number, gridY: number) => void;
}) {
  const bounds = useMemo(() => getGridBounds(parts), [parts]);
  const partByCell = useMemo(
    () => new Map(parts.map((part) => [`${part.gridX}:${part.gridY}`, part])),
    [parts]
  );
  const cells = useMemo(() => {
    const result: Array<{ x: number; y: number }> = [];
    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      for (let x = bounds.minX; x <= bounds.maxX; x += 1) result.push({ x, y });
    }
    return result;
  }, [bounds]);

  return (
    <div className="server-ship-grid-shell">
      <div
        className="server-ship-grid"
        style={{ gridTemplateColumns: `repeat(${bounds.maxX - bounds.minX + 1}, minmax(32px, 1fr))` }}
      >
        {cells.map((cell) => {
          const part = partByCell.get(`${cell.x}:${cell.y}`);
          return (
            <button
              aria-label={part ? `${part.definitionId} at ${cell.x}, ${cell.y}` : `Empty cell ${cell.x}, ${cell.y}`}
              className={[
                "server-ship-cell",
                part ? "occupied" : "",
                part?.inventoryItemId === selectedPartId ? "selected" : "",
                !part && installDefinitionId ? "install-target" : ""
              ].filter(Boolean).join(" ")}
              data-kind={part ? visualPartKind(part.definitionId) : undefined}
              key={`${cell.x}:${cell.y}`}
              onClick={() => part ? onSelectPart(part) : onEmptyCell(cell.x, cell.y)}
              type="button"
            >
              {part ? (
                <>
                  <span className="server-ship-part-glyph">{partGlyph(part.definitionId)}</span>
                  <strong>{shortDefinition(part.definitionId)}</strong>
                  <small>{part.rotation}°</small>
                </>
              ) : <small>{cell.x}:{cell.y}</small>}
            </button>
          );
        })}
      </div>
      {installDefinitionId ? <p className="server-grid-instruction">Select an empty cell to propose installation of {installDefinitionId}.</p> : null}
    </div>
  );
}

function BuildCommandPanel({
  buildName,
  selectedPart,
  disabled,
  onNameChange,
  onRename,
  onMove,
  onRotate,
  onRemove
}: {
  buildName: string;
  selectedPart: ShipBuildPartDto | null;
  disabled: boolean;
  onNameChange: (name: string) => void;
  onRename: () => void;
  onMove: (deltaX: number, deltaY: number) => void;
  onRotate: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="server-build-command-panel">
      <form onSubmit={(event) => { event.preventDefault(); onRename(); }}>
        <label htmlFor="server-build-name">Build name</label>
        <input id="server-build-name" maxLength={64} onChange={(event) => onNameChange(event.target.value)} value={buildName} />
        <UiButton disabled={disabled || !buildName.trim()} size="sm" type="submit" variant="secondary">Save name</UiButton>
      </form>
      {selectedPart ? (
        <section className="server-part-inspector">
          <div>
            <span className="eyebrow">Installed inventory item</span>
            <strong>{selectedPart.definitionId}</strong>
            <small>{selectedPart.inventoryItemId} · {selectedPart.gridX}:{selectedPart.gridY} · {selectedPart.rotation}°</small>
          </div>
          <div className="server-part-move-grid" aria-label="Move selected part">
            <UiButton disabled={disabled} onClick={() => onMove(0, -1)} size="icon" variant="secondary">↑</UiButton>
            <UiButton disabled={disabled} onClick={() => onMove(-1, 0)} size="icon" variant="secondary">←</UiButton>
            <UiButton disabled={disabled} onClick={onRotate} size="icon" variant="secondary">↻</UiButton>
            <UiButton disabled={disabled} onClick={() => onMove(1, 0)} size="icon" variant="secondary">→</UiButton>
            <UiButton disabled={disabled} onClick={() => onMove(0, 1)} size="icon" variant="secondary">↓</UiButton>
          </div>
          <UiButton disabled={disabled} onClick={onRemove} size="sm" variant="secondary">Return to inventory</UiButton>
        </section>
      ) : (
        <div className="server-hangar-placeholder">Select an installed part on the grid to send move, rotate or remove commands.</div>
      )}
    </div>
  );
}

function InventoryPalette({
  inventory,
  selectedId,
  onSelect
}: {
  inventory: InventoryItemDto[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  if (inventory.length === 0) {
    return <div className="server-hangar-placeholder">No available inventory items. Inventory is loaded only from the server.</div>;
  }
  return (
    <div className="server-inventory-palette">
      {inventory.map((item) => (
        <button
          aria-pressed={item.id === selectedId}
          className={item.id === selectedId ? "selected" : ""}
          disabled={item.state !== "available"}
          key={item.id}
          onClick={() => item.state === "available" && onSelect(item.id === selectedId ? null : item.id)}
          type="button"
        >
          <span className="server-inventory-glyph" data-kind={visualPartKind(item.definitionId)}>{partGlyph(item.definitionId)}</span>
          <strong>{item.definitionId}</strong>
          <small>{item.rarity} · {item.state} · {item.durability / 100}% · {item.contentVersion}</small>
        </button>
      ))}
    </div>
  );
}

function StatusColumn({ title, items, tone }: { title: string; items: string[]; tone: "danger" | "warn" | "hint" }) {
  return (
    <div className={`status-column ${tone}`}>
      <strong>{title}</strong>
      {items.map((item) => <span key={item}>{item}</span>)}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function getGridBounds(parts: ShipBuildPartDto[]) {
  if (parts.length === 0) return { minX: -3, maxX: 4, minY: -3, maxY: 4 };
  const xValues = parts.map((part) => part.gridX);
  const yValues = parts.map((part) => part.gridY);
  let minX = Math.min(...xValues) - 2;
  let maxX = Math.max(...xValues) + 2;
  let minY = Math.min(...yValues) - 2;
  let maxY = Math.max(...yValues) + 2;
  if (maxX - minX + 1 < 8) maxX = minX + 7;
  if (maxY - minY + 1 < 8) maxY = minY + 7;
  if (maxX - minX + 1 > 16) maxX = minX + 15;
  if (maxY - minY + 1 > 16) maxY = minY + 15;
  return { minX, maxX, minY, maxY };
}

function nextRotation(rotation: 0 | 90 | 180 | 270): 0 | 90 | 180 | 270 {
  if (rotation === 0) return 90;
  if (rotation === 90) return 180;
  if (rotation === 180) return 270;
  return 0;
}

function visualPartKind(definitionId: string) {
  const normalized = definitionId.toLowerCase();
  if (normalized.includes("engine") || normalized.includes("thruster")) return "engine";
  if (normalized.includes("weapon") || normalized.includes("gun") || normalized.includes("laser")) return "weapon";
  if (normalized.includes("reactor") || normalized.includes("power") || normalized.includes("battery")) return "power";
  if (normalized.includes("shield")) return "shield";
  return "structure";
}

function partGlyph(definitionId: string) {
  const kind = visualPartKind(definitionId);
  if (kind === "engine") return "⇈";
  if (kind === "weapon") return "⌁";
  if (kind === "power") return "◉";
  if (kind === "shield") return "⬡";
  return "▦";
}

function shortDefinition(definitionId: string) {
  return definitionId.replaceAll("_", " ").slice(0, 16);
}
