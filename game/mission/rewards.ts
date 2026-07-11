import type { MissionResult } from "@/game/mission/runtime";
import type {
  MissionDef,
  MissionItemRewardGrant,
  MissionRewardGrant,
  PlayerWallet,
  WalletCurrency
} from "@/game/mission/types";

export const EMPTY_PLAYER_WALLET: PlayerWallet = {
  credits: 0,
  scrap: 0,
  alloy: 0,
  dataShards: 0
};

export function resolveMissionResultRewards(
  mission: MissionDef,
  result: MissionResult
): MissionResult {
  return {
    ...result,
    rewards: calculateMissionRewards(mission, result)
  };
}

export function applyMissionRewards(
  wallet: PlayerWallet,
  rewards: readonly MissionRewardGrant[]
): PlayerWallet {
  return rewards.reduce<PlayerWallet>((nextWallet, reward) => {
    if (reward.kind !== "currency") return nextWallet;
    return {
      ...nextWallet,
      [reward.currency]: nextWallet[reward.currency] + reward.amount
    };
  }, wallet);
}

export function normalizePlayerWallet(value: unknown, legacyScrap: unknown = 0): PlayerWallet {
  const wallet = isRecord(value) ? value : {};
  return {
    credits: parseAmount(wallet.credits) ?? 0,
    scrap: parseAmount(wallet.scrap) ?? parseAmount(legacyScrap) ?? 0,
    alloy: parseAmount(wallet.alloy) ?? 0,
    dataShards: parseAmount(wallet.dataShards) ?? 0
  };
}

function calculateMissionRewards(
  mission: MissionDef,
  result: MissionResult
): MissionRewardGrant[] {
  const rewards: MissionRewardGrant[] = [];
  const success = result.outcome === "victory";

  if (success) {
    rewards.push(currencyGrant(result.attemptId, "credits", mission.rewards.credits, "Contract credits"));
  }

  const recoveredScrap = success ? mission.rewards.scrap : 0;
  if (recoveredScrap > 0) {
    rewards.push(currencyGrant(result.attemptId, "scrap", recoveredScrap, "Recovered scrap"));
  }

  if (success && mission.rewards.alloy) {
    rewards.push(currencyGrant(result.attemptId, "alloy", mission.rewards.alloy, "Refined alloy"));
  }
  if (success && mission.rewards.dataShards) {
    rewards.push(currencyGrant(result.attemptId, "dataShards", mission.rewards.dataShards, "Contract data"));
  }

  const itemReward = success && result.detachedPartIds.length === 0
    ? getPerformanceItemReward(mission, result.attemptId)
    : null;
  if (itemReward) rewards.push(itemReward);

  return rewards;
}

function currencyGrant(
  attemptId: string,
  currency: WalletCurrency,
  amount: number,
  label: string
): MissionRewardGrant {
  return {
    id: `${attemptId}:${currency}`,
    kind: "currency",
    currency,
    amount,
    label
  };
}

function getPerformanceItemReward(
  mission: MissionDef,
  attemptId: string
): MissionItemRewardGrant | null {
  const bonusKinds = new Set(mission.rewards.bonuses.map((bonus) => bonus.kind));
  if (bonusKinds.has("rare-connector-chance") && rewardRoll(attemptId, "rare-connector") < 0.18) {
    return {
      id: `${attemptId}:flux-connector`,
      kind: "item",
      itemDefId: "flux_connector",
      label: "Flux Connector",
      rarity: "uncommon"
    };
  }
  if (bonusKinds.has("common-panel-chance") && rewardRoll(attemptId, "common-panel") < 0.35) {
    return {
      id: `${attemptId}:reinforced-panel`,
      kind: "item",
      itemDefId: "reinforced_panel",
      label: "Reinforced Grid Panel",
      rarity: "common"
    };
  }
  return null;
}

function rewardRoll(attemptId: string, salt: string) {
  let hash = 2166136261;
  const input = `${attemptId}:${salt}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0x1_0000_0000;
}

function parseAmount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
