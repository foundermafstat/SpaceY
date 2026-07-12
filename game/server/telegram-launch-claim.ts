export const TELEGRAM_LAUNCH_CLAIM_STORAGE_KEY = "spacey.telegramLaunchClaim.v1";

export type TelegramLaunchClaim = {
  fingerprint: string;
  telegramUserId: string;
};

type SessionStorage = Pick<Storage, "getItem" | "setItem">;

export async function fingerprintTelegramInitData(initData: string): Promise<string> {
  const bytes = new TextEncoder().encode(initData);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function telegramUserIdFromInitData(initData: string): string | null {
  const encodedUser = new URLSearchParams(initData).get("user");
  if (!encodedUser) return null;
  try {
    const user = JSON.parse(encodedUser) as unknown;
    if (!isRecord(user)) return null;
    const id = user.id;
    if (typeof id === "string" && /^\d{1,20}$/.test(id)) return id;
    if (typeof id === "number" && Number.isSafeInteger(id) && id > 0) return String(id);
    return null;
  } catch {
    return null;
  }
}

export function readTelegramLaunchClaim(
  storage: SessionStorage,
  fingerprint: string,
): TelegramLaunchClaim | null {
  const raw = storage.getItem(TELEGRAM_LAUNCH_CLAIM_STORAGE_KEY);
  if (!raw) return null;
  try {
    const claim = JSON.parse(raw) as unknown;
    if (!isRecord(claim)
      || claim.fingerprint !== fingerprint
      || typeof claim.telegramUserId !== "string"
      || !/^\d{1,20}$/.test(claim.telegramUserId)) {
      return null;
    }
    return { fingerprint, telegramUserId: claim.telegramUserId };
  } catch {
    return null;
  }
}

export function writeTelegramLaunchClaim(storage: SessionStorage, claim: TelegramLaunchClaim): void {
  storage.setItem(TELEGRAM_LAUNCH_CLAIM_STORAGE_KEY, JSON.stringify(claim));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
