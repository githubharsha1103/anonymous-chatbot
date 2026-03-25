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

    // NOTE: We intentionally do NOT check isBroadcasting here
    // Users must always be able to exit a chat, even during broadcast
    // to prevent getting stuck in active conversations

    if (bot.isRateLimited(id)) {
      return ctx.reply("⏳ Please wait a moment before trying again.");
    }

    // Check for duplicate request
    if (bot.hasPendingLockRequest(id)) {
      return ctx.reply("⏳ Your request is already being processed. Please wait.");
    }

    // Use safe lock wrapper
    const lockResult = await bot.withChatStateLockSafe(
      async () => {
        console.log("[END] User requested end:", id);
        
        if (!bot.runningChats.has(id)) {
          if (await bot.removeFromQueue(id)) {
            return ctx.reply("🔍 Search cancelled. Use /search when you want to find a partner again.");
          }
          return ctx.reply("⚠️ You are not in a chat. Use /search to find a partner!");
        }

        const partner = bot.getPartner(id);
        console.log("[END] Partner found:", partner);
        
        const user = await getUser(id);
        const chatStartTime = user.chatStartTime;
        const durationText = formatDuration(chatStartTime ? Date.now() - chatStartTime : 0);
        const messageCount = bot.messageCountMap.get(id) || 0;

        // clearChatRuntime already handles mutex locking internally
        await clearChatRuntime(bot, id, partner);
        console.log("[END] Chat successfully removed");

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
      },
      id,
      "⚠️ Server busy, please try again in a few seconds"
    );

    if (!lockResult.success) {
      console.error("[END] Lock failed for user", id, lockResult.error);
      return ctx.reply(lockResult.error);
    }

    return lockResult.result;
  }
};
