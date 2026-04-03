import { Context } from "telegraf";
import { ExtraTelegraf } from "..";
import { cleanupBlockedUser, sendMessageWithRetry } from "../Utils/telegramErrorHandler";
import { updateUser, getUser, incUserTotalChats, recordChatAnalytics } from "../storage/db";
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

type EndLockResult =
  | { type: "search_cancelled" }
  | { type: "not_in_chat" }
  | { type: "ended"; partner: number | null; messageCount: number };

export default {
  name: "end",
  execute: async (ctx: Context, bot: ExtraTelegraf) => {
    const id = ctx.from?.id as number;

    if (bot.isRateLimited(id)) {
      return ctx.reply("Please wait a moment before trying again.");
    }

    if (bot.hasPendingLockRequest(id)) {
      return ctx.reply("Your request is already being processed. Please wait.");
    }

    const lockResult = await bot.withChatStateLockSafe(
      async (): Promise<EndLockResult> => {
        if (!bot.runningChats.has(id)) {
          if (await bot.removeFromQueue(id)) {
            return { type: "search_cancelled" };
          }
          return { type: "not_in_chat" };
        }

        const partner = bot.getPartner(id);
        const messageCount = bot.messageCountMap.get(id) || 0;
        await clearChatRuntime(bot, id, partner);

        return { type: "ended", partner, messageCount };
      },
      id,
      "Server busy, please try again in a few seconds"
    );

    if (!lockResult.success) {
      console.error("[END] Lock failed for user", id, lockResult.error);
      return ctx.reply(lockResult.error);
    }

    const result = lockResult.result;

    if (result.type === "search_cancelled") {
      await updateUser(id, { queueStatus: "removed", queueJoinedAt: null });
      return ctx.reply("Search cancelled. Use /search when you want to find a partner again.");
    }

    if (result.type === "not_in_chat") {
      return ctx.reply("You are not in a chat. Use /search to find a partner!");
    }

    const user = await getUser(id);
    const durationMs = user.chatStartTime ? Math.max(0, Date.now() - user.chatStartTime) : 0;
    const durationText = formatDuration(durationMs);

    if (result.partner) {
      if (user.chatStartTime) {
        await recordChatAnalytics({
          endedAt: Date.now(),
          startedAt: user.chatStartTime,
          durationMs,
          userIds: [id, result.partner],
          messageCount: result.messageCount,
          endedBy: "end",
          dropOff: durationMs < 60_000 || result.messageCount <= 2
        });
      }

      await updateUser(id, { reportingPartner: result.partner, chatStartTime: null, queueStatus: "removed", queueJoinedAt: null });
      await updateUser(result.partner, { reportingPartner: id, chatStartTime: null, queueStatus: "removed", queueJoinedAt: null });
      await incUserTotalChats(id);
      await incUserTotalChats(result.partner);
    } else {
      await updateUser(id, { chatStartTime: null, queueStatus: "removed", queueJoinedAt: null });
    }

    const notifySent = result.partner
      ? await sendMessageWithRetry(bot, result.partner, buildPartnerLeftMessage(durationText, result.messageCount), exitChatKeyboard)
      : false;

    if (!notifySent && result.partner) {
      await cleanupBlockedUser(bot, result.partner);
    }

    return ctx.reply(buildSelfEndedMessage(durationText, result.messageCount), {
      parse_mode: "HTML",
      ...exitChatKeyboard
    });
  }
};
