export const UPDATE_DEDUPLICATOR = Symbol("spacey.telegram-update-deduplicator");
export const REFERRAL_PORT = Symbol("spacey.telegram-referral-port");
export const SUPPORT_PORT = Symbol("spacey.telegram-support-port");
export const NOTIFICATION_PORT = Symbol("spacey.telegram-notification-port");
export const TELEGRAM_RESPONDER = Symbol("spacey.telegram-responder");
export const DATABASE_READINESS = Symbol("spacey.telegram-database-readiness");
export const TELEGRAM_READINESS = Symbol("spacey.telegram-api-readiness");

export interface UpdateDeduplicator {
  claim(updateId: number): Promise<"claimed" | "duplicate" | "busy">;
  complete(updateId: number): Promise<void>;
  release(updateId: number): Promise<void>;
}

export interface ReferralPort {
  recordReferral(input: { telegramUserId: number; referralCode: string; updateId: number }): Promise<void>;
}

export interface SupportPort {
  openRequest(input: { telegramUserId: number; chatId: number; updateId: number }): Promise<void>;
  routeMessage(input: { telegramUserId: number; chatId: number; text: string; updateId: number }): Promise<boolean>;
}

export interface NotificationPort {
  setPreference(input: { telegramUserId: number; enabled: boolean; updateId: number }): Promise<void>;
}

export interface TelegramResponder {
  sendMessage(chatId: number, text: string, options?: Readonly<{ launchMiniApp?: boolean }>): Promise<void>;
  answerPreCheckout(queryId: string, ok: boolean, errorMessage?: string): Promise<void>;
}

export interface DependencyReadiness {
  check(): Promise<void>;
}
