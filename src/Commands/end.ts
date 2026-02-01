import { Context, Markup } from "telegraf";
import { ExtraTelegraf } from "..";
import { safeSendMessage } from "../Utils/telegramErrorHandler";
import { updateUser } from "../storage/db";

export default {
  name: "end",
  execute: async (ctx: Context, bot: ExtraTelegraf) => {

    const id = ctx.from?.id as number;

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
        updateUser(id, { reportingPartner: partner });
        updateUser(partner, { reportingPartner: id });
    }

    // Report keyboard
    const reportKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback("🚨 Report User", "OPEN_REPORT")]
    ]);

    // Use safeSendMessage to handle blocked partners
    await safeSendMessage(
      bot,
      partner,
      "🚫 Partner left the chat\n\n/next - Find new partner\n\n━━━━━━━━━━━━━━━━━\nTo report this chat:",
      reportKeyboard
    );

    return ctx.reply(
      "🚫 Partner left the chat\n\n/next - Find new partner\n\n━━━━━━━━━━━━━━━━━\nTo report this chat:",
      reportKeyboard
    );
  }
};
