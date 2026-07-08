"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useShipStore } from "@/game/store/shipStore";
import { calculateShipStatsV2 } from "@/game/ship/statsV2";
import { getBuildBlockers } from "@/game/ship/validation";

const BattleCanvas = dynamic(() => import("@/components/battle/BattleCanvas"), {
  ssr: false
});

export default function BattlePage() {
  const build = useShipStore((state) => state.build);
  const addReward = useShipStore((state) => state.addReward);
  const [result, setResult] = useState<"victory" | "defeat" | null>(null);
  const stats = useMemo(() => calculateShipStatsV2(build), [build]);
  const blockers = useMemo(() => getBuildBlockers(build), [build]);

  const handleResult = useCallback((nextResult: "victory" | "defeat") => {
    setResult(nextResult);
    if (nextResult === "victory") addReward(65);
  }, [addReward]);

  return (
    <main className="app-shell game-shell">
      <section className="mobile-frame game-frame game-frame--battle">
        <div className="battle-host">
          {blockers.length === 0 && <BattleCanvas build={build} onResult={handleResult} />}
          <div className="battle-overlay">
            <div className="battle-hud panel">
              <strong>Survival Test</strong>
              <span className="small">
                HP {stats.hp.toFixed(0)} · DPS {stats.dps.toFixed(1)} · accel{" "}
                {stats.acceleration.toFixed(2)}
              </span>
              <span className="small">
                EN {stats.energyBalance >= 0 ? "+" : ""}
                {stats.energyBalance.toFixed(0)}/s · buffer {Math.max(20, stats.powerStorage + stats.powerOutput * 2).toFixed(0)}
              </span>
              <span className="small">
                Heat {Math.max(0, stats.heat).toFixed(0)}/s · cooling {stats.heatDissipation.toFixed(0)}
              </span>
              <span className="small">
                Shield {stats.shieldCapacity.toFixed(0)} · regen {stats.shieldRegen.toFixed(1)}/s
              </span>
              <div className="bar">
                <span style={{ width: `${result === "defeat" ? 0 : 100}%` }} />
              </div>
            </div>
            {blockers.length > 0 && (
              <div className="result-panel panel">
                <div className="panel-title">
                  <h2>Build Blocked</h2>
                  <span className="small">{blockers[0].message}</span>
                </div>
                <div className="footer-actions">
                  <Link className="button primary" href="/hangar">
                    Hangar
                  </Link>
                </div>
              </div>
            )}
            {result && (
              <div className="result-panel panel">
                <div className="panel-title">
                  <h2>{result === "victory" ? "Victory" : "Ship Destroyed"}</h2>
                  <span className="small">{result === "victory" ? "+65 scrap" : "Try rebuild"}</span>
                </div>
                <div className="footer-actions">
                  <Link className="button" href="/hangar">
                    Hangar
                  </Link>
                  <button className="button primary" onClick={() => window.location.reload()}>
                    Retry
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
