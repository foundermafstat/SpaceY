const FINALIZATION_RETRY_BASE_MS = 1_000;
const FINALIZATION_RETRY_MAX_MS = 60_000;

export function finalizationRetryDelayMs(failedAttempts: number): number {
  const exponent = Math.max(0, Math.min(16, failedAttempts - 1));
  return Math.min(FINALIZATION_RETRY_MAX_MS, FINALIZATION_RETRY_BASE_MS * 2 ** exponent);
}
