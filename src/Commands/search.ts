import { Context } from "telegraf";
import { ExtraTelegraf } from "..";
import { areUsersMutuallyBlocked, getUser, updateUser } from "../storage/db";
import { beginChatRuntime, buildPartnerMatchMessage } from "../Utils/chatFlow";
import { cleanupBlockedUserAsync, endChatDueToError, sendMessageWithRetry } from "../Utils/telegramErrorHandler";
import { getSetupRequiredPrompt } from "../Utils/setupFlow";
import { isPremium as checkPremiumStatus } from "../Utils/starsPayments";
import { getIsBroadcasting } from "../index";

interface WaitingUser {
  id: number;
  preference: string;
  gender: string;
  isPremium: boolean;
  blockedUsers?: number[];
}

export async function redirectToSetup(ctx: Context) {
  if (!ctx.from) return null;

  try {
    const user = await getUser(ctx.from.id);
    const prompt = getSetupRequiredPrompt(user);

    if (prompt) {
      return ctx.reply(prompt.text, { parse_mode: "Markdown", ...prompt.keyboard });
    }

    return null;
  } catch (error) {
    console.error("[redirectToSetup] Error fetching user:", error);
    return ctx.reply("⏳ An error occurred. Please try again.");
  }
}

export default {
  name: "search",
  description: "Search for a chat",
  execute: async (ctx: Context, bot: ExtraTelegraf) => {
    const userId = ctx.from?.id as number;

    // Check if broadcast is in progress - block matching during broadcast
    if (getIsBroadcasting()) {
      return ctx.reply("⚠️ Server busy due to update. Please try again in a few seconds.");
    }

    if (bot.isRateLimited(userId)) {
      return ctx.reply("⏳ Please wait a moment before searching again.");
    }

    // Check for duplicate request BEFORE acquiring lock
    if (bot.hasPendingLockRequest(userId)) {
      return ctx.reply("⏳ Your search request is already being processed. Please wait.");
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

    const user = await getUser(userId);
    if (!user.gender || !user.age || !user.state) {
      return redirectToSetup(ctx);
    }

    // Check if user is already in a chat or queue BEFORE lock (outside lock for performance)
    if (bot.runningChats.has(userId) || (user.lastPartner && user.chatStartTime)) {
      return ctx.reply(
        "You are already in a chat!\n\nUse /end to leave the chat or use /next to skip the current chat."
      );
    }

    if (bot.isInQueue(userId)) {
      return ctx.reply("⚠️ You are already in the queue!");
    }

    // Use safe lock wrapper with timeout handling
    const lockResult = await bot.withChatStateLockSafe(
      async () => {
        const gender = user.gender || "any";
        const preference = user.preference || "any";
        const isPremium = user.premium || false;
        const myBlockedUsers = user.blockedUsers || [];

        // Double-check state inside lock (could have changed while waiting for lock)
        if (bot.runningChats.has(userId) || (user.lastPartner && user.chatStartTime)) {
          return ctx.reply(
            "You are already in a chat!\n\nUse /end to leave the chat or use /next to skip the current chat."
          );
        }

        if (bot.isInQueue(userId)) {
          return ctx.reply("⚠️ You are already in the queue!");
        }

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
            const requeued = await bot.addToQueueAtomic({
              id: userId,
              preference,
              gender,
              isPremium,
              blockedUsers: myBlockedUsers
            });
            if (!requeued) {
              return ctx.reply("⏳ Temporary connection issue. Please try /search again.");
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
      console.error("[Search] Lock failed for user", userId, lockResult.error);
      return ctx.reply(lockResult.error);
    }

    return lockResult.result;
  }
};
