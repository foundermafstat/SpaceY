import { createHash } from "node:crypto";

export type CurrencyReward = {
  currency: "CREDITS" | "SCRAP" | "ALLOY" | "DATA_SHARDS";
  amount: number;
};

export type ParsedMissionRewards = {
  currencies: CurrencyReward[];
  experience: number;
  items: ItemRewardDefinition[];
};

export type ItemRewardDefinition = {
  definitionKey: string;
  chanceBasisPoints: number;
  rarity: string | null;
};

export type ResolvedItemReward = ItemRewardDefinition & {
  rewardIndex: number;
};

const CURRENCY_MAP = {
  credits: "CREDITS",
  scrap: "SCRAP",
  alloy: "ALLOY",
  dataShards: "DATA_SHARDS"
} as const;

export function parseMissionRewards(definition: unknown, dropTableEntries?: unknown): ParsedMissionRewards {
  if (!isRecord(definition)) throw new Error("Mission reward definition must be an object.");
  if (typeof definition.dropTableKey === "string") {
    return parseDropTableRewards(dropTableEntries);
  }
  const items = parseItemRewards(definition.items);
  const currencySource = isRecord(definition.currencies) ? definition.currencies : definition;
  const allowedCurrencyKeys = new Set(Object.keys(CURRENCY_MAP));
  for (const key of Object.keys(currencySource)) {
    if (!allowedCurrencyKeys.has(key)
      && (currencySource !== definition || (key !== "experience" && key !== "items"))) {
      throw new Error(`Mission reward currency ${key} is not supported.`);
    }
  }
  const currencies: CurrencyReward[] = [];
  for (const [key, databaseCurrency] of Object.entries(CURRENCY_MAP)) {
    const rawAmount = currencySource[key];
    if (rawAmount === undefined) continue;
    if (!Number.isSafeInteger(rawAmount) || (rawAmount as number) < 0 || (rawAmount as number) > 1_000_000_000) {
      throw new Error(`Mission reward ${key} must be a bounded non-negative integer.`);
    }
    if ((rawAmount as number) > 0) currencies.push({ currency: databaseCurrency, amount: rawAmount as number });
  }
  const experience = definition.experience ?? 0;
  if (!Number.isSafeInteger(experience) || (experience as number) < 0 || (experience as number) > 1_000_000_000) {
    throw new Error("Mission experience reward must be a bounded non-negative integer.");
  }
  return { currencies, experience: experience as number, items };
}

function parseDropTableRewards(value: unknown): ParsedMissionRewards {
  if (!Array.isArray(value) || value.length > 128) {
    throw new Error("Mission drop table must contain at most 128 entries.");
  }
  const currencyTotals = { credits: 0, scrap: 0, alloy: 0, dataShards: 0 };
  const items: ItemRewardDefinition[] = [];
  let experience = 0;
  for (const [index, rawEntry] of value.entries()) {
    if (!isRecord(rawEntry) || typeof rawEntry.kind !== "string") {
      throw new Error(`Mission drop table entry ${index} is invalid.`);
    }
    if (rawEntry.kind === "currency") {
      const key = Object.entries(CURRENCY_MAP).find(([, database]) => database === rawEntry.currency)?.[0];
      if (!key || !Number.isSafeInteger(rawEntry.amount) || Number(rawEntry.amount) <= 0 || Number(rawEntry.amount) > 1_000_000_000) {
        throw new Error(`Mission currency drop at index ${index} is invalid.`);
      }
      currencyTotals[key as keyof typeof currencyTotals] += Number(rawEntry.amount);
    } else if (rawEntry.kind === "experience") {
      if (!Number.isSafeInteger(rawEntry.amount) || Number(rawEntry.amount) <= 0 || Number(rawEntry.amount) > 1_000_000_000) {
        throw new Error(`Mission experience drop at index ${index} is invalid.`);
      }
      experience += Number(rawEntry.amount);
    } else if (rawEntry.kind === "item") {
      if (
        typeof rawEntry.definitionKey !== "string" ||
        !/^[a-zA-Z0-9._-]{1,128}$/.test(rawEntry.definitionKey) ||
        !Number.isSafeInteger(rawEntry.chanceBps) ||
        Number(rawEntry.chanceBps) < 0 ||
        Number(rawEntry.chanceBps) > 10_000 ||
        (rawEntry.rarity !== undefined && typeof rawEntry.rarity !== "string")
      ) throw new Error(`Mission item drop at index ${index} is invalid.`);
      items.push({
        definitionKey: rawEntry.definitionKey,
        chanceBasisPoints: Number(rawEntry.chanceBps),
        rarity: typeof rawEntry.rarity === "string" ? rawEntry.rarity : null
      });
    } else {
      throw new Error(`Mission drop kind ${rawEntry.kind} is not supported.`);
    }
  }
  return {
    currencies: Object.entries(currencyTotals).flatMap(([key, amount]) => amount > 0
      ? [{ currency: CURRENCY_MAP[key as keyof typeof CURRENCY_MAP], amount }]
      : []),
    experience,
    items
  };
}

export function resolveItemRewards(
  attemptId: string,
  definitions: ItemRewardDefinition[]
): ResolvedItemReward[] {
  return definitions.flatMap((definition, rewardIndex) => {
    const digest = createHash("sha256")
      .update(`${attemptId}:${rewardIndex}:${definition.definitionKey}`)
      .digest();
    const roll = digest.readUInt32BE(0) % 10_000;
    return roll < definition.chanceBasisPoints
      ? [{ ...definition, rewardIndex }]
      : [];
  });
}

function parseItemRewards(value: unknown): ItemRewardDefinition[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 32) {
    throw new Error("Mission item rewards must be an array with at most 32 entries.");
  }
  return value.map((item, index) => {
    if (!isRecord(item)
      || typeof item.definitionKey !== "string"
      || !/^[a-zA-Z0-9._-]{1,128}$/.test(item.definitionKey)
      || !Number.isSafeInteger(item.chanceBasisPoints)
      || (item.chanceBasisPoints as number) < 0
      || (item.chanceBasisPoints as number) > 10_000
      || (item.rarity !== undefined && typeof item.rarity !== "string")) {
      throw new Error(`Mission item reward at index ${index} is invalid.`);
    }
    return {
      definitionKey: item.definitionKey,
      chanceBasisPoints: item.chanceBasisPoints as number,
      rarity: typeof item.rarity === "string" ? item.rarity : null
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
