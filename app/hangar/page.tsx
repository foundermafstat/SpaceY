"use client";

import Link from "next/link";
import { moduleDefs } from "@/game/data/modules";
import { useShipStore } from "@/game/store/shipStore";
import { calculateShipStats } from "@/game/ship/stats";
import {
  canInstallModule,
  getCellOccupant,
  getFrame,
  getModule,
  getTransformedCells
} from "@/game/ship/build";
import { getHoverSpriteStyle, getModuleSpriteStyle } from "@/game/assets/moduleSprites";
import type { GridCell, ModuleType } from "@/game/types";

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
    selectedModuleId,
    rotation,
    selectModule,
    rotateSelected,
    installModule,
    removeModule,
    resetBuild
  } = useShipStore();
  const frame = getFrame(build.frameId);
  const selected = selectedModuleId ? getModule(selectedModuleId) : null;
  const stats = calculateShipStats(build);
  const activeKeys = new Set(frame.activeCells.map((cell) => `${cell.x}:${cell.y}`));

  function previewClass(cell: GridCell) {
    if (!selected || !activeKeys.has(`${cell.x}:${cell.y}`)) return "";
    const cells = getTransformedCells(selected, cell, rotation);
    const covers = cells.some((covered) => covered.x === cell.x && covered.y === cell.y);
    if (!covers) return "";
    return canInstallModule(build, selected.id, cell, rotation).ok ? "valid" : "invalid";
  }

  function handleCell(cell: GridCell) {
    if (!activeKeys.has(`${cell.x}:${cell.y}`)) return;
    const occupant = getCellOccupant(build, cell);
    if (occupant) {
      removeModule(occupant.instanceId);
      return;
    }
    if (selected) installModule(selected.id, cell, rotation);
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
                    const active = activeKeys.has(`${x}:${y}`);
                    const occupant = getCellOccupant(build, cell);
                    const module = occupant ? getModule(occupant.moduleId) : null;
                    return (
                      <button
                        key={`${x}:${y}`}
                        className={[
                          "cell",
                          active ? "" : "inactive",
                          module ? `occupied ${module.type}` : "",
                          previewClass(cell)
                        ].join(" ")}
                        onClick={() => handleCell(cell)}
                        aria-label={`cell ${x} ${y}`}
                      >
                        {module && (
                          <>
                            <span className="cell-hover" style={getHoverSpriteStyle("ring")} />
                            <span className="cell-sprite" style={getModuleSpriteStyle(module)} />
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
                <span>{selected ? selected.name : "Modules"}</span>
                <span className="small">
                  Energy {stats.energyBalance.toFixed(0)} · Accel {stats.acceleration.toFixed(2)}
                </span>
              </summary>
            <div className="module-list">
              {moduleDefs.map((module) => (
                <button
                  key={module.id}
                  className={`module-card ${module.id === selectedModuleId ? "selected" : ""}`}
                  onClick={() => selectModule(module.id)}
                >
                  <span className="module-thumb" style={getModuleSpriteStyle(module)} />
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

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="mini-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
