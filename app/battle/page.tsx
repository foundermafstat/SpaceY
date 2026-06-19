"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useShipStore } from "@/game/store/shipStore";
import { calculateShipStats } from "@/game/ship/stats";

const BattleCanvas = dynamic(() => import("@/components/battle/BattleCanvas"), {
  ssr: false
});

export default function BattlePage() {
  const build = useShipStore((state) => state.build);
  const addReward = useShipStore((state) => state.addReward);
  const [result, setResult] = useState<"victory" | "defeat" | null>(null);
  const stats = useMemo(() => calculateShipStats(build), [build]);

  const handleResult = useCallback((nextResult: "victory" | "defeat") => {
    setResult(nextResult);
    if (nextResult === "victory") addReward(65);
  }, [addReward]);

  return (
    <main className="app-shell">
      <section className="mobile-frame">
        <div className="battle-host">
          <BattleCanvas build={build} onResult={handleResult} />
          <div className="battle-overlay">
            <div className="battle-hud panel">
              <strong>Survival Test</strong>
              <span className="small">
                HP {stats.hp.toFixed(0)} · DPS {stats.dps.toFixed(1)} · accel{" "}
                {stats.acceleration.toFixed(2)}
              </span>
              <div className="bar">
                <span style={{ width: `${result === "defeat" ? 0 : 100}%` }} />
              </div>
            </div>
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
