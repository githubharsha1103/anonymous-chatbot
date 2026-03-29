import { Context } from "telegraf";
import { ExtraTelegraf } from "..";
import { areUsersMutuallyBlocked, getUser, updateUser } from "../storage/db";
import {
  buildPartnerLeftMessage,
  buildPartnerMatchMessage,
  buildSelfSkippedMessage,
  clearChatRuntime,
  exitChatKeyboard
} from "../Utils/chatFlow";
import { cleanupBlockedUser, endChatDueToError, sendMessageWithRetry } from "../Utils/telegramErrorHandler";
import { startSearch } from "../Utils/actionHandler";
import { isPremium as checkPremiumStatus } from "../Utils/starsPayments";
import { getIsBroadcasting, getIsSystemBusy, checkUserRateLimit, RATE_LIMIT_MESSAGE } from "../index";

type NextLockResult =
  | { type: "already_in_queue"; hadChat: boolean; previousPartner: number | null }
  | { type: "waiting"; hadChat: boolean; previousPartner: number | null }
  | {
      type: "matched";
      hadChat: boolean;
      previousPartner: number | null;
      matchId: number;
      preference: string;
      gender: string;
      isPremium: boolean;
      blockedUsers: number[];
    };

export default {
  name: "next",
  description: "Skip current chat and find new partner",
  execute: async (ctx: Context, bot: ExtraTelegraf) => {
    const userId = ctx.from?.id as number;

    if (getIsSystemBusy()) {
      return ctx.reply("High server load. Please try again in a few seconds.");
    }

    if (checkUserRateLimit(userId)) {
      return ctx.reply(RATE_LIMIT_MESSAGE);
    }

    if (getIsBroadcasting()) {
      return ctx.reply("Server busy due to update. Please try again in a few seconds.");
    }

    if (bot.isRateLimited(userId)) {
      return ctx.reply("Please wait a moment before trying again.");
    }

    if (bot.hasPendingLockRequest(userId)) {
      return ctx.reply("Your request is already being processed. Please wait.");
    }

    bot.syncQueueState();

    if (bot.isQueueFull()) {
      return ctx.reply("Queue is full. Please try again later.");
    }

    const MAX_QUEUE_SOFT_LIMIT = 9500;
    if (bot.waitingQueue.length > MAX_QUEUE_SOFT_LIMIT) {
      const removeCount = bot.trimWaitingQueue(MAX_QUEUE_SOFT_LIMIT);
      console.log(`[QUEUE] - Queue size limit enforced, removed ${removeCount} oldest users`);
    }

    const user = await getUser(userId);
    const preference = user.preference || "any";
    const gender = user.gender || "any";
    const isPremium = user.premium || false;
    const myBlockedUsers = user.blockedUsers || [];

    const lockResult = await bot.withChatStateLockSafe(
      async (): Promise<NextLockResult> => {
        const hadChat = bot.runningChats.has(userId);
        const previousPartner = hadChat ? bot.getPartner(userId) : null;

        if (hadChat) {
          await clearChatRuntime(bot, userId, previousPartner);
        }

        await bot.removeFromQueue(userId);

        let matchResult = await bot.matchFromQueue(userId, {
          id: userId,
          preference,
          gender,
          isPremium,
          blockedUsers: myBlockedUsers
        });

        if (matchResult.matched && matchResult.partnerId) {
          const blockedByLatestState = await areUsersMutuallyBlocked(userId, matchResult.partnerId);
          if (blockedByLatestState) {
            // Roll back tentative chat state created by matchFromQueue
            bot.runningChats.delete(userId);
            bot.runningChats.delete(matchResult.partnerId);

            // Re-queue partner so they are not dropped from matchmaking
            const partnerUser = await getUser(matchResult.partnerId);
            await bot.addToQueueAtomic({
              id: matchResult.partnerId,
              preference: partnerUser.preference || "any",
              gender: partnerUser.gender || "any",
              isPremium: partnerUser.premium || false,
              blockedUsers: partnerUser.blockedUsers || []
            });

            matchResult = await bot.matchFromQueue(userId, {
              id: userId,
              preference,
              gender,
              isPremium,
              blockedUsers: [...myBlockedUsers, matchResult.partnerId]
            });
          }
        }

        if (!matchResult.matched || !matchResult.partnerId) {
          const added = await bot.addToQueueAtomic({
            id: userId,
            preference,
            gender,
            isPremium,
            blockedUsers: myBlockedUsers
          });
          if (!added) {
            return { type: "already_in_queue", hadChat, previousPartner };
          }
          return { type: "waiting", hadChat, previousPartner };
        }

        return {
          type: "matched",
          hadChat,
          previousPartner,
          matchId: matchResult.partnerId,
          preference,
          gender,
          isPremium,
          blockedUsers: myBlockedUsers
        };
      },
      userId,
      "Server busy, please try again in a few seconds"
    );

    if (!lockResult.success) {
      console.error("[Next] Lock failed for user", userId, lockResult.error);
      return ctx.reply(lockResult.error);
    }

    const result = lockResult.result;

    if (result.hadChat && result.previousPartner) {
      await updateUser(userId, { reportingPartner: result.previousPartner, chatStartTime: null });
      await updateUser(result.previousPartner, { reportingPartner: userId, chatStartTime: null });

      const notifySent = await sendMessageWithRetry(
        bot,
        result.previousPartner,
        buildPartnerLeftMessage(),
        exitChatKeyboard
      );

      if (!notifySent) {
        await cleanupBlockedUser(bot, result.previousPartner);
      }

      await ctx.reply(buildSelfSkippedMessage(), exitChatKeyboard);
    }

    if (result.type === "already_in_queue") {
      return ctx.reply("You are already in the queue!");
    }

    if (result.type === "waiting") {
      return startSearch(ctx, bot, userId);
    }

    const chatStartTime = Date.now();
    await updateUser(userId, { lastPartner: result.matchId, chatStartTime });
    await updateUser(result.matchId, { lastPartner: userId, chatStartTime });

    const matchUser = await getUser(result.matchId);
    bot.incrementChatCount();

    const userPartnerInfo = buildPartnerMatchMessage(result.isPremium, matchUser);
    const matchPartnerInfo = buildPartnerMatchMessage(checkPremiumStatus(user), user);

    const matchSent = await sendMessageWithRetry(bot, result.matchId, matchPartnerInfo);
    if (!matchSent) {
      const partnerStillThere = bot.runningChats.has(result.matchId);
      await endChatDueToError(bot, userId, result.matchId);

      if (partnerStillThere) {
        const refreshedUser = await getUser(userId);
        const requeued = await bot.addToQueueAtomic({
          id: userId,
          preference: result.preference,
          gender: refreshedUser.gender || "any",
          isPremium: result.isPremium,
          blockedUsers: refreshedUser.blockedUsers || []
        });
        if (!requeued) {
          return ctx.reply("Temporary connection issue. Please try /next again.");
        }

        return startSearch(ctx, bot, userId);
      }

      return ctx.reply("Could not connect to partner. They may have left or restricted the bot.");
    }

    return ctx.reply(userPartnerInfo);
  }
};
