"use client";

import Link from "next/link";
import { moduleDefs } from "@/game/data/modules";
import { panelDefs } from "@/game/data/panels";
import { useShipStore } from "@/game/store/shipStore";
import { calculateShipStats } from "@/game/ship/stats";
import {
  canInstallModule,
  canInstallPanel,
  cellKey,
  getBuildableCellKeys,
  getCellOccupant,
  getFrame,
  getInstalledPanelConnectors,
  getModule,
  getPanel,
  getPanelCellOccupant,
  getTransformedCells
} from "@/game/ship/build";
import { getAiModuleSpriteStyle, getHoverSpriteStyle, getPanelSpriteStyle } from "@/game/assets/moduleSprites";
import type { GridCell, ModuleType, PanelConnectorSide } from "@/game/types";

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
    removeModule,
    installPanel,
    removePanel,
    resetBuild
  } = useShipStore();
  const frame = getFrame(build.frameId);
  const selectedModule = selectedModuleId ? getModule(selectedModuleId) : null;
  const selectedPanel = selectedPanelId ? getPanel(selectedPanelId) : null;
  const stats = calculateShipStats(build);
  const panelCellKeys = getBuildableCellKeys(build);

  function previewClass(cell: GridCell) {
    if (buildMode === "panels") {
      if (!selectedPanel) return "";
      const cells = getTransformedCells(selectedPanel, cell, rotation);
      const covers = cells.some((covered) => covered.x === cell.x && covered.y === cell.y);
      if (!covers) return "";
      return canInstallPanel(build, selectedPanel.id, cell, rotation).ok ? "valid" : "invalid";
    }

    if (!selectedModule || !panelCellKeys.has(cellKey(cell))) return "";
    const cells = getTransformedCells(selectedModule, cell, rotation);
    const covers = cells.some((covered) => covered.x === cell.x && covered.y === cell.y);
    if (!covers) return "";
    return canInstallModule(build, selectedModule.id, cell, rotation).ok ? "valid" : "invalid";
  }

  function handleCell(cell: GridCell) {
    if (buildMode === "panels") {
      const panelOccupant = getPanelCellOccupant(build, cell);
      if (panelOccupant) {
        removePanel(panelOccupant.instanceId);
        return;
      }
      if (selectedPanel) installPanel(selectedPanel.id, cell, rotation);
      return;
    }

    if (!panelCellKeys.has(cellKey(cell))) return;
    const occupant = getCellOccupant(build, cell);
    if (occupant) {
      removeModule(occupant.instanceId);
      return;
    }
    if (selectedModule) installModule(selectedModule.id, cell, rotation);
  }

  return (
    <main className="app-shell">
      <section className="mobile-frame">
        <div className="screen hangar-screen">
          <header className="topbar hangar-topbar">
            <div className="brand">
              <strong>{build.name}</strong>
              <span>{frame.name}</span>
            </div>
            <div className="hangar-stat-strip">
              <MiniStat label="HP" value={stats.hp.toFixed(0)} />
              <MiniStat label="MASS" value={stats.mass.toFixed(0)} />
              <MiniStat label="SPD" value={stats.maxSpeed.toFixed(0)} />
              <MiniStat label="DPS" value={stats.dps.toFixed(1)} />
            </div>
            <Link className="button primary" href="/battle">
              Test Battle
            </Link>
          </header>

          <section className="hangar-stage" aria-label="Assembly Grid">
            <div className="ship-grid-wrap">
              <div
                className="ship-grid"
                style={{ gridTemplateColumns: `repeat(${frame.size.width}, 1fr)` }}
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
                    return (
                      <button
                        key={`${x}:${y}`}
                        className={[
                          "cell",
                          active ? "" : "inactive",
                          panel ? `has-panel panel-${panelOccupant?.state}` : "",
                          module ? `occupied ${module.type}` : "",
                          previewClass(cell)
                        ].join(" ")}
                        onClick={() => handleCell(cell)}
                        aria-label={`cell ${x} ${y}`}
                      >
                        {panel && panelOccupant && (
                          <>
                            <span
                              className="cell-panel-sprite"
                              style={getPanelSpriteStyle(panel, panelOccupant.state)}
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
              <div className="module-list">
                {buildMode === "panels"
                  ? panelDefs.map((panel) => (
                      <button
                        key={panel.id}
                        className={`module-card panel-card ${panel.id === selectedPanelId ? "selected" : ""}`}
                        onClick={() => selectPanel(panel.id)}
                      >
                        <span className="panel-thumb" style={getPanelSpriteStyle(panel)} />
                        <strong>{panel.name}</strong>
                        <span>
                          {panel.shape.cells.length} cell · {panel.connectors.length} locks
                        </span>
                      </button>
                    ))
                  : moduleDefs.map((module) => (
                      <button
                        key={module.id}
                        className={`module-card ${module.id === selectedModuleId ? "selected" : ""}`}
                        onClick={() => selectModule(module.id)}
                      >
                        <span className="module-thumb ai-module-thumb" style={getAiModuleSpriteStyle(module)} />
                        <strong>{module.name}</strong>
                        <span>
                          {labels[module.type]} · {module.shape.cells.length} cell · mass {module.mass}
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

function shortConnectorLabel(id: string, side: PanelConnectorSide) {
  if (side === "top" || side === "bottom") return id.replace("V", "V");
  return id.replace("H", "H");
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="mini-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
