import { Context } from "telegraf";
import { ExtraTelegraf } from "..";
import { cleanupBlockedUser, sendMessageWithRetry } from "../Utils/telegramErrorHandler";
import { updateUser, getUser, incUserTotalChats } from "../storage/db";
import {
  buildPartnerLeftMessage,
  buildSelfEndedMessage,
  clearChatRuntime,
  exitChatKeyboard
} from "../Utils/chatFlow";

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes} min${minutes > 1 ? "s" : ""}`;
  }
  return `${seconds}s`;
}

export default {
  name: "end",
  execute: async (ctx: Context, bot: ExtraTelegraf) => {
    const id = ctx.from?.id as number;

    if (bot.isRateLimited(id)) {
      return ctx.reply("⏳ Please wait a moment before trying again.");
    }

    try {
      return await bot.withChatStateLock(async () => {
        if (!bot.runningChats.has(id)) {
          if (await bot.removeFromQueue(id)) {
            return ctx.reply("🔍 Search cancelled. Use /search when you want to find a partner again.");
          }
          return ctx.reply("⚠️ You are not in a chat. Use /search to find a partner!");
        }

        const partner = bot.getPartner(id);
        const user = await getUser(id);
        const chatStartTime = user.chatStartTime;
        const durationText = formatDuration(chatStartTime ? Date.now() - chatStartTime : 0);
        const messageCount = bot.messageCountMap.get(id) || 0;

        await clearChatRuntime(bot, id, partner);

        if (partner) {
          await updateUser(id, { reportingPartner: partner, chatStartTime: null });
          await updateUser(partner, { reportingPartner: id, chatStartTime: null });
          await incUserTotalChats(id);
          await incUserTotalChats(partner);
        } else {
          await updateUser(id, { chatStartTime: null });
        }

        const notifySent = partner
          ? await sendMessageWithRetry(bot, partner, buildPartnerLeftMessage(durationText, messageCount), exitChatKeyboard)
          : false;

        if (!notifySent && partner) {
          await cleanupBlockedUser(bot, partner);
        }

        return ctx.reply(buildSelfEndedMessage(durationText, messageCount), {
          parse_mode: "HTML",
          ...exitChatKeyboard
        });
      });
    } catch (error) {
      console.error("[End command] End flow failed:", error);
      return ctx.reply("⚠️ Server is busy. Please try again in a moment.");
    }
  }
};
