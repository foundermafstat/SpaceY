import type { TelegramUpdate } from "../domain/telegram-update.js";
import type { NotificationPort, ReferralPort, SupportPort, TelegramResponder } from "./ports.js";

export type UpdateRoute = "referral" | "support" | "notification" | "help" | "stars-disabled" | "payment-observed" | "ignored";

export type UpdateRouterDependencies = Readonly<{
  referrals: ReferralPort;
  support: SupportPort;
  notifications: NotificationPort;
  responder: TelegramResponder;
  starsEnabled: boolean;
}>;

const REFERRAL_CODE = /^[A-Za-z0-9_-]{1,64}$/;

export class UpdateRouter {
  constructor(private readonly dependencies: UpdateRouterDependencies) {}

  async route(update: TelegramUpdate): Promise<UpdateRoute> {
    if (update.pre_checkout_query) {
      if (!this.dependencies.starsEnabled) {
        await this.dependencies.responder.answerPreCheckout(update.pre_checkout_query.id, false, "Payments are not available yet");
        return "stars-disabled";
      }
      return "payment-observed";
    }

    const message = update.message;
    if (!message?.from) return "ignored";
    if (message.successful_payment) return this.dependencies.starsEnabled ? "payment-observed" : "stars-disabled";

    const text = message.text?.trim();
    if (!text) return "ignored";
    const [rawCommand, argument] = text.split(/\s+/, 2);
    const command = rawCommand?.split("@", 1)[0]?.toLowerCase();

    if (command === "/start") {
      if (argument && REFERRAL_CODE.test(argument)) {
        await this.dependencies.referrals.recordReferral({ telegramUserId: message.from.id, referralCode: argument, updateId: update.update_id });
      }
      await this.dependencies.responder.sendMessage(
        message.chat.id,
        "SpaceY flight systems are ready. Open the Mini App to continue.",
        { launchMiniApp: true },
      );
      return "referral";
    }

    if (command === "/support") {
      await this.dependencies.support.openRequest({ telegramUserId: message.from.id, chatId: message.chat.id, updateId: update.update_id });
      await this.dependencies.responder.sendMessage(message.chat.id, "Support request opened. Send your message in this chat.");
      return "support";
    }

    if (command === "/notifications_on" || command === "/notifications_off") {
      await this.dependencies.notifications.setPreference({
        telegramUserId: message.from.id,
        enabled: command === "/notifications_on",
        updateId: update.update_id,
      });
      await this.dependencies.responder.sendMessage(
        message.chat.id,
        command === "/notifications_on" ? "SpaceY notifications enabled." : "SpaceY notifications disabled.",
      );
      return "notification";
    }

    if (command === "/help") {
      await this.dependencies.responder.sendMessage(
        message.chat.id,
        "Commands: /start, /support, /notifications_on, /notifications_off.",
      );
      return "help";
    }

    const routed = await this.dependencies.support.routeMessage({
      telegramUserId: message.from.id,
      chatId: message.chat.id,
      text,
      updateId: update.update_id,
    });
    if (routed) await this.dependencies.responder.sendMessage(message.chat.id, "Message sent to support.");
    return routed ? "support" : "ignored";
  }
}
