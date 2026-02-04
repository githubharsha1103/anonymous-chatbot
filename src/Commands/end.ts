import { Context, Markup } from "telegraf";
import { ExtraTelegraf } from "..";
import { sendMessageWithRetry, cleanupBlockedUser } from "../Utils/telegramErrorHandler";
import { updateUser } from "../storage/db";

export default {
  name: "end",
  execute: async (ctx: Context, bot: ExtraTelegraf) => {

    const id = ctx.from?.id as number;

    // Check rate limit
    if (bot.isRateLimited(id)) {
      return ctx.reply("⏳ Please wait a few seconds before trying again.");
    }

    // Acquire mutex to prevent race conditions
    await bot.chatMutex.acquire();

    try {
      if (!bot.runningChats.includes(id)) {
        return ctx.reply("You are not in a chat.");
      }

      const partner = bot.getPartner(id);

      bot.runningChats = bot.runningChats.filter(
        u => u !== id && u !== partner
      );

      bot.messageMap.delete(id);
      bot.messageMap.delete(partner);

      // Store partner ID for potential report
      if (partner) {
          await updateUser(id, { reportingPartner: partner });
          await updateUser(partner, { reportingPartner: id });
      }

      // Report keyboard
      const reportKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback("🚨 Report User", "OPEN_REPORT")]
      ]);

      // Use sendMessageWithRetry to handle blocked partners
      const notifySent = await sendMessageWithRetry(
        bot,
        partner,
        "🚫 Partner left the chat\n\n/next - Find new partner\n\n━━━━━━━━━━━━━━━━━\nTo report this chat:",
        reportKeyboard
      );

      // If message failed to send, still clean up
      if (!notifySent && partner) {
        cleanupBlockedUser(bot, partner);
      }

      return ctx.reply(
        "🚫 Partner left the chat\n\n/next - Find new partner\n\n━━━━━━━━━━━━━━━━━\nTo report this chat:",
        reportKeyboard
      );
    } finally {
      bot.chatMutex.release();
    }
  }
};
