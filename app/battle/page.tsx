"use client";

import type {
  BattleConnectionDto,
  MissionAttemptStatusDto,
  PvpBattleParticipantConnectionDto
} from "@spacey/contracts";
import type { BattleServerMessage } from "@spacey/protocol";
import type { Route } from "next";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  ACTIVE_MISSION_ATTEMPT_STORAGE_KEY,
  abandonMissionAttempt,
  cancelMatchmakingTicket,
  getMatchmakingTicket,
  getMissionAttemptStatus,
  reconnectMissionAttempt,
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
  const router = useRouter();
  const { bootstrap, refreshBootstrap } = useServerSession();
  const attemptId = searchParams.get("attemptId");
  const requestRef = useRef<{
    key: string;
    promise: Promise<{ status: MissionAttemptStatusDto; connection: BattleConnectionDto | null }> | null;
  } | null>(null);
  const [attemptStatus, setAttemptStatus] = useState<MissionAttemptStatusDto | null>(null);
  const [connection, setConnection] = useState<BattleConnectionDto | null>(null);
  const [result, setResult] = useState<BattleEndedMessage | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [abandoning, setAbandoning] = useState(false);

  const requestReconnect = useCallback(() => {
    if (!attemptId) return Promise.reject(new Error("Mission attempt ID is missing."));
    return reconnectMissionAttempt(attemptId);
  }, [attemptId]);

  useEffect(() => {
    if (!attemptId) return;
    const key = `${attemptId}:${retryKey}`;
    if (!requestRef.current || requestRef.current.key !== key) {
      requestRef.current = { key, promise: null };
    }
    const request = requestRef.current;
    request.promise ??= getMissionAttemptStatus(attemptId).then(async (status) => {
      if (status.status === "completed" || status.status === "failed") return { status, connection: null };
      if (!status.reconnect.permitted) {
        throw new Error("This mission attempt is not eligible for reconnect.");
      }
      return { status, connection: await requestReconnect() };
    });
    let active = true;
    setConnection(null);
    setErrorMessage(null);
    void request.promise.then((next) => {
      if (!active) return;
      if (next.status.resultId) {
        window.sessionStorage.removeItem(ACTIVE_MISSION_ATTEMPT_STORAGE_KEY);
        router.replace(resultRoute(next.status.resultId));
        return;
      }
      setAttemptStatus(next.status);
      setConnection(next.connection);
    }).catch((error: unknown) => {
      request.promise = null;
      if (active) setErrorMessage(error instanceof Error ? error.message : "Mission attempt could not be resumed.");
    });
    return () => {
      active = false;
    };
  }, [attemptId, requestReconnect, retryKey, router]);

  const handleEnded = useCallback((nextResult: BattleEndedMessage) => {
    setResult(nextResult);
    window.sessionStorage.removeItem(ACTIVE_MISSION_ATTEMPT_STORAGE_KEY);
    void refreshBootstrap();
    router.replace(resultRoute(nextResult.resultId));
  }, [refreshBootstrap, router]);

  const retry = useCallback(() => setRetryKey((value) => value + 1), []);

  const abandon = useCallback(async () => {
    if (!attemptId || abandoning) return;
    setAbandoning(true);
    try {
      await abandonMissionAttempt(attemptId);
      window.sessionStorage.removeItem(ACTIVE_MISSION_ATTEMPT_STORAGE_KEY);
      await refreshBootstrap().catch(() => undefined);
      router.push("/hangar#contracts");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Mission attempt could not be abandoned.");
      setAbandoning(false);
    }
  }, [abandoning, attemptId, refreshBootstrap, router]);

  return (
    <main className="app-shell game-shell">
      <section className="mobile-frame game-frame game-frame--battle">
        <div className="battle-host">
          {connection && !result ? (
            <AuthoritativeBattle connection={connection} onEnded={handleEnded} requestReconnect={requestReconnect} />
          ) : null}
          <div className="battle-overlay">
            {!attemptId ? (
              <BattleGate
                message="Create or resume a server-owned mission attempt from the Hangar."
                title="Mission Attempt Required"
              />
            ) : errorMessage ? (
              <BattleStatusPanel
                cancelLabel={abandoning ? "Abandoning…" : "Abandon Attempt"}
                message={errorMessage}
                onCancel={abandoning ? undefined : () => void abandon()}
                onRetry={retry}
                title="Resume Failed"
              />
            ) : attemptStatus && (attemptStatus.status === "completed" || attemptStatus.status === "failed") ? (
              <BattleGate
                message={`Attempt is ${attemptStatus.status}${attemptStatus.resultId ? ` · result ${attemptStatus.resultId}` : ""}.`}
                title="Mission Attempt Closed"
              />
            ) : !connection && !result ? (
              <BattleStatusPanel
                cancelLabel={abandoning ? "Abandoning…" : "Abandon Attempt"}
                message={attemptStatus
                  ? `${attemptStatus.status} · requesting a fresh one-time connection ticket…`
                  : "Checking the server-owned attempt and reconnect window…"}
                onCancel={abandoning ? undefined : () => void abandon()}
                title="Resuming Battle"
              />
            ) : null}
            {result ? (
              <div className="mission-result-layer">
                <section className="mission-result-overlay panel" data-outcome={result.outcome}>
                  <div className="panel-title">
                    <span className="eyebrow">Server finalized · mission attempt</span>
                    <h2>{result.outcome === "victory" ? "Contract Complete" : result.outcome === "draw" ? "Draw" : result.outcome === "forfeit" ? "Connection Forfeit" : "Mission Failed"}</h2>
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
  const [canCancel, setCanCancel] = useState(true);

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
          setCanCancel(true);
          setStatusMessage(`Waiting for opponent · MMR ${ticket.mmr} · ${ticket.region.toUpperCase()}`);
          timer = setTimeout(() => void poll(), 1_000);
          return;
        }
        if (action.type === "result") {
          setCanCancel(false);
          setStatusMessage("Match complete · loading the authoritative result…");
          const attempt = await getMissionAttemptStatus(action.attemptId);
          if (!active) return;
          if (attempt.resultId) {
            router.replace(resultRoute(attempt.resultId));
            return;
          }
          timer = setTimeout(() => void poll(), 1_000);
          return;
        }
        if (action.type === "terminal") {
          setCanCancel(false);
          setErrorMessage(action.message);
          return;
        }
        setCanCancel(false);
        setStatusMessage("Opponent found · issuing participant ticket…");
        const nextConnection = await requestConnection();
        if (active) setConnection(nextConnection);
      } catch (error) {
        if (active) setErrorMessage(error instanceof Error ? error.message : "PvP matchmaking state is unavailable.");
      }
    };
    setConnection(null);
    setErrorMessage(null);
    setCanCancel(true);
    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [matchmakingTicketId, requestConnection, retryKey, router]);

  const handleEnded = useCallback((nextResult: BattleEndedMessage) => {
    setResult(nextResult);
    void refreshBootstrap();
    router.replace(resultRoute(nextResult.resultId));
  }, [refreshBootstrap, router]);

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
                onCancel={canCancel ? () => void cancel() : undefined}
                title="Ranked Matchmaking"
              />
            ) : null}
            {result ? (
              <div className="mission-result-layer">
                <section className="mission-result-overlay panel" data-outcome={result.outcome}>
                  <div className="panel-title">
                    <span className="eyebrow">Server finalized · Ranked Duel</span>
                    <h2>{result.outcome === "victory" ? "Victory" : result.outcome === "draw" ? "Draw" : result.outcome === "forfeit" ? "Forfeit" : "Defeat"}</h2>
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

function resultRoute(resultId: string): Route {
  return `/results/${encodeURIComponent(resultId)}` as Route;
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
  onCancel,
  cancelLabel = "Cancel Queue"
}: {
  title: string;
  message: string;
  onRetry?: () => void;
  onCancel?: () => void;
  cancelLabel?: string;
}) {
  return (
    <div className="result-panel panel" aria-live="polite">
      <div className="panel-title">
        <h2>{title}</h2>
        <span className="small">{message}</span>
      </div>
      {onRetry || onCancel ? (
        <div className={onRetry && onCancel ? "footer-actions" : "footer-actions footer-actions--single"}>
          {onCancel ? <button className="button" onClick={onCancel} type="button">{cancelLabel}</button> : null}
          {onRetry ? <button className="button primary" onClick={onRetry} type="button">Retry</button> : null}
        </div>
      ) : null}
    </div>
  );
}
