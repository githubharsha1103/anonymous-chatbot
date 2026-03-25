import { Context } from "telegraf";
import { ExtraTelegraf } from "..";
import { areUsersMutuallyBlocked, getUser, updateUser } from "../storage/db";
import {
  beginChatRuntime,
  buildPartnerLeftMessage,
  buildPartnerMatchMessage,
  buildSelfSkippedMessage,
  clearChatRuntime,
  exitChatKeyboard
} from "../Utils/chatFlow";
import { cleanupBlockedUser, cleanupBlockedUserAsync, endChatDueToError, sendMessageWithRetry } from "../Utils/telegramErrorHandler";
import { isPremium as checkPremiumStatus } from "../Utils/starsPayments";
import { getIsBroadcasting } from "../index";

interface WaitingUser {
  id: number;
  preference: string;
  gender: string;
  isPremium: boolean;
  blockedUsers?: number[];
}

export default {
  name: "next",
  description: "Skip current chat and find new partner",
  execute: async (ctx: Context, bot: ExtraTelegraf) => {
    const userId = ctx.from?.id as number;

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
        const matchPreference = isPremium && preference !== "any" ? preference : null;

        let matchIndex = -1;
        for (let i = 0; i < bot.waitingQueue.length; i++) {
          const queuedUser = bot.waitingQueue[i] as WaitingUser;
          if (!bot.queueSet.has(queuedUser.id)) continue;

          const waitingGender = queuedUser.gender || "any";
          const waitingPreference = queuedUser.preference || "any";
          const genderMatches = !matchPreference || waitingGender === matchPreference;
          const preferenceMatches = waitingPreference === "any" || waitingPreference === gender;

          if (genderMatches && preferenceMatches) {
            const blockedByLatestState = await areUsersMutuallyBlocked(userId, queuedUser.id);
            if (blockedByLatestState) continue;

            matchIndex = i;
            break;
          }
        }

        if (matchIndex === -1) {
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
          // Handle case where user has blocked the bot
          try {
            return await ctx.reply("⏳ Waiting for a partner...");
          } catch {
            // User blocked the bot - remove from queue and notify
            await cleanupBlockedUserAsync(bot, userId);
            return ctx.reply("⚠️ Unable to send message. You may have blocked the bot.");
          }
        }

        const match = bot.waitingQueue[matchIndex] as WaitingUser;
        bot.waitingQueue.splice(matchIndex, 1);
        bot.queueSet.delete(match.id);
        await beginChatRuntime(bot, userId, match.id);

        const chatStartTime = Date.now();
        await updateUser(userId, { lastPartner: match.id, chatStartTime });
        await updateUser(match.id, { lastPartner: userId, chatStartTime });

        const matchUser = await getUser(match.id);
        bot.incrementChatCount();

        const userPartnerInfo = buildPartnerMatchMessage(isPremium, matchUser);
        const matchPartnerInfo = buildPartnerMatchMessage(checkPremiumStatus(user), user);

        const matchSent = await sendMessageWithRetry(bot, match.id, matchPartnerInfo);
        if (!matchSent) {
          const partnerStillThere = bot.runningChats.has(match.id);
          await endChatDueToError(bot, userId, match.id);

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

            return ctx.reply(
              "⏳ Temporary connection issue with partner. You've been added back to the queue...\n⏳ Waiting for a new partner..."
            );
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
