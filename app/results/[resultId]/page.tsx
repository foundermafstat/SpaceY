"use client";

import type { BattleResultDto, RepairQuoteDto } from "@spacey/contracts";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  commitRepair,
  createRepairQuote,
  getBattleResult
} from "@/game/server/api-client";
import { useServerSession } from "@/game/server/session-context";

export default function AuthoritativeResultPage() {
  const { resultId } = useParams<{ resultId: string }>();
  const { bootstrap, refreshBootstrap } = useServerSession();
  const [result, setResult] = useState<BattleResultDto | null>(null);
  const [quote, setQuote] = useState<RepairQuoteDto | null>(null);
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const quoteRequestRef = useRef<{ inventoryItemId: string; idempotencyKey: string } | null>(null);
  const commitRequestRef = useRef<{ quoteId: string; idempotencyKey: string } | null>(null);
  const inventoryById = useMemo(
    () => new Map(bootstrap.inventory.map((item) => [item.id, item])),
    [bootstrap.inventory]
  );

  const load = useCallback(async () => {
    setErrorMessage(null);
    try {
      setResult(await getBattleResult(resultId));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Battle result is unavailable.");
    }
  }, [resultId]);

  useEffect(() => {
    void load();
  }, [load]);

  const requestRepair = useCallback(async (inventoryItemId: string) => {
    if (pendingItemId !== null) return;
    if (!quoteRequestRef.current || quoteRequestRef.current.inventoryItemId !== inventoryItemId) {
      quoteRequestRef.current = { inventoryItemId, idempotencyKey: crypto.randomUUID() };
    }
    const request = quoteRequestRef.current;
    setPendingItemId(inventoryItemId);
    setQuote(null);
    commitRequestRef.current = null;
    setErrorMessage(null);
    try {
      setQuote(await createRepairQuote({ inventoryItemId, idempotencyKey: request.idempotencyKey }));
      quoteRequestRef.current = null;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Repair quote could not be created.");
    } finally {
      setPendingItemId(null);
    }
  }, [pendingItemId]);

  const confirmRepair = useCallback(async () => {
    if (!quote || pendingItemId !== null) return;
    if (!commitRequestRef.current || commitRequestRef.current.quoteId !== quote.id) {
      commitRequestRef.current = { quoteId: quote.id, idempotencyKey: crypto.randomUUID() };
    }
    const request = commitRequestRef.current;
    setPendingItemId(quote.inventoryItemId);
    setErrorMessage(null);
    try {
      await commitRepair({ quoteId: quote.id, idempotencyKey: request.idempotencyKey });
      commitRequestRef.current = null;
      setQuote(null);
      await Promise.all([load(), refreshBootstrap()]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Repair could not be committed.");
    } finally {
      setPendingItemId(null);
    }
  }, [load, pendingItemId, quote, refreshBootstrap]);

  const cancelQuote = useCallback(() => {
    setQuote(null);
    commitRequestRef.current = null;
  }, []);

  return (
    <main className="app-shell game-shell">
      <section className="mobile-frame game-frame game-frame--battle">
        <div className="mission-result-layer">
          <section className="mission-result-overlay panel" data-outcome={result?.outcome ?? "pending"}>
            {!result ? (
              <div className="mission-result-empty">
                <h1>{errorMessage ? "Result unavailable" : "Loading result…"}</h1>
                <p>{errorMessage ?? "Reading the authoritative battle transaction."}</p>
                {errorMessage ? <button className="button primary" onClick={() => void load()} type="button">Retry</button> : null}
              </div>
            ) : (
              <>
                <header className="mission-result-header">
                  <div>
                    <span className="eyebrow">Server finalized · {result.mission.name}</span>
                    <h1>{outcomeTitle(result.outcome)}</h1>
                  </div>
                  <span className="mission-result-state">{result.outcome}</span>
                </header>
                <p className="mission-result-reason">{result.reason}</p>

                <div className="mission-result-body">
                  <section className="mission-result-summary" aria-label="Battle summary">
                    <dl className="server-result-facts">
                      <div><dt>Mode</dt><dd>{result.mode.toUpperCase()}</dd></div>
                      <div><dt>Ticks</dt><dd>{result.durationTicks}</dd></div>
                      <div><dt>XP</dt><dd>+{result.experience}</dd></div>
                      <div><dt>Replay</dt><dd>{result.replayStatus}</dd></div>
                      {result.mmr ? <div><dt>MMR</dt><dd>{result.mmr.before} → {result.mmr.after}</dd></div> : null}
                    </dl>
                    <div className="mission-result-wallet">
                      <span>Credits <strong>{result.walletAfter.credits}</strong></span>
                      <span>Scrap <strong>{result.walletAfter.scrap}</strong></span>
                      <span>Alloy <strong>{result.walletAfter.alloy}</strong></span>
                    </div>
                  </section>

                  <section className="mission-result-rewards" aria-label="Authoritative rewards">
                    <div className="mission-result-section-title">
                      <strong>Rewards</strong>
                      <span>{result.grantedItems.length} items</span>
                    </div>
                    <div className="server-result-damage-list">
                      {Object.entries(result.rewards).map(([currency, amount]) => (
                        <div className="server-result-damage-item" key={currency}>
                          <span><strong>{currency}</strong><small>+{amount}</small></span>
                        </div>
                      ))}
                      {result.grantedItems.map((item) => (
                        <div className="server-result-damage-item" key={item.inventoryItemId}>
                          <span><strong>{item.definitionId}</strong><small>{item.rarity}</small></span>
                        </div>
                      ))}
                      {Object.keys(result.rewards).length === 0 && result.grantedItems.length === 0
                        ? <p className="small">No persistent rewards.</p>
                        : null}
                    </div>
                  </section>

                  <section className="mission-result-rewards" aria-label="Persistent module damage">
                    <div className="mission-result-section-title">
                      <strong>Module damage</strong>
                      <span>{result.moduleDamage.length}</span>
                    </div>
                    {result.moduleDamage.length === 0 ? <p className="small">No persistent damage.</p> : (
                      <div className="server-result-damage-list">
                        {result.moduleDamage.map((item) => {
                          const currentItem = inventoryById.get(item.inventoryItemId);
                          const repairable = currentItem?.state === "damaged"
                            && currentItem.durability > 0
                            && currentItem.durability < 10_000;
                          return (
                            <div className="server-result-damage-item" key={item.inventoryItemId}>
                              <span><strong>{item.definitionId}</strong><small>{item.durabilityAfter / 100}% · −{item.damage / 100}%</small></span>
                              {repairable ? (
                                <button
                                  className="button small"
                                  disabled={pendingItemId !== null}
                                  onClick={() => void requestRepair(item.inventoryItemId)}
                                  type="button"
                                >Quote repair</button>
                              ) : <small>{currentItem?.state ?? item.state}</small>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                </div>

                {quote ? (
                  <div className="server-repair-quote" role="status">
                    <span>Full repair · {quote.definitionId}</span>
                    <strong>{quote.cost} credits</strong>
                    <button className="button primary small" disabled={pendingItemId !== null} onClick={() => void confirmRepair()} type="button">Confirm</button>
                    <button className="button small" disabled={pendingItemId !== null} onClick={cancelQuote} type="button">Cancel</button>
                  </div>
                ) : null}
                {errorMessage ? <p className="server-message server-message--error">{errorMessage}</p> : null}
                <footer className="mission-result-actions">
                  <Link className="button primary" href="/hangar#contracts">Return to Hangar</Link>
                </footer>
              </>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

function outcomeTitle(outcome: BattleResultDto["outcome"]): string {
  if (outcome === "victory") return "Contract Complete";
  if (outcome === "draw") return "Draw";
  if (outcome === "forfeit") return "Forfeit";
  return "Mission Failed";
}
