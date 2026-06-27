"use client";

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent } from "react";
import Link from "next/link";
import { createDraggable, type Draggable } from "animejs";
import { moduleDefs } from "@/game/data/modules";
import { panelDefs } from "@/game/data/panels";
import { useShipStore } from "@/game/store/shipStore";
import { calculateShipStatsV2 } from "@/game/ship/statsV2";
import {
  buildShipTopology,
  getConnectedPanelsFromCabin,
  getElementNetworkAccess
} from "@/game/ship/topology";
import {
  cellKey,
  getBuildableCellKeys,
  getCabin,
  getCellOccupant,
  getFrame,
  getInstalledPanelConnectors,
  getModule,
  getPanel,
  getPanelCellOccupant,
  getTransformedCells,
  rotateCell
} from "@/game/ship/build";
import {
  getBuildBlockers,
  getBuildHints,
  getBuildWarnings,
  validateElementPlacement,
  validatePanelPlacement
} from "@/game/ship/validation";
import {
  getAiModuleSpriteStyle,
  getHoverSpriteStyle,
  getPanelCellSpriteStyle,
  getPanelSpriteStyle
} from "@/game/assets/moduleSprites";
import type { GridCell, InstalledModule, InstalledPanel, ModuleType, PanelConnectorSide, PanelDef } from "@/game/types";

type OverlayMode = "structure" | "power" | "heat" | "weapons" | "engines" | "mass";

const labels: Record<ModuleType, string> = {
  core: "Core",
  hull: "Hull",
  armor: "Armor",
  engine: "Engine",
  weapon: "Weapon",
  reactor: "Reactor",
  battery: "Battery",
  shield: "Shield",
  utility: "Utility"
};

const zoomSteps = [1, 1.15, 1.3, 1.5, 1.75];
const overlayModes: Array<{ id: OverlayMode; label: string }> = [
  { id: "structure", label: "Structure" },
  { id: "power", label: "Power" },
  { id: "heat", label: "Heat" },
  { id: "weapons", label: "Weapons" },
  { id: "engines", label: "Engines" },
  { id: "mass", label: "Mass" }
];
const fallbackGridPitch = 41;
const initialScenePosition = { x: 0, y: 0 };
const installSounds = {
  module: [
    "/assets/audio/hangar-module-install-01.mp3",
    "/assets/audio/hangar-module-install-02.mp3",
    "/assets/audio/hangar-module-install-03.mp3",
    "/assets/audio/hangar-module-install-04.mp3",
    "/assets/audio/hangar-module-install-05.mp3",
    "/assets/audio/hangar-module-install-06.mp3"
  ],
  panel: [
    "/assets/audio/hangar-panel-install-01.mp3",
    "/assets/audio/hangar-panel-install-02.mp3",
    "/assets/audio/hangar-panel-install-03.mp3",
    "/assets/audio/hangar-panel-install-04.mp3",
    "/assets/audio/hangar-panel-install-05.mp3",
    "/assets/audio/hangar-panel-install-06.mp3"
  ]
};

export default function HangarPage() {
  const {
    build,
    buildMode,
    selectedModuleId,
    selectedPanelId,
    rotation,
    setBuildMode,
    selectModule,
    selectPanel,
    rotateSelected,
    installModule,
    moveModule,
    removeModule,
    installPanel,
    movePanel,
    removePanel,
    resetBuild
  } = useShipStore();
  const stageRef = useRef<HTMLElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const installSoundIndexRef = useRef({ module: 0, panel: 0 });
  const panGestureRef = useRef<{
    pointerId: number | "mouse";
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const [zoomIndex, setZoomIndex] = useState(0);
  const [scenePosition, setScenePosition] = useState(initialScenePosition);
  const [overlayMode, setOverlayMode] = useState<OverlayMode>("structure");
  const frame = getFrame(build.frameId);
  const cabin = build.cabinId ? getCabin(build.cabinId) : null;
  const selectedModule = selectedModuleId ? getModule(selectedModuleId) : null;
  const selectedPanel = selectedPanelId ? getPanel(selectedPanelId) : null;
  const stats = calculateShipStatsV2(build);
  const blockers = getBuildBlockers(build);
  const warnings = getBuildWarnings(build);
  const hints = getBuildHints(build);
  const topology = buildShipTopology(build);
  const connectedPanels = new Set(getConnectedPanelsFromCabin(topology));
  const centerOfMassCell = {
    x: Math.round(stats.centerOfMass.x),
    y: Math.round(stats.centerOfMass.y)
  };
  const panelCellKeys = getBuildableCellKeys(build);
  const zoom = zoomSteps[zoomIndex];
  const canTestBattle = blockers.length === 0;

  function playInstallSound(kind: keyof typeof installSounds) {
    const soundList = installSounds[kind];
    const index = installSoundIndexRef.current[kind];
    installSoundIndexRef.current[kind] = (index + 1) % soundList.length;
    const audio = new Audio(soundList[index]);
    audio.volume = 0.55;
    void audio.play().catch(() => {});
  }

  function clampScenePosition(x: number, y: number, nextZoom = zoom) {
    const stage = stageRef.current;
    if (!stage) return initialScenePosition;
    const rect = stage.getBoundingClientRect();
    const minX = Math.min(0, rect.width - rect.width * nextZoom);
    const minY = Math.min(0, rect.height - rect.height * nextZoom);
    return {
      x: Math.min(0, Math.max(minX, x)),
      y: Math.min(0, Math.max(minY, y))
    };
  }

  function setClampedScenePosition(x: number, y: number, nextZoom = zoom) {
    setScenePosition(clampScenePosition(x, y, nextZoom));
  }

  function beginPan(clientX: number, clientY: number, pointerId: number | "mouse") {
    panGestureRef.current = {
      pointerId,
      startX: clientX,
      startY: clientY,
      originX: scenePosition.x,
      originY: scenePosition.y
    };
  }

  function movePan(clientX: number, clientY: number, pointerId: number | "mouse") {
    const gesture = panGestureRef.current;
    if (!gesture || gesture.pointerId !== pointerId) return;
    setClampedScenePosition(
      gesture.originX + clientX - gesture.startX,
      gesture.originY + clientY - gesture.startY
    );
  }

  function handlePanPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    beginPan(event.clientX, event.clientY, event.pointerId);
  }

  function handlePanPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (panGestureRef.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    movePan(event.clientX, event.clientY, event.pointerId);
  }

  function handlePanPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (panGestureRef.current?.pointerId !== event.pointerId) return;
    panGestureRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleWindowMouseMove(event: MouseEvent) {
    movePan(event.clientX, event.clientY, "mouse");
  }

  function handleWindowMouseUp() {
    panGestureRef.current = null;
    window.removeEventListener("mousemove", handleWindowMouseMove);
  }

  function handlePanMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    beginPan(event.clientX, event.clientY, "mouse");
    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp, { once: true });
  }

  function handleGridPanPointerDown(event: PointerEvent<HTMLDivElement>) {
    const cell = (event.target as HTMLElement).closest(".cell");
    if (cell && !cell.classList.contains("inactive")) return;
    handlePanPointerDown(event);
  }

  function handleGridPanMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    const cell = (event.target as HTMLElement).closest(".cell");
    if (cell && !cell.classList.contains("inactive")) return;
    handlePanMouseDown(event);
  }

  function previewClass(cell: GridCell) {
    if (buildMode === "panels") {
      if (!selectedPanel) return "";
      const cells = getTransformedCells(selectedPanel, cell, rotation);
      const covers = cells.some((covered) => covered.x === cell.x && covered.y === cell.y);
      if (!covers) return "";
      return validatePanelPlacement(build, selectedPanel.id, cell, rotation).ok ? "valid" : "invalid";
    }

    if (!selectedModule || !panelCellKeys.has(cellKey(cell))) return "";
    const cells = getTransformedCells(selectedModule, cell, rotation);
    const covers = cells.some((covered) => covered.x === cell.x && covered.y === cell.y);
    if (!covers) return "";
    return validateElementPlacement(build, selectedModule.id, cell, rotation).ok ? "valid" : "invalid";
  }

  function overlayClass(
    cell: GridCell,
    module: ReturnType<typeof getModule> | null,
    panelOccupant: InstalledPanel | null,
    occupant: InstalledModule | null
  ) {
    if (overlayMode === "structure") {
      if (!panelOccupant) return "";
      return connectedPanels.has(`panel:${panelOccupant.instanceId}`) ? "overlay-structure" : "overlay-disconnected";
    }
    if (overlayMode === "power" && module) {
      const hasPower = occupant ? getElementNetworkAccess(topology, occupant.instanceId).includes("power") : false;
      return hasPower ? "overlay-power" : "overlay-disconnected";
    }
    if (overlayMode === "heat" && module) {
      if ((module.heatGeneration ?? 0) > 0) return "overlay-heat";
      if ((module.heatDissipation ?? 0) > 0) return "overlay-cooling";
    }
    if (overlayMode === "weapons" && module?.type === "weapon") return "overlay-weapon";
    if (overlayMode === "engines" && module?.type === "engine") return "overlay-engine";
    if (overlayMode === "mass" && cell.x === centerOfMassCell.x && cell.y === centerOfMassCell.y) return "overlay-mass-center";
    return "";
  }

  function handleCell(cell: GridCell) {
    if (buildMode === "panels") {
      const panelOccupant = getPanelCellOccupant(build, cell);
      if (panelOccupant) {
        removePanel(panelOccupant.instanceId);
        return;
      }
      if (selectedPanel && installPanel(selectedPanel.id, cell, rotation)) {
        playInstallSound("panel");
      }
      return;
    }

    if (!panelCellKeys.has(cellKey(cell))) return;
    const occupant = getCellOccupant(build, cell);
    if (occupant) {
      removeModule(occupant.instanceId);
      return;
    }
    if (selectedModule && installModule(selectedModule.id, cell, rotation)) {
      playInstallSound("module");
    }
  }

  function getGridPitch() {
    const grid = gridRef.current;
    const firstCell = grid?.querySelector<HTMLElement>("[data-grid-cell]");
    if (!grid || !firstCell) return fallbackGridPitch;
    const styles = window.getComputedStyle(grid);
    return firstCell.offsetWidth + (Number.parseFloat(styles.columnGap) || 0);
  }

  function getDropCell(clientX: number, clientY: number, ignoredCell?: HTMLElement) {
    const grid = gridRef.current;
    if (!grid) return null;
    const directCell = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>("[data-grid-cell]");
    if (
      directCell &&
      grid.contains(directCell) &&
      directCell !== ignoredCell &&
      !directCell.classList.contains("dragging")
    ) {
      return parseGridCell(directCell.dataset.gridCell);
    }

    const rect = grid.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
      return null;
    }
    const x = Math.floor(((clientX - rect.left) / rect.width) * frame.size.width);
    const y = Math.floor(((clientY - rect.top) / rect.height) * frame.size.height);
    if (x < 0 || y < 0 || x >= frame.size.width || y >= frame.size.height) return null;
    return { x, y };
  }

  function getPointerDropCell(draggable: Draggable, ignoredCell?: HTMLElement) {
    const [clientX, clientY] = draggable.pointer;
    if (!clientX && !clientY) return null;
    return getDropCell(clientX, clientY, ignoredCell);
  }

  useEffect(() => {
    setScenePosition((current) => clampScenePosition(current.x, current.y, zoom));
    const handleResize = () => {
      setScenePosition((current) => clampScenePosition(current.x, current.y, zoom));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [zoom]);

  useEffect(() => {
    const grid = gridRef.current;
    const drawer = drawerRef.current;
    if (!grid || !drawer) return;

    const draggables: Draggable[] = [];

    grid.querySelectorAll<HTMLElement>("[data-drag-kind]").forEach((element) => {
      const draggable = createDraggable(element, {
        container: grid,
        snap: () => getGridPitch(),
        dragThreshold: { mouse: 3, touch: 5 },
        releaseEase: "out(3)",
        cursor: { onHover: "grab", onGrab: "grabbing" },
        onGrab: () => element.classList.add("dragging"),
        onRelease: (drag) => {
          const sourceCell = parseGridCell(element.dataset.gridCell);
          const pitch = getGridPitch();
          const snappedCell = sourceCell
            ? {
                x: sourceCell.x + Math.round(drag.x / pitch),
                y: sourceCell.y + Math.round(drag.y / pitch)
              }
            : null;
          const targetCell = getPointerDropCell(drag, element) ?? snappedCell;
          element.classList.remove("dragging");
          const instanceId = element.dataset.dragInstanceId;
          const kind = element.dataset.dragKind;
          if (targetCell && instanceId && kind) {
            const offsetX = Number(element.dataset.dragOffsetX ?? 0);
            const offsetY = Number(element.dataset.dragOffsetY ?? 0);
            const position = { x: targetCell.x - offsetX, y: targetCell.y - offsetY };
            if (kind === "module") moveModule(instanceId, position);
            if (kind === "panel") movePanel(instanceId, position);
          }
          drag.reset();
        }
      });
      draggables.push(draggable);
    });

    drawer.querySelectorAll<HTMLElement>("[data-palette-kind]").forEach((element) => {
      const draggable = createDraggable(element, {
        snap: () => getGridPitch(),
        dragThreshold: { mouse: 3, touch: 5 },
        releaseEase: "out(3)",
        cursor: { onHover: "grab", onGrab: "grabbing" },
        onGrab: () => {
          element.classList.add("dragging");
          const itemId = element.dataset.paletteId;
          if (element.dataset.paletteKind === "panel" && itemId) selectPanel(itemId);
          if (element.dataset.paletteKind === "module" && itemId) selectModule(itemId);
        },
        onRelease: (drag) => {
          element.classList.remove("dragging");
          const targetCell = getPointerDropCell(drag);
          const itemId = element.dataset.paletteId;
          if (targetCell && itemId) {
            if (element.dataset.paletteKind === "panel" && installPanel(itemId, targetCell, rotation)) {
              playInstallSound("panel");
            }
            if (element.dataset.paletteKind === "module" && installModule(itemId, targetCell, rotation)) {
              playInstallSound("module");
            }
          }
          drag.reset();
        }
      });
      draggables.push(draggable);
    });

    return () => {
      draggables.forEach((draggable) => draggable.revert());
    };
  }, [
    build,
    buildMode,
    frame.size.height,
    frame.size.width,
    installModule,
    installPanel,
    moveModule,
    movePanel,
    rotation,
    selectModule,
    selectPanel
  ]);

  return (
    <main className="app-shell">
      <section className="mobile-frame">
        <div className="screen hangar-screen">
          <header className="topbar hangar-topbar">
            <div className="brand">
              <strong>{build.name}</strong>
              <span>{cabin?.name ?? frame.name}</span>
            </div>
            <div className="hangar-stat-strip">
              <MiniStat label="HP" value={stats.hp.toFixed(0)} />
              <MiniStat label="MASS" value={stats.mass.toFixed(0)} />
              <MiniStat label="SPD" value={stats.maxSpeed.toFixed(0)} />
              <MiniStat label="DPS" value={stats.dps.toFixed(1)} />
            </div>
            {canTestBattle ? (
              <Link className="button primary" href="/battle">
                Test Battle
              </Link>
            ) : (
              <span className="button primary disabled" aria-disabled="true">
                Blocked
              </span>
            )}
          </header>

          <section className="build-status-panel" aria-label="Build status">
            <StatusColumn title="Blockers" items={blockers.map((item) => item.message)} empty="Ready" tone="danger" />
            <StatusColumn title="Warnings" items={warnings.map((item) => item.message)} empty="Clear" tone="warn" />
            <StatusColumn title="Hints" items={hints.map((item) => item.message)} empty="None" tone="hint" />
          </section>

          <section className="hangar-stage" ref={stageRef} aria-label="Assembly Grid">
            <div className="overlay-tabs" role="tablist" aria-label="Grid overlay">
              {overlayModes.map((mode) => (
                <button
                  key={mode.id}
                  className={overlayMode === mode.id ? "selected" : ""}
                  onClick={() => setOverlayMode(mode.id)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <div
              className="hangar-world"
              ref={worldRef}
              style={{
                transform: `translate3d(${scenePosition.x}px, ${scenePosition.y}px, 0) scale(${zoom})`
              }}
            >
              <div
                className="hangar-pan-surface"
                ref={panRef}
                onPointerDown={handlePanPointerDown}
                onPointerMove={handlePanPointerMove}
                onPointerUp={handlePanPointerUp}
                onPointerCancel={handlePanPointerUp}
                onMouseDown={handlePanMouseDown}
              />
              <div className="ship-grid-wrap">
                <div
                  className="ship-grid"
                  ref={gridRef}
                  style={{ gridTemplateColumns: `repeat(${frame.size.width}, 1fr)` }}
                  onPointerDown={handleGridPanPointerDown}
                  onPointerMove={handlePanPointerMove}
                  onPointerUp={handlePanPointerUp}
                  onPointerCancel={handlePanPointerUp}
                  onMouseDown={handleGridPanMouseDown}
                >
                  {Array.from({ length: frame.size.height }).flatMap((_, y) =>
                    Array.from({ length: frame.size.width }).map((__, x) => {
                      const cell = { x, y };
                      const panelOccupant = getPanelCellOccupant(build, cell);
                      const panel = panelOccupant ? getPanel(panelOccupant.panelId) : null;
                      const panelConnectors = panelOccupant
                        ? getInstalledPanelConnectors(panelOccupant).filter(
                            (connector) => connector.cell.x === x && connector.cell.y === y
                          )
                        : [];
                      const active = buildMode === "panels" || panelCellKeys.has(cellKey(cell));
                      const occupant = getCellOccupant(build, cell);
                      const module = occupant ? getModule(occupant.moduleId) : null;
                      const panelLocalCell = panel && panelOccupant
                        ? getPanelLocalCell(panel, panelOccupant, cell)
                        : null;
                      const dragKind = buildMode === "panels" && panelOccupant
                        ? "panel"
                        : buildMode === "modules" && occupant
                          ? "module"
                          : undefined;
                      const dragInstance = dragKind === "panel" ? panelOccupant : occupant;
                      return (
                        <button
                          key={`${x}:${y}`}
                          className={[
                            "cell",
                            dragKind ? "draggable-cell" : "",
                            active ? "" : "inactive",
                            panel ? `has-panel panel-${panelOccupant?.state}` : "",
                            module ? `occupied ${module.type}` : "",
                            overlayClass(cell, module, panelOccupant, occupant),
                            previewClass(cell)
                          ].join(" ")}
                          data-grid-cell={`${x}:${y}`}
                          data-drag-kind={dragKind}
                          data-drag-instance-id={dragInstance?.instanceId}
                          data-drag-offset-x={dragInstance ? x - dragInstance.position.x : undefined}
                          data-drag-offset-y={dragInstance ? y - dragInstance.position.y : undefined}
                          onClick={() => handleCell(cell)}
                          aria-label={`cell ${x} ${y}`}
                        >
                          {panel && panelOccupant && (
                            <>
                              <span
                                className="cell-panel-sprite"
                                style={getPanelCellSpriteStyle(
                                  panel,
                                  panelOccupant.state,
                                  panelLocalCell ?? { x: 0, y: 0 }
                                )}
                              />
                              {panelConnectors.map((connector) => (
                                <span
                                  key={`${connector.side}:${connector.id}`}
                                  className={`cell-connector ${connector.side}`}
                                >
                                  {shortConnectorLabel(connector.id, connector.side)}
                                </span>
                              ))}
                            </>
                          )}
                          {module && (
                            <>
                              <span className="cell-hover" style={getHoverSpriteStyle("ring")} />
                              <span className="cell-sprite ai-module-sprite" style={getAiModuleSpriteStyle(module)} />
                            </>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
            <div className="hangar-zoom-controls" aria-label="Scene zoom">
              <button className="button" disabled={zoomIndex === 0} onClick={() => setZoomIndex((value) => Math.max(0, value - 1))}>
                -
              </button>
              <span>{Math.round(zoom * 100)}%</span>
              <button className="button" disabled={zoomIndex === zoomSteps.length - 1} onClick={() => setZoomIndex((value) => Math.min(zoomSteps.length - 1, value + 1))}>
                +
              </button>
            </div>
            <div className="hangar-actions">
              <button className="button" onClick={rotateSelected}>
                Rotate {rotation}°
              </button>
              <button className="button danger" onClick={resetBuild}>
                Reset
              </button>
            </div>
          </section>

          <nav className="hangar-bottom-nav" aria-label="Hangar modules">
            <details className="module-drawer" open>
              <summary>
                <span>
                  {buildMode === "panels"
                    ? selectedPanel?.name ?? "Panels"
                    : selectedModule?.name ?? "Modules"}
                </span>
                <span className="small">
                  Panels {(build.panels ?? []).length} · Energy {stats.energyBalance.toFixed(0)}
                </span>
              </summary>
              <div className="build-mode-tabs" role="tablist" aria-label="Build layer">
                <button
                  className={buildMode === "panels" ? "selected" : ""}
                  onClick={() => setBuildMode("panels")}
                >
                  Panels
                </button>
                <button
                  className={buildMode === "modules" ? "selected" : ""}
                  onClick={() => setBuildMode("modules")}
                >
                  Modules
                </button>
              </div>
              <div className="module-list" ref={drawerRef}>
                {buildMode === "panels"
                  ? panelDefs.map((panel) => (
                      <button
                        key={panel.id}
                        className={`module-card panel-card ${panel.id === selectedPanelId ? "selected" : ""}`}
                        data-palette-kind="panel"
                        data-palette-id={panel.id}
                        onClick={() => selectPanel(panel.id)}
                      >
                        <span className="panel-thumb" style={getPanelSpriteStyle(panel)} />
                        <strong>{panel.name}</strong>
                        <span>
                          {panel.shape.cells.length} cell · {panel.connectors.length} locks
                        </span>
                        <span>
                          {panel.role} · HP {panel.hp} · mass {panel.mass}
                        </span>
                      </button>
                    ))
                  : moduleDefs.map((module) => (
                      <button
                        key={module.id}
                        className={`module-card ${module.id === selectedModuleId ? "selected" : ""}`}
                        data-palette-kind="module"
                        data-palette-id={module.id}
                        onClick={() => selectModule(module.id)}
                      >
                        <span className="module-thumb ai-module-thumb" style={getAiModuleSpriteStyle(module)} />
                        <strong>{module.name}</strong>
                        <span>
                          {labels[module.type]} · {module.shape.cells.length} cell · mass {module.mass}
                        </span>
                        <span>
                          HP {module.hp} · EN {(module.energyProduction ?? 0) - (module.energyConsumption ?? 0)} · heat{" "}
                          {(module.heatGeneration ?? 0) - (module.heatDissipation ?? 0)}
                        </span>
                      </button>
                    ))}
              </div>
            </details>
          </nav>
        </div>
      </section>
    </main>
  );
}

function parseGridCell(value?: string) {
  if (!value) return null;
  const [x, y] = value.split(":").map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function getPanelLocalCell(panel: PanelDef, installed: InstalledPanel, cell: GridCell) {
  const offset = {
    x: cell.x - installed.position.x,
    y: cell.y - installed.position.y
  };
  return panel.shape.cells.find((shapeCell) => {
    const rotated = rotateCell(shapeCell, installed.rotation);
    return rotated.x === offset.x && rotated.y === offset.y;
  });
}

function shortConnectorLabel(id: string, side: PanelConnectorSide) {
  if (side === "top" || side === "bottom") return id.replace("V", "V");
  return id.replace("H", "H");
}

function StatusColumn({
  title,
  items,
  empty,
  tone
}: {
  title: string;
  items: string[];
  empty: string;
  tone: "danger" | "warn" | "hint";
}) {
  return (
    <div className={`status-column ${tone}`}>
      <strong>{title}</strong>
      <span>{items[0] ?? empty}</span>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="mini-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
