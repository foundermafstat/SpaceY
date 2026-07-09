import type { RarityVfxConfig, RewardRarity } from "./types";

export const RARITY_VFX: Record<RewardRarity, RarityVfxConfig> = {
  common: {
    label: "Common",
    duration: 1.75,
    echoes: 1,
    shards: 4,
    particles: 24,
    streaks: 5,
    bloom: 0.28,
    chromatic: 0.0002,
    flash: 0.12,
    shake: 0.03,
    prism: 0.02,
    portalScale: 0.72,
    cardScale: 0.92,
    doubleFlash: false,
    colors: {
      dark: "#101316",
      primary: "#aeb8c2",
      secondary: "#6f7882",
      tertiary: "#e3e8ed",
      flash: "#f5f7fa"
    }
  },
  uncommon: {
    label: "Uncommon",
    duration: 1.95,
    echoes: 2,
    shards: 7,
    particles: 46,
    streaks: 10,
    bloom: 0.42,
    chromatic: 0.00035,
    flash: 0.2,
    shake: 0.06,
    prism: 0.05,
    portalScale: 0.82,
    cardScale: 0.96,
    doubleFlash: false,
    colors: {
      dark: "#071a0e",
      primary: "#61ff88",
      secondary: "#1cad5c",
      tertiary: "#c5ffd2",
      flash: "#eaffef"
    }
  },
  superRare: {
    label: "Super Rare",
    duration: 2.25,
    echoes: 4,
    shards: 14,
    particles: 105,
    streaks: 22,
    bloom: 0.8,
    chromatic: 0.00095,
    flash: 0.5,
    shake: 0.18,
    prism: 0.12,
    portalScale: 1,
    cardScale: 1,
    doubleFlash: false,
    colors: {
      dark: "#061633",
      primary: "#1fd8ff",
      secondary: "#2773ff",
      tertiary: "#aaf7ff",
      flash: "#d8fdff"
    }
  },
  epic: {
    label: "Epic",
    duration: 2.5,
    echoes: 6,
    shards: 24,
    particles: 165,
    streaks: 32,
    bloom: 1.08,
    chromatic: 0.0018,
    flash: 0.66,
    shake: 0.28,
    prism: 0.28,
    portalScale: 1.1,
    cardScale: 1.03,
    doubleFlash: false,
    colors: {
      dark: "#21052e",
      primary: "#ff3fea",
      secondary: "#7d42ff",
      tertiary: "#ffadfb",
      flash: "#fff0ff"
    }
  },
  mythic: {
    label: "Mythic",
    duration: 2.72,
    echoes: 8,
    shards: 34,
    particles: 215,
    streaks: 42,
    bloom: 1.26,
    chromatic: 0.0023,
    flash: 0.78,
    shake: 0.42,
    prism: 0.35,
    portalScale: 1.18,
    cardScale: 1.06,
    doubleFlash: false,
    colors: {
      dark: "#30060c",
      primary: "#ff2b39",
      secondary: "#ff8f2f",
      tertiary: "#ffd3a1",
      flash: "#fff2de"
    }
  },
  legendary: {
    label: "Legendary",
    duration: 2.95,
    echoes: 10,
    shards: 46,
    particles: 300,
    streaks: 56,
    bloom: 1.52,
    chromatic: 0.0029,
    flash: 0.96,
    shake: 0.5,
    prism: 0.52,
    portalScale: 1.28,
    cardScale: 1.1,
    doubleFlash: false,
    colors: {
      dark: "#2b1700",
      primary: "#ffcf28",
      secondary: "#ff7a1f",
      tertiary: "#fff4a6",
      flash: "#fff9cc"
    }
  },
  ultra: {
    label: "Ultra",
    duration: 3.25,
    echoes: 13,
    shards: 68,
    particles: 420,
    streaks: 78,
    bloom: 1.88,
    chromatic: 0.0042,
    flash: 1,
    shake: 0.64,
    prism: 0.86,
    portalScale: 1.42,
    cardScale: 1.14,
    doubleFlash: true,
    colors: {
      dark: "#080923",
      primary: "#f8fbff",
      secondary: "#7df8ff",
      tertiary: "#ffdc4e",
      flash: "#ffffff"
    }
  }
};
