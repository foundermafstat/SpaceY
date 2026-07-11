"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { getMissionById } from "@/game/data/missions";
import { evaluateMissionReadiness } from "@/game/mission/readiness";
import { useShipStore } from "@/game/store/shipStore";
import { useShipStoreHydrated } from "@/game/store/useShipStoreHydrated";
import { calculateShipStatsV2 } from "@/game/ship/statsV2";
import { getBuildBlockers } from "@/game/ship/validation";

const BattleCanvas = dynamic(() => import("@/components/battle/BattleCanvas"), {
  ssr: false
});

export default function BattlePage() {
  const build = useShipStore((state) => state.build);
  const selectedMissionId = useShipStore((state) => state.selectedMissionId);
  const storeHydrated = useShipStoreHydrated();
  const [result, setResult] = useState<"victory" | "defeat" | null>(null);
  const stats = useMemo(() => calculateShipStatsV2(build), [build]);
  const blockers = useMemo(() => getBuildBlockers(build), [build]);
  const selectedMission = selectedMissionId ? getMissionById(selectedMissionId) : null;
  const missionReadiness = useMemo(
    () => selectedMission ? evaluateMissionReadiness(build, selectedMission) : null,
    [build, selectedMission]
  );
  const canStartBattle = storeHydrated
    && selectedMission !== null
    && blockers.length === 0
    && missionReadiness?.canLaunch === true;
  const gateMessage = blockers[0]?.message
    ?? missionReadiness?.blockers[0]?.message
    ?? "Select a contract before launch.";

  const handleResult = useCallback((nextResult: "victory" | "defeat") => {
    setResult(nextResult);
  }, []);

  return (
    <main className="app-shell game-shell">
      <section className="mobile-frame game-frame game-frame--battle">
        <div className="battle-host">
          {canStartBattle ? <BattleCanvas build={build} onResult={handleResult} /> : null}
          <div className="battle-overlay">
            {canStartBattle && selectedMission ? (
              <div className="battle-hud panel">
                <span className="mission-eyebrow">Active contract</span>
                <strong>{selectedMission.name}</strong>
                <span className="battle-objective">{selectedMission.objective.label}</span>
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
                <div className="bar" aria-label="Objective runtime pending">
                  <span style={{ width: `${result === "defeat" ? 0 : 100}%` }} />
                </div>
              </div>
            ) : null}
            {!storeHydrated ? (
              <div className="result-panel panel">
                <div className="panel-title">
                  <h2>Loading Contract</h2>
                  <span className="small">Checking saved mission state…</span>
                </div>
              </div>
            ) : !canStartBattle ? (
              <div className="result-panel panel" aria-label="Mission Gate">
                <div className="panel-title">
                  <h2>{selectedMission ? "Contract Blocked" : "Contract Required"}</h2>
                  <span className="small">{gateMessage}</span>
                </div>
                <div className="footer-actions footer-actions--single">
                  <Link className="button primary" href="/hangar#contracts">
                    Mission Board
                  </Link>
                </div>
              </div>
            ) : null}
            {result && (
              <div className="result-panel panel">
                <div className="panel-title">
                  <h2>{result === "victory" ? "Victory" : "Ship Destroyed"}</h2>
                  <span className="small">
                    {result === "victory" ? "Mission rewards arrive with the result system." : "Review the build and try again."}
                  </span>
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
