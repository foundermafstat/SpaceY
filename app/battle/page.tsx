"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { MissionObjectiveHud } from "@/components/battle/MissionObjectiveHud";
import { MissionResultOverlay } from "@/components/battle/MissionResultOverlay";
import { getMissionById } from "@/game/data/missions";
import { evaluateMissionReadiness } from "@/game/mission/readiness";
import type { BattleTelemetry, MissionResult } from "@/game/mission/runtime";
import { useShipStore } from "@/game/store/shipStore";
import { useShipStoreHydrated } from "@/game/store/useShipStoreHydrated";
import { getBuildBlockers } from "@/game/ship/validation";

const BattleCanvas = dynamic(() => import("@/components/battle/BattleCanvas"), {
  ssr: false
});

export default function BattlePage() {
  const build = useShipStore((state) => state.build);
  const selectedMissionId = useShipStore((state) => state.selectedMissionId);
  const wallet = useShipStore((state) => state.wallet);
  const completeMission = useShipStore((state) => state.completeMission);
  const storeHydrated = useShipStoreHydrated();
  const [telemetry, setTelemetry] = useState<BattleTelemetry | null>(null);
  const [result, setResult] = useState<MissionResult | null>(null);
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

  const handleResult = useCallback((nextResult: MissionResult) => {
    setResult(selectedMission ? completeMission(selectedMission, nextResult) : nextResult);
  }, [completeMission, selectedMission]);
  const handleRuntimeChange = useCallback((nextTelemetry: BattleTelemetry) => {
    setTelemetry(nextTelemetry);
  }, []);

  return (
    <main className="app-shell game-shell">
      <section className="mobile-frame game-frame game-frame--battle">
        <div className="battle-host">
          {canStartBattle && selectedMission && !result ? (
            <BattleCanvas
              build={build}
              key={selectedMission.id}
              mission={selectedMission}
              onResult={handleResult}
              onRuntimeChange={handleRuntimeChange}
            />
          ) : null}
          <div className="battle-overlay">
            {canStartBattle && selectedMission && !result ? (
              <MissionObjectiveHud mission={selectedMission} telemetry={telemetry} />
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
            {result && selectedMission ? (
              <MissionResultOverlay mission={selectedMission} result={result} wallet={wallet} />
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
