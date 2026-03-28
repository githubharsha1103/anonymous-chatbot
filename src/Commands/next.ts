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

// Type for queue users (kept for reference)
// type WaitingUser = {
//   id: number;
//   preference: string;
//   gender: string;
//   isPremium: boolean;
//   blockedUsers?: number[];
// };

export default {
  name: "next",
  description: "Skip current chat and find new partner",
  execute: async (ctx: Context, bot: ExtraTelegraf) => {
    const userId = ctx.from?.id as number;

    // Check system load - graceful degradation
    if (getIsSystemBusy()) {
      return ctx.reply("⚠️ High server load. Please try again in a few seconds.");
    }

    // Check user rate limit
    if (checkUserRateLimit(userId)) {
      return ctx.reply(RATE_LIMIT_MESSAGE);
    }

    // Check if broadcast is in progress - block matching during broadcast
    if (getIsBroadcasting()) {
      return ctx.reply("⚠️ Server busy due to update. Please try again in a few seconds.");
    }

    if (bot.isRateLimited(userId)) {
      return ctx.reply("⏳ Please wait a moment before trying again.");
    }

    // Check for duplicate request
    if (bot.hasPendingLockRequest(userId)) {
      return ctx.reply("⏳ Your request is already being processed. Please wait.");
    }

    bot.syncQueueState();

    if (bot.isQueueFull()) {
      return ctx.reply("⏳ Queue is full. Please try again later.");
    }

    const MAX_QUEUE_SOFT_LIMIT = 9500;
    if (bot.waitingQueue.length > MAX_QUEUE_SOFT_LIMIT) {
      const removeCount = bot.trimWaitingQueue(MAX_QUEUE_SOFT_LIMIT);
      console.log(`[QUEUE] - Queue size limit enforced, removed ${removeCount} oldest users`);
    }

    // Use safe lock wrapper
    const lockResult = await bot.withChatStateLockSafe(
      async () => {
        const user = await getUser(userId);
        const gender = user.gender || "any";

        if (bot.runningChats.has(userId)) {
          const partner = bot.getPartner(userId);
          await clearChatRuntime(bot, userId, partner);

          if (partner) {
            await updateUser(userId, { reportingPartner: partner, chatStartTime: null });
            await updateUser(partner, { reportingPartner: userId, chatStartTime: null });
          }

          const notifySent = partner
            ? await sendMessageWithRetry(bot, partner, buildPartnerLeftMessage(), exitChatKeyboard)
            : false;

          if (!notifySent && partner) {
            await cleanupBlockedUser(bot, partner);
            await endChatDueToError(bot, userId, partner);
            return ctx.reply("⏳ Partner left the chat");
          }

          await ctx.reply(buildSelfSkippedMessage(), exitChatKeyboard);
        }

        await bot.removeFromQueue(userId);

        const preference = user.preference || "any";
        const isPremium = user.premium || false;
        const myBlockedUsers = user.blockedUsers || [];

        // Use optimized O(1) matching via preference maps
        const matchResult = await bot.matchFromQueue(userId, {
          id: userId,
          preference,
          gender,
          isPremium,
          blockedUsers: myBlockedUsers
        });

        if (!matchResult.matched || !matchResult.partnerId) {
          // No match found - add to queue
          const added = await bot.addToQueueAtomic({
            id: userId,
            preference,
            gender,
            isPremium,
            blockedUsers: myBlockedUsers
          });
          if (!added) {
            return ctx.reply("⚠️ You are already in the queue!");
          }
          // User added to queue - use startSearch for animated UI
          // (No need to handle blocked case - user already sees search UI if they block)
          return await startSearch(ctx, bot, userId);
        }

        const matchId = matchResult.partnerId;

        // Check mutual blocking - if blocked, don't match with this user
        const blockedByLatestState = await areUsersMutuallyBlocked(userId, matchId);
        if (blockedByLatestState) {
          // Remove the match from queue and try to find another
          await bot.removeFromQueue(matchId);
          await bot.removeFromPremiumQueue(matchId); // FIX: Also remove from premium queue
          // Try to find another match
          const retryResult = await bot.matchFromQueue(userId, {
            id: userId,
            preference,
            gender,
            isPremium,
            blockedUsers: [...myBlockedUsers, matchId] // Add blocked user to list
          });

          if (!retryResult.matched || !retryResult.partnerId) {
            // Put user back in queue
            const added = await bot.addToQueueAtomic({
              id: userId,
              preference,
              gender,
              isPremium,
              blockedUsers: myBlockedUsers
            });
            if (!added) {
              return ctx.reply("⚠️ You are already in the queue!");
            }
            // User re-added to queue - use startSearch for animated UI
            return await startSearch(ctx, bot, userId);
          }
        }

        const chatStartTime = Date.now();
        await updateUser(userId, { lastPartner: matchId, chatStartTime });
        await updateUser(matchId, { lastPartner: userId, chatStartTime });

        const matchUser = await getUser(matchId);
        bot.incrementChatCount();

        const userPartnerInfo = buildPartnerMatchMessage(isPremium, matchUser);
        const matchPartnerInfo = buildPartnerMatchMessage(checkPremiumStatus(user), user);

        const matchSent = await sendMessageWithRetry(bot, matchId, matchPartnerInfo);
        if (!matchSent) {
          const partnerStillThere = bot.runningChats.has(matchId);
          await endChatDueToError(bot, userId, matchId);

          if (partnerStillThere) {
            const refreshedUser = await getUser(userId);
            const requeued = await bot.addToQueueAtomic({
              id: userId,
              preference,
              gender: refreshedUser.gender || "any",
              isPremium,
              blockedUsers: refreshedUser.blockedUsers || []
            });
            if (!requeued) {
              return ctx.reply("⏳ Temporary connection issue. Please try /next again.");
            }

            // User re-added to queue - use startSearch for animated UI
            return await startSearch(ctx, bot, userId);
          }

          return ctx.reply("⏳ Could not connect to partner. They may have left or restricted the bot.");
        }

        return ctx.reply(userPartnerInfo);
      },
      userId,
      "⚠️ Server busy, please try again in a few seconds"
    );

    if (!lockResult.success) {
      console.error("[Next] Lock failed for user", userId, lockResult.error);
      return ctx.reply(lockResult.error);
    }

    return lockResult.result;
  }
};
