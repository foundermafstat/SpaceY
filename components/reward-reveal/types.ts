export const REWARD_RARITIES = ["common", "uncommon", "superRare", "epic", "mythic", "legendary", "ultra"] as const;

export type RewardRarity = (typeof REWARD_RARITIES)[number];
export type RewardRevealMode = "single" | "packCard";

export type RewardRevealProps = {
  rarity: RewardRarity;
  cardTextureUrl: string;
  cardBackTextureUrl: string;
  mode?: RewardRevealMode;
  showCard?: boolean;
  dpr?: [number, number];
  autoplay?: boolean;
  className?: string;
  replayKey?: number;
  onComplete?: () => void;
};

export type RarityVfxConfig = {
  label: string;
  duration: number;
  echoes: number;
  shards: number;
  particles: number;
  streaks: number;
  bloom: number;
  chromatic: number;
  flash: number;
  shake: number;
  prism: number;
  portalScale: number;
  cardScale: number;
  doubleFlash: boolean;
  colors: {
    dark: string;
    primary: string;
    secondary: string;
    tertiary: string;
    flash: string;
  };
};
