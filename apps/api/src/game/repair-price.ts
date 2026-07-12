const MAX_DURABILITY_BPS = 10_000;

export function fullRepairCost(fullRepairCost: number, durabilityBps: number): number {
  if (!Number.isSafeInteger(fullRepairCost) || fullRepairCost <= 0) {
    throw new Error("Full repair content cost must be a positive integer.");
  }
  if (!Number.isSafeInteger(durabilityBps) || durabilityBps <= 0 || durabilityBps >= MAX_DURABILITY_BPS) {
    throw new Error("Repairable durability must be between 1 and 9999 basis points.");
  }
  const numerator = BigInt(fullRepairCost) * BigInt(MAX_DURABILITY_BPS - durabilityBps);
  const roundedUp = (numerator + BigInt(MAX_DURABILITY_BPS - 1)) / BigInt(MAX_DURABILITY_BPS);
  return Math.max(1, Number(roundedUp));
}
