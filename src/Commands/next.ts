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
import { cleanupBlockedUser, endChatDueToError, sendMessageWithRetry } from "../Utils/telegramErrorHandler";

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

    if (bot.isRateLimited(userId)) {
      return ctx.reply("? Please wait a moment before trying again.");
    }

    bot.syncQueueState();

    if (bot.isQueueFull()) {
      return ctx.reply("?? Queue is full. Please try again later.");
    }

    const MAX_QUEUE_SOFT_LIMIT = 9500;
    if (bot.waitingQueue.length > MAX_QUEUE_SOFT_LIMIT) {
      const removeCount = bot.trimWaitingQueue(MAX_QUEUE_SOFT_LIMIT);
      console.log(`[QUEUE] - Queue size limit enforced, removed ${removeCount} oldest users`);
    }

    try {
      return await bot.withChatStateLock(async () => {
        const user = await getUser(userId);
        const gender = user.gender || "any";

        if (bot.runningChats.has(userId)) {
          const partner = bot.getPartner(userId);
          clearChatRuntime(bot, userId, partner);

          if (partner) {
            await updateUser(userId, { reportingPartner: partner, chatStartTime: null });
            await updateUser(partner, { reportingPartner: userId, chatStartTime: null });
          }

          const notifySent = partner
            ? await sendMessageWithRetry(bot, partner, buildPartnerLeftMessage(), exitChatKeyboard)
            : false;

          if (!notifySent && partner) {
            cleanupBlockedUser(bot, partner);
            await endChatDueToError(bot, userId, partner);
            return ctx.reply("?? Partner left the chat");
          }

          await ctx.reply(buildSelfSkippedMessage(), exitChatKeyboard);
        }

        bot.removeFromQueue(userId);

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
          const added = bot.addToQueueAtomic({
            id: userId,
            preference,
            gender,
            isPremium,
            blockedUsers: myBlockedUsers
          });
          if (!added) {
            return ctx.reply("You are already in the queue!");
          }
          return ctx.reply("? Waiting for a partner...");
        }

        const match = bot.waitingQueue[matchIndex] as WaitingUser;
        bot.waitingQueue.splice(matchIndex, 1);
        bot.queueSet.delete(match.id);
        beginChatRuntime(bot, userId, match.id);

        const chatStartTime = Date.now();
        await updateUser(userId, { lastPartner: match.id, chatStartTime });
        await updateUser(match.id, { lastPartner: userId, chatStartTime });

        const matchUser = await getUser(match.id);
        bot.incrementChatCount();

        const userPartnerInfo = buildPartnerMatchMessage(isPremium, matchUser);
        const matchPartnerInfo = buildPartnerMatchMessage(!!user.premium, user);

        const matchSent = await sendMessageWithRetry(bot, match.id, matchPartnerInfo);
        if (!matchSent) {
          const partnerStillThere = bot.runningChats.has(match.id);
          await endChatDueToError(bot, userId, match.id);

          if (partnerStillThere) {
            const refreshedUser = await getUser(userId);
            const requeued = bot.addToQueueAtomic({
              id: userId,
              preference,
              gender: refreshedUser.gender || "any",
              isPremium,
              blockedUsers: refreshedUser.blockedUsers || []
            });
            if (!requeued) {
              return ctx.reply("?? Temporary connection issue. Please try /next again.");
            }

            return ctx.reply(
              "?? Temporary connection issue with partner. You've been added back to the queue...\n? Waiting for a new partner..."
            );
          }

          return ctx.reply("?? Could not connect to partner. They may have left or restricted the bot.");
        }

        return ctx.reply(userPartnerInfo);
      });
    } catch (error) {
      console.error("[Next command] Match flow failed:", error);
      return ctx.reply("?? Server is busy. Please try again in a moment.");
    }
  }
};
