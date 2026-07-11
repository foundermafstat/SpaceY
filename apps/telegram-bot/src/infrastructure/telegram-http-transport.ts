import type { DependencyReadiness, TelegramResponder } from "../application/ports.js";
import type { TelegramBotConfig } from "../config.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type TelegramApiEnvelope = Readonly<{
  ok?: unknown;
  result?: unknown;
  error_code?: unknown;
  parameters?: Readonly<{ retry_after?: unknown }>;
}>;

export class TelegramApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly telegramErrorCode?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "TelegramApiError";
  }
}

export class TelegramHttpTransport implements TelegramResponder, DependencyReadiness {
  constructor(
    private readonly config: Pick<TelegramBotConfig, "apiBaseUrl" | "botToken" | "miniAppUrl" | "requestTimeoutMs">,
    private readonly fetchImplementation: FetchLike = fetch,
  ) {}

  async sendMessage(chatId: number, text: string, options?: Readonly<{ launchMiniApp?: boolean }>): Promise<void> {
    if (!Number.isSafeInteger(chatId)) throw new TypeError("Telegram chat id is invalid");
    if (text.length < 1 || text.length > 4_096) throw new TypeError("Telegram message length is invalid");

    const replyMarkup = options?.launchMiniApp
      ? { inline_keyboard: [[{ text: "Open SpaceY", web_app: { url: this.config.miniAppUrl } }]] }
      : undefined;
    await this.call("sendMessage", {
      chat_id: chatId,
      text,
      link_preview_options: { is_disabled: true },
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  }

  async answerPreCheckout(queryId: string, ok: boolean, errorMessage?: string): Promise<void> {
    if (!queryId || queryId.length > 256) throw new TypeError("Pre-checkout query id is invalid");
    if (!ok && (!errorMessage || errorMessage.length > 200)) throw new TypeError("A safe pre-checkout error message is required");
    await this.call("answerPreCheckoutQuery", {
      pre_checkout_query_id: queryId,
      ok,
      ...(!ok ? { error_message: errorMessage } : {}),
    });
  }

  async check(): Promise<void> {
    const result = await this.call("getMe", {});
    if (!result || typeof result !== "object" || (result as { is_bot?: unknown }).is_bot !== true) {
      throw new TelegramApiError("Telegram API returned an invalid bot identity");
    }
  }

  private async call(method: "sendMessage" | "answerPreCheckoutQuery" | "getMe", payload: Record<string, unknown>): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.config.apiBaseUrl}/bot${this.config.botToken}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        redirect: "error",
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });
    } catch {
      throw new TelegramApiError("Telegram API request failed");
    }

    let bodyText: string;
    try {
      bodyText = await response.text();
    } catch {
      throw new TelegramApiError("Telegram API response could not be read", response.status);
    }
    if (bodyText.length > 65_536) throw new TelegramApiError("Telegram API response was too large", response.status);

    let envelope: TelegramApiEnvelope;
    try {
      envelope = JSON.parse(bodyText) as TelegramApiEnvelope;
    } catch {
      throw new TelegramApiError("Telegram API returned invalid JSON", response.status);
    }

    if (!response.ok || envelope.ok !== true) {
      const errorCode = Number.isInteger(envelope.error_code) ? envelope.error_code as number : undefined;
      const retryAfter = Number.isInteger(envelope.parameters?.retry_after)
        ? envelope.parameters?.retry_after as number
        : undefined;
      throw new TelegramApiError("Telegram API rejected the request", response.status, errorCode, retryAfter);
    }
    return envelope.result;
  }
}
