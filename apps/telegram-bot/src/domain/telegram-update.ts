export type TelegramUser = Readonly<{
  id: number;
  username?: string;
}>;

export type TelegramMessage = Readonly<{
  message_id: number;
  chat: Readonly<{ id: number }>;
  from?: TelegramUser;
  text?: string;
  successful_payment?: Readonly<{
    currency: string;
    total_amount: number;
    telegram_payment_charge_id: string;
  }>;
}>;

export type TelegramUpdate = Readonly<{
  update_id: number;
  message?: TelegramMessage;
  pre_checkout_query?: Readonly<{
    id: string;
    from: TelegramUser;
    currency: string;
    total_amount: number;
    invoice_payload: string;
  }>;
}>;

function record(input: unknown, name: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError(`${name} must be an object`);
  return input as Record<string, unknown>;
}

function safeInteger(input: unknown, name: string, minimum = Number.MIN_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(input) || (input as number) < minimum) throw new TypeError(`${name} is invalid`);
  return input as number;
}

function boundedString(input: unknown, name: string, maximum: number, allowEmpty = false): string {
  if (typeof input !== "string" || (!allowEmpty && input.length === 0) || input.length > maximum) {
    throw new TypeError(`${name} is invalid`);
  }
  return input;
}

function parseUser(input: unknown): TelegramUser {
  const user = record(input, "Telegram user");
  return {
    id: safeInteger(user.id, "Telegram user id", 1),
    ...(user.username === undefined ? {} : { username: boundedString(user.username, "Telegram username", 64) }),
  };
}

function parseMessage(input: unknown): TelegramMessage {
  const message = record(input, "Telegram message");
  const chat = record(message.chat, "Telegram chat");
  const payment = message.successful_payment === undefined ? undefined : record(message.successful_payment, "Successful payment");
  return {
    message_id: safeInteger(message.message_id, "Telegram message id", 0),
    chat: { id: safeInteger(chat.id, "Telegram chat id") },
    ...(message.from === undefined ? {} : { from: parseUser(message.from) }),
    ...(message.text === undefined ? {} : { text: boundedString(message.text, "Telegram message text", 4_096) }),
    ...(payment === undefined ? {} : {
      successful_payment: {
        currency: boundedString(payment.currency, "Payment currency", 16),
        total_amount: safeInteger(payment.total_amount, "Payment amount", 1),
        telegram_payment_charge_id: boundedString(payment.telegram_payment_charge_id, "Telegram payment charge id", 256),
      },
    }),
  };
}

export function parseTelegramUpdate(input: unknown): TelegramUpdate {
  const update = record(input, "Telegram update");
  const preCheckout = update.pre_checkout_query === undefined
    ? undefined
    : record(update.pre_checkout_query, "Pre-checkout query");
  return {
    update_id: safeInteger(update.update_id, "Telegram update id", 0),
    ...(update.message === undefined ? {} : { message: parseMessage(update.message) }),
    ...(preCheckout === undefined ? {} : {
      pre_checkout_query: {
        id: boundedString(preCheckout.id, "Pre-checkout query id", 256),
        from: parseUser(preCheckout.from),
        currency: boundedString(preCheckout.currency, "Pre-checkout currency", 16),
        total_amount: safeInteger(preCheckout.total_amount, "Pre-checkout amount", 1),
        invoice_payload: boundedString(preCheckout.invoice_payload, "Invoice payload", 128, true),
      },
    }),
  };
}
