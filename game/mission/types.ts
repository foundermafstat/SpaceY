export type MissionId = "credit-sweep" | "cargo-escort" | "meteorite-drilling";

export type MissionRisk = "green" | "yellow" | "red";

export type MissionType = "salvage" | "escort" | "mining" | "intercept" | "defense";

export type MissionObjectiveType =
  | "destroy_all"
  | "survive_seconds"
  | "collect_scrap"
  | "protect_target"
  | "hold_position";

export interface MissionObjective {
  type: MissionObjectiveType;
  target: number;
  label: string;
}

export type MissionRewardBonusKind =
  | "common-panel-chance"
  | "rare-connector-chance";

export interface MissionRewardBonus {
  kind: MissionRewardBonusKind;
  label: string;
}

export interface MissionRewardPreview {
  credits: number;
  scrap: number;
  alloy?: number;
  dataShards?: number;
  bonuses: readonly MissionRewardBonus[];
}

export type WalletCurrency = "credits" | "scrap" | "alloy" | "dataShards";

export type PlayerWallet = Record<WalletCurrency, number>;

export type MissionRewardRarity = "common" | "uncommon" | "superRare";

export type MissionCurrencyRewardGrant = {
  id: string;
  kind: "currency";
  currency: WalletCurrency;
  amount: number;
  label: string;
};

export type MissionItemRewardGrant = {
  id: string;
  kind: "item";
  itemDefId: string;
  label: string;
  rarity: MissionRewardRarity;
};

export type MissionRewardGrant = MissionCurrencyRewardGrant | MissionItemRewardGrant;

export type MissionCapability =
  | "dps"
  | "shield"
  | "speed"
  | "acceleration"
  | "heatStability"
  | "cargoCapacity"
  | "miningPower"
  | "pointDefense";

export type MissionRecommendations = Partial<Record<MissionCapability, number>>;

export interface MissionHardRequirements {
  requiredTags?: readonly string[];
}

export interface MissionDef {
  id: MissionId;
  name: string;
  type: MissionType;
  risk: MissionRisk;
  briefing: string;
  durationSec: number;
  objective: MissionObjective;
  hardRequirements: MissionHardRequirements;
  recommendations: MissionRecommendations;
  hazards: readonly string[];
  enemyKinds: readonly string[];
  rewards: MissionRewardPreview;
}

export type MissionReadinessSeverity = "blocker" | "warning" | "hint";
export type MissionReadinessIssueKind = "hard-requirement" | "recommendation";

export interface MissionReadinessIssue {
  code: string;
  severity: MissionReadinessSeverity;
  kind: MissionReadinessIssueKind;
  label: string;
  message: string;
  tag?: string;
  capability?: MissionCapability;
  actual?: number;
  required?: number;
  suggestedChange?: string;
}

export type MissionCapabilitySnapshot = Record<MissionCapability, number>;

export interface MissionReadiness {
  score: number;
  canLaunch: boolean;
  blockers: MissionReadinessIssue[];
  warnings: MissionReadinessIssue[];
  hints: MissionReadinessIssue[];
  issues: MissionReadinessIssue[];
  recommendedChanges: string[];
  stats: MissionCapabilitySnapshot;
  installedTags: string[];
}
