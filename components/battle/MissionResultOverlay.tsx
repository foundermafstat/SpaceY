"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { WalletStrip } from "@/components/hangar/WalletStrip";
import { REWARD_CARD_ASSETS } from "@/components/reward-reveal/asset-paths";
import type { MissionResult } from "@/game/mission/runtime";
import type {
  MissionDef,
  MissionItemRewardGrant,
  MissionRewardGrant,
  PlayerWallet,
  WalletCurrency
} from "@/game/mission/types";

const RewardReveal = dynamic(
  () => import("@/components/reward-reveal/RewardReveal").then((module) => module.RewardReveal),
  { ssr: false }
);

type MissionResultOverlayProps = {
  mission: MissionDef;
  result: MissionResult;
  wallet: PlayerWallet;
};

const currencyLabels: Record<WalletCurrency, string> = {
  credits: "Credits",
  scrap: "Scrap",
  alloy: "Alloy",
  dataShards: "Data shards"
};

export function MissionResultOverlay({ mission, result, wallet }: MissionResultOverlayProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const [replayKey, setReplayKey] = useState(0);
  const itemReward = result.rewards.find(
    (reward): reward is MissionItemRewardGrant => reward.kind === "item"
  ) ?? null;
  const replayReward = useCallback(() => setReplayKey((value) => value + 1), []);
  const retryMission = useCallback(() => window.location.reload(), []);
  const victory = result.outcome === "victory";

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div className="mission-result-layer">
      <section
        aria-describedby="mission-result-reason"
        aria-labelledby="mission-result-title"
        aria-modal="true"
        className="panel result-panel mission-result-overlay"
        data-outcome={result.outcome}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="mission-result-header">
          <div>
            <span className="mission-eyebrow">{victory ? "Contract secured" : "Contract lost"}</span>
            <h2 id="mission-result-title">{victory ? "Mission Complete" : "Mission Failed"}</h2>
            <strong>{mission.name}</strong>
          </div>
          <span className="mission-result-state">{victory ? "Complete" : "Failed"}</span>
        </header>
        <p className="mission-result-reason" id="mission-result-reason">{formatResultReason(result)}</p>

        <div className="mission-result-body">
          <section className="mission-result-summary" aria-label="Mission result summary">
            <div className="mission-result-objective">
              <span>Objective</span>
              <strong>{mission.objective.label}</strong>
              <small>
                {Math.floor(result.objective.progress)} / {result.objective.target}
              </small>
            </div>
            <div className="mission-result-metrics">
              <span>Time <strong>{formatDuration(result.durationSec)}</strong></span>
              <span>Kills <strong>{result.enemiesDestroyed}</strong></span>
              <span>Damage <strong>{Math.ceil(result.damageTaken)}</strong></span>
              <span>Parts lost <strong>{result.detachedPartIds.length}</strong></span>
            </div>
            <div className="mission-result-damage">
              <span>Damaged parts</span>
              <strong>{result.damagedPartIds.length}</strong>
            </div>
          </section>

          <section className="mission-result-rewards" aria-label="Mission rewards">
            <div className="mission-result-section-title">
              <span>Rewards</span>
              <strong>{result.rewards.length ? "Secured" : victory ? "Claimed" : "None"}</strong>
            </div>
            {result.rewards.length ? (
              <ul className="mission-reward-list">
                {result.rewards.map((reward) => (
                  <RewardLine key={reward.id} reward={reward} />
                ))}
              </ul>
            ) : (
              <p className="mission-result-empty">
                {victory
                  ? "Rewards for this attempt were already claimed."
                  : "Complete the objective to secure rewards."}
              </p>
            )}
            {itemReward ? (
              <div className="mission-reward-reveal-stage" aria-label={`${itemReward.label} reward reveal`}>
                <RewardReveal
                  autoplay
                  cardBackTextureUrl={REWARD_CARD_ASSETS[itemReward.rarity].back}
                  cardTextureUrl={REWARD_CARD_ASSETS[itemReward.rarity].front}
                  dpr={[1, 1.5]}
                  mode="packCard"
                  rarity={itemReward.rarity}
                  replayKey={replayKey}
                />
                <div className="mission-reward-reveal-copy">
                  <span>{itemReward.rarity}</span>
                  <strong>{itemReward.label}</strong>
                  <button className="mission-reward-replay" onClick={replayReward} type="button">
                    Replay reveal
                  </button>
                </div>
              </div>
            ) : null}
            <div className="mission-result-wallet">
              <span>Wallet after mission</span>
              <WalletStrip wallet={wallet} />
            </div>
          </section>
        </div>

        <footer className="mission-result-actions">
          <Link className={`button ${victory ? "primary" : ""}`} href="/hangar#structure">
            Hangar
          </Link>
          <Link className="button" href="/hangar#contracts">
            Mission Board
          </Link>
          <button className={`button ${victory ? "" : "primary"}`} onClick={retryMission} type="button">
            Retry
          </button>
        </footer>
      </section>
    </div>
  );
}

function RewardLine({ reward }: { reward: MissionRewardGrant }) {
  return (
    <li data-kind={reward.kind}>
      <span>{reward.label}</span>
      <strong>
        {reward.kind === "currency"
          ? `+${reward.amount} ${currencyLabels[reward.currency]}`
          : `${reward.rarity} item`}
      </strong>
    </li>
  );
}

function formatResultReason(result: MissionResult) {
  if (result.reason === "objective_complete") return "Objective complete. Mission telemetry and salvage were secured.";
  if (result.reason === "time_expired") return "The contract timer expired before completion.";
  return "The ship was destroyed before the objective was completed.";
}

function formatDuration(seconds: number) {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(wholeSeconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(wholeSeconds % 60).padStart(2, "0")}`;
}
