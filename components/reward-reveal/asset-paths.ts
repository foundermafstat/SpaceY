import type { RewardRarity } from "./types";

export const REWARD_CARD_ASSETS: Record<RewardRarity, { front: string; back: string }> = {
  common: {
    front: "/reward-assets/cards/common-front.png",
    back: "/reward-assets/cards/common-back.png"
  },
  uncommon: {
    front: "/reward-assets/cards/uncommon-front.png",
    back: "/reward-assets/cards/uncommon-back.png"
  },
  superRare: {
    front: "/reward-assets/cards/superRare-front.png",
    back: "/reward-assets/cards/superRare-back.png"
  },
  epic: {
    front: "/reward-assets/cards/epic-front.png",
    back: "/reward-assets/cards/epic-back.png"
  },
  mythic: {
    front: "/reward-assets/cards/mythic-front.png",
    back: "/reward-assets/cards/mythic-back.png"
  },
  legendary: {
    front: "/reward-assets/cards/legendary-front.png",
    back: "/reward-assets/cards/legendary-back.png"
  },
  ultra: {
    front: "/reward-assets/cards/ultra-front.png",
    back: "/reward-assets/cards/ultra-back.png"
  }
};

export const REWARD_VFX_ASSETS: Record<RewardRarity, { ring: string; sparks: string; burst: string }> = {
  common: {
    ring: "/reward-assets/vfx/common-ring-sheet.png",
    sparks: "/reward-assets/vfx/common-sparks-sheet.png",
    burst: "/reward-assets/vfx/common-burst-sheet.png"
  },
  uncommon: {
    ring: "/reward-assets/vfx/uncommon-ring-sheet.png",
    sparks: "/reward-assets/vfx/uncommon-sparks-sheet.png",
    burst: "/reward-assets/vfx/uncommon-burst-sheet.png"
  },
  superRare: {
    ring: "/reward-assets/vfx/superRare-ring-sheet.png",
    sparks: "/reward-assets/vfx/superRare-sparks-sheet.png",
    burst: "/reward-assets/vfx/superRare-burst-sheet.png"
  },
  epic: {
    ring: "/reward-assets/vfx/epic-ring-sheet.png",
    sparks: "/reward-assets/vfx/epic-sparks-sheet.png",
    burst: "/reward-assets/vfx/epic-burst-sheet.png"
  },
  mythic: {
    ring: "/reward-assets/vfx/mythic-ring-sheet.png",
    sparks: "/reward-assets/vfx/mythic-sparks-sheet.png",
    burst: "/reward-assets/vfx/mythic-burst-sheet.png"
  },
  legendary: {
    ring: "/reward-assets/vfx/legendary-ring-sheet.png",
    sparks: "/reward-assets/vfx/legendary-sparks-sheet.png",
    burst: "/reward-assets/vfx/legendary-burst-sheet.png"
  },
  ultra: {
    ring: "/reward-assets/vfx/ultra-ring-sheet.png",
    sparks: "/reward-assets/vfx/ultra-sparks-sheet.png",
    burst: "/reward-assets/vfx/ultra-burst-sheet.png"
  }
};
