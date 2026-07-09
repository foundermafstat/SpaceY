"use client";

import type { CSSProperties } from "react";
import Image from "next/image";
import { useMemo, useRef, useState } from "react";
import { REWARD_CARD_ASSETS } from "./asset-paths";
import { RewardReveal } from "./RewardReveal";
import { RewardRevealDemo } from "./RewardRevealDemo";
import { RARITY_VFX } from "./rarity-config";
import type { RewardRarity } from "./types";

type PackCard = {
  id: string;
  rarity: RewardRarity;
  revealed: boolean;
  replayKey: number;
};

type ActivePackReveal = {
  id: string;
  rarity: RewardRarity;
  replayKey: number;
  rect: {
    height: number;
    width: number;
    x: number;
    y: number;
  };
  motion: {
    durationMs: number;
    scale: number;
    x: number;
    y: number;
  };
};

const HIGH_TIER_POOL: RewardRarity[] = ["epic", "mythic", "legendary", "ultra"];

function createPackCards(): PackCard[] {
  const highTier = HIGH_TIER_POOL[Math.floor(Math.random() * HIGH_TIER_POOL.length)];

  return [
    { id: "pack-card-1", rarity: "common", revealed: false, replayKey: 0 },
    { id: "pack-card-2", rarity: "uncommon", revealed: false, replayKey: 0 },
    { id: "pack-card-3", rarity: "superRare", revealed: false, replayKey: 0 },
    { id: "pack-card-4", rarity: highTier, revealed: false, replayKey: 0 }
  ];
}

export function RewardsPage() {
  return (
    <main className="reward-page">
      <div className="reward-page-inner">
        <RewardRevealDemo />
        <PackOpeningDemo />
      </div>
    </main>
  );
}

function PackOpeningDemo() {
  const initialCards = useMemo(() => createPackCards(), []);
  const revealSequence = useRef(0);
  const [activeReveal, setActiveReveal] = useState<ActivePackReveal | null>(null);
  const [cards, setCards] = useState<PackCard[]>(initialCards);
  const [opened, setOpened] = useState(false);
  const allRevealed = opened && cards.every((card) => card.revealed);

  const openPack = () => {
    setActiveReveal(null);
    setCards(createPackCards());
    setOpened(true);
  };

  const replayPack = () => {
    setActiveReveal(null);
    setOpened(false);
    setCards(createPackCards());
  };

  const revealCard = (id: string, element: HTMLElement) => {
    if (activeReveal) {
      return;
    }

    const cardToReveal = cards.find((card) => card.id === id);
    if (!cardToReveal || cardToReveal.revealed) {
      return;
    }

    const rect = element.getBoundingClientRect();
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    const config = RARITY_VFX[cardToReveal.rarity];
    const targetWidth = Math.min(window.innerWidth < 720 ? window.innerWidth * 0.62 : 320, Math.max(rect.width * 1.45, rect.width + 72));
    const scale = targetWidth / rect.width;

    revealSequence.current += 1;
    setActiveReveal({
      id,
      rarity: cardToReveal.rarity,
      replayKey: revealSequence.current,
      rect: {
        height: rect.height,
        width: rect.width,
        x: rect.x,
        y: rect.y
      },
      motion: {
        durationMs: Math.max(2300, config.duration * 1000 + 260),
        scale,
        x: window.innerWidth / 2 - centerX,
        y: window.innerHeight / 2 - centerY
      }
    });
  };
  const activeRevealAssets = activeReveal ? REWARD_CARD_ASSETS[activeReveal.rarity] : null;

  const completeReveal = (id: string, replayKey: number) => {
    setCards((currentCards) =>
      currentCards.map((card) =>
        card.id === id && !card.revealed ? { ...card, revealed: true, replayKey: card.replayKey + 1 } : card
      )
    );
    setActiveReveal((currentReveal) => (currentReveal?.replayKey === replayKey ? null : currentReveal));
  };

  return (
    <section className="reward-pack-section" aria-label="Pack opening">
      <div className="reward-pack-arena" data-opened={opened}>
        {!opened ? (
          <button className="reward-pack-box" onClick={openPack} type="button">
            <span className="reward-pack-box-core" />
            <span className="reward-pack-box-label">Open Pack</span>
          </button>
        ) : (
          <>
            <div className="reward-pack-grid" data-all-revealed={allRevealed}>
              {cards.map((card, index) => {
                const assets = REWARD_CARD_ASSETS[card.rarity];
                const config = RARITY_VFX[card.rarity];
                const isRevealing = activeReveal?.id === card.id;

                return (
                  <div
                    className="reward-pack-card"
                    data-rarity={card.rarity}
                    data-revealed={card.revealed}
                    data-revealing={isRevealing}
                    key={card.id}
                    style={{ "--rarity-color": config.colors.primary, "--card-index": index } as CSSProperties}
                  >
                    {isRevealing ? (
                      <div className="reward-pack-card-placeholder" />
                    ) : card.revealed ? (
                      <div className="reward-pack-card-image-shell">
                        <Image alt="" className="reward-pack-card-image" draggable={false} height={840} sizes="(max-width: 720px) 138px, 190px" src={assets.front} width={600} />
                      </div>
                    ) : (
                      <button className="reward-pack-card-back-button" onClick={(event) => revealCard(card.id, event.currentTarget)} type="button">
                        <Image alt="" className="reward-pack-card-image" draggable={false} height={840} sizes="(max-width: 720px) 138px, 190px" src={assets.back} width={600} />
                      </button>
                    )}
                    <span className="reward-pack-card-label">{isRevealing ? "" : card.revealed ? config.label : "Tap"}</span>
                  </div>
                );
              })}
            </div>
            {allRevealed ? (
              <button className="reward-pack-replay" onClick={replayPack} type="button">
                Replay Pack
              </button>
            ) : null}
            {activeReveal && activeRevealAssets ? (
              <div className="reward-pack-page-vfx" key={`${activeReveal.id}-${activeReveal.replayKey}`}>
                <div
                  aria-hidden="true"
                  className="reward-pack-flight-reveal-track"
                  onAnimationEnd={(event) => {
                    if (event.currentTarget === event.target) {
                      completeReveal(activeReveal.id, activeReveal.replayKey);
                    }
                  }}
                  style={
                    {
                      "--flight-duration": `${activeReveal.motion.durationMs}ms`,
                      "--flight-height": `${activeReveal.rect.height}px`,
                      "--flight-left": `${activeReveal.rect.x}px`,
                      "--flight-scale": activeReveal.motion.scale,
                      "--flight-top": `${activeReveal.rect.y}px`,
                      "--flight-width": `${activeReveal.rect.width}px`,
                      "--flight-x": `${activeReveal.motion.x}px`,
                      "--flight-y": `${activeReveal.motion.y}px`,
                      "--rarity-color": RARITY_VFX[activeReveal.rarity].colors.primary
                    } as CSSProperties
                  }
                >
                  <span className="reward-pack-flight-reveal-vfx">
                    <RewardReveal
                      autoplay
                      cardBackTextureUrl={activeRevealAssets.back}
                      cardTextureUrl={activeRevealAssets.front}
                      className="reward-pack-flight-reveal-canvas"
                      mode="single"
                      rarity={activeReveal.rarity}
                      replayKey={activeReveal.replayKey}
                    />
                  </span>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
