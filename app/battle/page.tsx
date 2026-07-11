"use client";

import type { BattleConnectionDto, PvpBattleParticipantConnectionDto } from "@spacey/contracts";
import type { BattleServerMessage } from "@spacey/protocol";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelMatchmakingTicket,
  createMissionAttempt,
  getMatchmakingTicket,
  requestPvpMatchConnection
} from "@/game/server/api-client";
import { resolvePvpMatchmakingAction } from "@/game/server/pvp-matchmaking";
import { useServerSession } from "@/game/server/session-context";

const AuthoritativeBattle = dynamic(
  () => import("@/components/server/AuthoritativeBattle").then((module) => module.AuthoritativeBattle),
  { ssr: false }
);

type BattleEndedMessage = Extract<BattleServerMessage, { type: "battle.ended" }>;

export default function BattlePage() {
  return (
    <Suspense fallback={<BattleStatus title="Loading Contract" message="Loading server mission state…" />}>
      <ServerBattlePage />
    </Suspense>
  );
}

function ServerBattlePage() {
  const searchParams = useSearchParams();
  const matchmakingTicketId = searchParams.get("matchmakingTicket");
  return matchmakingTicketId
    ? <PvpServerBattlePage matchmakingTicketId={matchmakingTicketId} />
    : <PveServerBattlePage />;
}

function PveServerBattlePage() {
  const searchParams = useSearchParams();
  const { bootstrap, refreshBootstrap } = useServerSession();
  const requestedMissionId = searchParams.get("mission");
  const mission = useMemo(
    () => requestedMissionId
      ? bootstrap.missions.find((candidate) => candidate.id === requestedMissionId) ?? null
      : bootstrap.missions[0] ?? null,
    [bootstrap.missions, requestedMissionId]
  );
  const buildRevisionId = bootstrap.activeBuild?.activeRevision.id ?? null;
  const requestRef = useRef<{
    key: string;
    idempotencyKey: string;
    promise: Promise<BattleConnectionDto> | null;
  } | null>(null);
  const [connection, setConnection] = useState<BattleConnectionDto | null>(null);
  const [result, setResult] = useState<BattleEndedMessage | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!mission || !buildRevisionId) return;
    const key = `${mission.id}:${buildRevisionId}`;
    if (!requestRef.current || requestRef.current.key !== key) {
      requestRef.current = { key, idempotencyKey: crypto.randomUUID(), promise: null };
    }
    const request = requestRef.current;
    request.promise ??= createMissionAttempt({
      missionId: mission.id,
      shipBuildRevisionId: buildRevisionId,
      idempotencyKey: request.idempotencyKey
    });
    let active = true;
    setConnection(null);
    setErrorMessage(null);
    void request.promise.then((nextConnection) => {
      if (active) setConnection(nextConnection);
    }).catch((error: unknown) => {
      request.promise = null;
      if (active) setErrorMessage(error instanceof Error ? error.message : "Mission attempt could not be created.");
    });
    return () => {
      active = false;
    };
  }, [buildRevisionId, mission, retryKey]);

  const handleEnded = useCallback((nextResult: BattleEndedMessage) => {
    setResult(nextResult);
    void refreshBootstrap();
  }, [refreshBootstrap]);

  const retry = useCallback(() => setRetryKey((value) => value + 1), []);

  return (
    <main className="app-shell game-shell">
      <section className="mobile-frame game-frame game-frame--battle">
        <div className="battle-host">
          {connection && mission && !result ? (
            <AuthoritativeBattle connection={connection} mission={mission} onEnded={handleEnded} />
          ) : null}
          <div className="battle-overlay">
            {!mission ? (
              <BattleGate
                message="No published mission is available in the active content release."
                title="Contract Required"
              />
            ) : !buildRevisionId ? (
              <BattleGate
                message="Create and validate a server-owned ship build before launch."
                title="Ship Build Required"
              />
            ) : errorMessage ? (
              <BattleStatusPanel message={errorMessage} onRetry={retry} title="Launch Failed" />
            ) : !connection && !result ? (
              <BattleStatusPanel message="Creating a server-owned attempt and one-time battle ticket…" title="Preparing Battle" />
            ) : null}
            {result && mission ? (
              <div className="mission-result-layer">
                <section className="mission-result-overlay panel" data-outcome={result.outcome}>
                  <div className="panel-title">
                    <span className="eyebrow">Server finalized · {mission.name}</span>
                    <h2>{result.outcome === "victory" ? "Contract Complete" : result.outcome === "forfeit" ? "Connection Forfeit" : "Mission Failed"}</h2>
                  </div>
                  <p className="mission-result-reason">{result.reason}</p>
                  <dl className="server-result-facts">
                    <div><dt>Result</dt><dd>{result.resultId}</dd></div>
                    <div><dt>Final tick</dt><dd>{result.finalTick}</dd></div>
                    <div><dt>Credits</dt><dd>{bootstrap.wallet.credits}</dd></div>
                    <div><dt>Scrap</dt><dd>{bootstrap.wallet.scrap}</dd></div>
                  </dl>
                  <p className="small">Damage, rewards, inventory and progression were committed by the server.</p>
                  <div className="footer-actions footer-actions--single">
                    <Link className="button primary" href="/hangar#contracts">Mission Board</Link>
                  </div>
                </section>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}

function PvpServerBattlePage({ matchmakingTicketId }: { matchmakingTicketId: string }) {
  const router = useRouter();
  const { bootstrap, refreshBootstrap } = useServerSession();
  const [connection, setConnection] = useState<PvpBattleParticipantConnectionDto | null>(null);
  const [result, setResult] = useState<BattleEndedMessage | null>(null);
  const [statusMessage, setStatusMessage] = useState("Waiting for an opponent in ranked-eu…");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const requestConnection = useCallback(
    () => requestPvpMatchConnection(matchmakingTicketId),
    [matchmakingTicketId]
  );

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const ticket = await getMatchmakingTicket(matchmakingTicketId);
        if (!active) return;
        const action = resolvePvpMatchmakingAction(ticket);
        if (action.type === "poll") {
          setStatusMessage(`Waiting for opponent · MMR ${ticket.mmr} · ${ticket.region.toUpperCase()}`);
          timer = setTimeout(() => void poll(), 1_000);
          return;
        }
        if (action.type === "terminal") {
          setErrorMessage(action.message);
          return;
        }
        setStatusMessage("Opponent found · issuing participant ticket…");
        const nextConnection = await requestConnection();
        if (active) setConnection(nextConnection);
      } catch (error) {
        if (active) setErrorMessage(error instanceof Error ? error.message : "PvP matchmaking state is unavailable.");
      }
    };
    setConnection(null);
    setErrorMessage(null);
    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [matchmakingTicketId, requestConnection, retryKey]);

  const handleEnded = useCallback((nextResult: BattleEndedMessage) => {
    setResult(nextResult);
    void refreshBootstrap();
  }, [refreshBootstrap]);

  const cancel = useCallback(async () => {
    try {
      await cancelMatchmakingTicket(matchmakingTicketId);
      router.push("/hangar#contracts");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Matchmaking ticket could not be cancelled.");
    }
  }, [matchmakingTicketId, router]);

  return (
    <main className="app-shell game-shell">
      <section className="mobile-frame game-frame game-frame--battle">
        <div className="battle-host">
          {connection && !result ? (
            <AuthoritativeBattle
              connection={connection}
              onEnded={handleEnded}
              requestReconnect={requestConnection}
            />
          ) : null}
          <div className="battle-overlay">
            {errorMessage ? (
              <BattleStatusPanel
                message={errorMessage}
                onRetry={() => setRetryKey((value) => value + 1)}
                title="PvP Connection Failed"
              />
            ) : !connection && !result ? (
              <BattleStatusPanel
                message={statusMessage}
                onCancel={() => void cancel()}
                title="Ranked Matchmaking"
              />
            ) : null}
            {result ? (
              <div className="mission-result-layer">
                <section className="mission-result-overlay panel" data-outcome={result.outcome}>
                  <div className="panel-title">
                    <span className="eyebrow">Server finalized · Ranked Duel</span>
                    <h2>{result.outcome === "victory" ? "Victory" : result.outcome === "forfeit" ? "Forfeit" : "Defeat"}</h2>
                  </div>
                  <p className="mission-result-reason">{result.reason}</p>
                  <dl className="server-result-facts">
                    <div><dt>Result</dt><dd>{result.resultId}</dd></div>
                    <div><dt>Final tick</dt><dd>{result.finalTick}</dd></div>
                    <div><dt>Credits</dt><dd>{bootstrap.wallet.credits}</dd></div>
                    <div><dt>Scrap</dt><dd>{bootstrap.wallet.scrap}</dd></div>
                  </dl>
                  <p className="small">Outcome and season rating were committed once by the battle worker.</p>
                  <div className="footer-actions footer-actions--single">
                    <Link className="button primary" href="/hangar#contracts">Return to Hangar</Link>
                  </div>
                </section>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}

function BattleGate({ title, message }: { title: string; message: string }) {
  return (
    <div className="result-panel panel" aria-label="Mission Gate">
      <div className="panel-title">
        <h2>{title}</h2>
        <span className="small">{message}</span>
      </div>
      <div className="footer-actions footer-actions--single">
        <Link className="button primary" href="/hangar#contracts">Mission Board</Link>
      </div>
    </div>
  );
}

function BattleStatus({
  title,
  message,
  onRetry
}: {
  title: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <main className="app-shell game-shell">
      <section className="mobile-frame game-frame game-frame--battle">
        <div className="battle-host">
          <div className="battle-overlay">
            <BattleStatusPanel message={message} onRetry={onRetry} title={title} />
          </div>
        </div>
      </section>
    </main>
  );
}

function BattleStatusPanel({
  title,
  message,
  onRetry,
  onCancel
}: {
  title: string;
  message: string;
  onRetry?: () => void;
  onCancel?: () => void;
}) {
  return (
    <div className="result-panel panel" aria-live="polite">
      <div className="panel-title">
        <h2>{title}</h2>
        <span className="small">{message}</span>
      </div>
      {onRetry || onCancel ? (
        <div className={onRetry && onCancel ? "footer-actions" : "footer-actions footer-actions--single"}>
          {onCancel ? <button className="button" onClick={onCancel} type="button">Cancel Queue</button> : null}
          {onRetry ? <button className="button primary" onClick={onRetry} type="button">Retry</button> : null}
        </div>
      ) : null}
    </div>
  );
}
