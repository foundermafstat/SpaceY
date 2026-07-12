"use client";

import type {
  ActiveGameplayDto,
  InventoryItemDto,
  ShipBuildCommandDto,
  ShipBuildPartDto
} from "@spacey/contracts";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IconType } from "react-icons";
import {
  FiBox, FiBriefcase, FiCpu, FiCrosshair, FiEdit3, FiInfo, FiPackage,
  FiPlay, FiShield, FiTarget, FiX, FiZap
} from "react-icons/fi";
import { MissionSelectionPanel } from "@/components/hangar/MissionSelectionPanel";
import { UiButton } from "@/components/ui-kit/UiButton";
import {
  Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle
} from "@/components/ui/drawer";
import {
  ACTIVE_MISSION_ATTEMPT_STORAGE_KEY,
  abandonMissionAttempt,
  cancelMatchmakingTicket,
  createMatchmakingTicket,
  createMissionAttempt,
  getMissionAttemptStatus
} from "@/game/server/api-client";
import { useServerSession } from "@/game/server/session-context";

export type HangarSection = "contracts" | "build" | "inventory";

export default function HangarPage() {
  return <HangarSurface />;
}

export function HangarSurface({
  sandbox = false,
  initialSection = "contracts",
  initialDrawerOpen = false,
  initialServerMessage = null,
  initialServerMessageIsError = false,
}: {
  sandbox?: boolean;
  initialSection?: HangarSection;
  initialDrawerOpen?: boolean;
  initialServerMessage?: string | null;
  initialServerMessageIsError?: boolean;
}) {
  const router = useRouter();
  const { bootstrap, mutateActiveBuild, refreshBootstrap } = useServerSession();
  const build = bootstrap.activeBuild;
  const parts = build?.activeRevision.parts ?? [];
  const availableInventory = bootstrap.inventory.filter((item) => item.state === "available");
  const [section, setSection] = useState<HangarSection>(initialSection);
  const [drawerOpen, setDrawerOpen] = useState(initialDrawerOpen);
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [selectedInventoryId, setSelectedInventoryId] = useState<string | null>(null);
  const [buildName, setBuildName] = useState(build?.activeRevision.name ?? "");
  const [saving, setSaving] = useState(false);
  const [launchingMission, setLaunchingMission] = useState(false);
  const [matchmaking, setMatchmaking] = useState(false);
  const [activeGameplay, setActiveGameplay] = useState<ActiveGameplayDto | null>(bootstrap.activeGameplay[0] ?? null);
  const [endingActiveGameplay, setEndingActiveGameplay] = useState(false);
  const [serverMessage, setServerMessage] = useState<string | null>(initialServerMessage);
  const [serverMessageIsError, setServerMessageIsError] = useState(initialServerMessageIsError);
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
    setDrawerOpen(true);
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
    if (sandbox) {
      setServerMessage(`Fixture launch preview: ${selectedMission.name}. No server request was sent.`);
      setLaunchingMission(false);
      return;
    }
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
  }, [activeGameplay, build?.activeRevision.id, launchingMission, router, sandbox, selectedMission]);

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
    if (sandbox) {
      setServerMessage("Fixture PvP queue preview. No server request was sent.");
      setMatchmaking(false);
      return;
    }
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
  }, [activeGameplay, build?.activeRevision.id, matchmaking, router, sandbox]);

  return (
    <main className="app-shell game-shell">
      <section className="mobile-frame game-frame game-frame--hangar">
        <div className="screen server-hangar-screen mobile-hangar-shell">
          <header className="mobile-hangar-hud">
            <div className="mobile-hangar-identity">
              <span className="mobile-hangar-kicker"><FiCpu aria-hidden="true" /> SERVER SHIP</span>
              <strong>{build?.activeRevision.name ?? "Server Ship"}</strong>
              <small>{selectedMission?.name ?? "No contract selected"}</small>
            </div>
            <div className="mobile-hangar-wallet" aria-label="Wallet">
              <span title="Credits"><FiZap aria-hidden="true" /><strong>{bootstrap.wallet.credits}</strong></span>
              <span title="Scrap"><FiBox aria-hidden="true" /><strong>{bootstrap.wallet.scrap}</strong></span>
            </div>
            <div className="mobile-hangar-tools" aria-label="Hangar panels">
              <IconAction icon={FiBriefcase} label="Contracts" onClick={() => showSection("contracts")} />
              <IconAction icon={FiEdit3} label="Build" onClick={() => showSection("build")} />
              <IconAction badge={availableInventory.length} icon={FiPackage} label="Inventory" onClick={() => showSection("inventory")} />
              <IconAction icon={FiInfo} label="Ship status" onClick={() => showSection("build")} />
            </div>
          </header>

          {serverMessage || saving ? (
            <div className={`mobile-hangar-notice ${serverMessageIsError ? "error" : ""}`} role="status">
              {serverMessage ?? "Applying server command…"}
            </div>
          ) : null}

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
              <FiShield aria-hidden="true" />
              <strong>v{build?.activeRevision.revision ?? "—"}</strong>
            </div>
          </section>

          <footer className="mobile-hangar-actionbar">
            {activeGameplay ? (
              <>
                <button className="mobile-hangar-launch" onClick={resumeActiveGameplay} type="button"><FiPlay aria-hidden="true" /> Resume</button>
                {(activeGameplay.mode === "pve" || activeGameplay.matchmakingTicket.status === "queued") ? (
                  <button className="mobile-hangar-secondary" disabled={endingActiveGameplay} onClick={() => void endActiveGameplay()} type="button">
                    <FiX aria-hidden="true" /> {activeGameplay.mode === "pve" ? "Abandon" : "Cancel"}
                  </button>
                ) : null}
              </>
            ) : selectedMission ? (
              <button className="mobile-hangar-launch" disabled={!build || launchingMission} onClick={() => void launchPve()} type="button">
                <FiPlay aria-hidden="true" /> {launchingMission ? "Creating…" : "Launch"}
              </button>
            ) : (
              <button className="mobile-hangar-launch" onClick={() => showSection("contracts")} type="button"><FiTarget aria-hidden="true" /> Select contract</button>
            )}
            {bootstrap.capabilities.pvpMatchmaking && !activeGameplay ? (
              <button className="mobile-hangar-secondary" disabled={!build || matchmaking} onClick={() => void launchPvp()} type="button">
                <FiCrosshair aria-hidden="true" /> {matchmaking ? "Queueing…" : "PvP"}
              </button>
            ) : null}
          </footer>

          <Drawer onOpenChange={setDrawerOpen} open={drawerOpen} swipeDirection="down">
            <DrawerContent>
              <DrawerHeader>
                <div>
                  <DrawerTitle>{section === "contracts" ? "Contracts" : section === "build" ? "Ship build" : "Inventory"}</DrawerTitle>
                  <DrawerDescription>
                    {section === "contracts"
                      ? selectedMission?.objective.label ?? "Choose a server-authoritative mission"
                      : section === "build"
                        ? `Revision ${build?.activeRevision.revision ?? "—"} · ${parts.length} installed`
                        : `${availableInventory.length} available · ${bootstrap.inventory.length} total`}
                  </DrawerDescription>
                </div>
                <DrawerClose aria-label="Close panel" className="mobile-drawer-close"><FiX aria-hidden="true" /></DrawerClose>
              </DrawerHeader>
              <div className="mobile-drawer-tabs" role="tablist" aria-label="Hangar section">
                <button aria-selected={section === "contracts"} onClick={() => setSection("contracts")} role="tab"><FiBriefcase aria-hidden="true" /><span>Contracts</span></button>
                <button aria-selected={section === "build"} onClick={() => setSection("build")} role="tab"><FiEdit3 aria-hidden="true" /><span>Build</span></button>
                <button aria-selected={section === "inventory"} onClick={() => setSection("inventory")} role="tab"><FiPackage aria-hidden="true" /><span>Inventory</span></button>
              </div>
              <div className="mobile-drawer-scroll">
                {section === "contracts" ? (
                  <MissionSelectionPanel
                    missions={bootstrap.missions}
                    onClear={() => setSelectedMissionId(null)}
                    onSelect={(missionId) => { setSelectedMissionId(missionId); setDrawerOpen(false); }}
                    onShowBuild={() => setSection("build")}
                    selectedMissionId={selectedMissionId}
                  />
                ) : section === "build" ? (
                  <BuildCommandPanel
                    buildName={buildName}
                    disabled={saving || !build}
                    onMove={moveSelectedPart}
                    onNameChange={setBuildName}
                    onRemove={() => {
                      if (!selectedPart) return;
                      void commit({ type: "remove", inventoryItemId: selectedPart.inventoryItemId }, "Part returned to inventory.").then((saved) => {
                        if (saved) setSelectedPartId(null);
                      });
                    }}
                    onRename={() => {
                      const name = buildName.trim();
                      if (name) void commit({ type: "rename", name }, "Build name saved.");
                    }}
                    onRotate={() => {
                      if (!selectedPart) return;
                      void commit({ type: "move", inventoryItemId: selectedPart.inventoryItemId, gridX: selectedPart.gridX, gridY: selectedPart.gridY, rotation: nextRotation(selectedPart.rotation) }, "Part rotation saved.");
                    }}
                    selectedPart={selectedPart}
                  />
                ) : (
                  <InventoryPalette inventory={bootstrap.inventory} onSelect={setSelectedInventoryId} selectedId={selectedInventoryId} />
                )}
              </div>
            </DrawerContent>
          </Drawer>
        </div>
      </section>
    </main>
  );
}

function IconAction({ icon: Icon, label, onClick, badge }: { icon: IconType; label: string; onClick: () => void; badge?: number }) {
  return (
    <button aria-label={label} className="mobile-hangar-icon-action" onClick={onClick} title={label} type="button">
      <Icon aria-hidden="true" />
      {typeof badge === "number" && badge > 0 ? <span>{badge > 99 ? "99+" : badge}</span> : null}
    </button>
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
