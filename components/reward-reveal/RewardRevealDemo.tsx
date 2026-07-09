"use client";

import type { CSSProperties } from "react";
import { useState } from "react";
import { REWARD_CARD_ASSETS } from "./asset-paths";
import { RewardReveal } from "./RewardReveal";
import { RARITY_VFX } from "./rarity-config";
import { REWARD_RARITIES, type RewardRarity } from "./types";

export function RewardRevealDemo() {
  const [rarity, setRarity] = useState<RewardRarity>("ultra");
  const [replayKey, setReplayKey] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(true);
  const cardAssets = REWARD_CARD_ASSETS[rarity];

  return (
    <section className="reward-preview-section" aria-label="Rarity preview" data-collapsed={!previewOpen}>
      {previewOpen ? (
        <div className="reward-preview-stage">
          <RewardReveal autoplay cardBackTextureUrl={cardAssets.back} cardTextureUrl={cardAssets.front} mode="single" rarity={rarity} replayKey={replayKey} />
        </div>
      ) : null}
      <div className="reward-demo-controls" aria-label="Reward rarity preview controls">
        <div className="reward-demo-rarities" role="list">
          {REWARD_RARITIES.map((item) => (
            <button
              key={item}
              className="reward-demo-chip"
              data-active={item === rarity}
              onClick={() => {
                setRarity(item);
                setReplayKey((value) => value + 1);
              }}
              style={{ "--rarity-color": RARITY_VFX[item].colors.primary } as CSSProperties}
              type="button"
            >
              {RARITY_VFX[item].label}
            </button>
          ))}
        </div>
        <button className="reward-demo-replay" onClick={() => setReplayKey((value) => value + 1)} type="button">
          Replay
        </button>
        <button className="reward-demo-toggle" aria-expanded={previewOpen} onClick={() => setPreviewOpen((value) => !value)} type="button">
          {previewOpen ? "Collapse" : "Show"}
        </button>
      </div>
    </section>
  );
}
