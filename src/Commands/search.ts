import { Context } from "telegraf";
import { ExtraTelegraf } from "..";
import { getUser, updateUser } from "../storage/db";
import { beginChatRuntime, buildPartnerMatchMessage } from "../Utils/chatFlow";
import { cleanupBlockedUserAsync, endChatDueToError, sendMessageWithRetry } from "../Utils/telegramErrorHandler";
import { getSetupRequiredPrompt } from "../Utils/setupFlow";
import { isPremium as checkPremiumStatus } from "../Utils/starsPayments";
import { getIsBroadcasting } from "../index";
import { getIsSystemBusy, checkUserRateLimit } from "../index";

interface WaitingUser {
  id: number;
  preference: string;
  gender: string;
  isPremium: boolean;
  blockedUsers?: number[];
}

// Type for lock result
type LockResult = 
  | { type: "already_in_chat" }
  | { type: "already_in_queue" }
  | { type: "waiting" }
  | { type: "matched"; matchId: number; userId: number; preference: string; gender: string; isPremium: boolean; blockedUsers: number[] };

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

    // Check system load - graceful degradation
    if (getIsSystemBusy()) {
      return ctx.reply("⚠️ High server load. Please try again in a few seconds.");
    }

    // Check user rate limit
    if (checkUserRateLimit(userId)) {
      return ctx.reply("⏳ Please slow down. Wait a moment before trying again.");
    }

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
      if (process.env.DEBUG_QUEUE === "true") {
        console.log(`[QUEUE] - Queue size limit enforced, removed ${removeCount} oldest users`);
      }
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

    // Use safe lock wrapper - only queue operations inside lock
    const lockResult = await bot.withChatStateLockSafe(
      async (): Promise<LockResult> => {
        const gender = user.gender || "any";
        const preference = user.preference || "any";
        const isPremium = user.premium || false;
        const myBlockedUsers = user.blockedUsers || [];

        // Double-check state inside lock
        if (bot.runningChats.has(userId) || (user.lastPartner && user.chatStartTime)) {
          return { type: "already_in_chat" };
        }

        if (bot.isInQueue(userId)) {
          return { type: "already_in_queue" };
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
            return { type: "already_in_queue" };
          }
          return { type: "waiting" };
        }

        // Found match - extract data for processing outside lock
        const match = bot.waitingQueue[matchIndex] as WaitingUser;
        const matchId = match.id;

        // Quick queue operations only
        bot.waitingQueue.splice(matchIndex, 1);
        bot.queueSet.delete(matchId);
        await beginChatRuntime(bot, userId, matchId);

        return { 
          type: "matched", 
          matchId, 
          userId, 
          preference, 
          gender, 
          isPremium, 
          blockedUsers: myBlockedUsers 
        };
      },
      userId,
      "⚠️ Server busy, please try again in a few seconds"
    );

    if (!lockResult.success) {
      if (process.env.DEBUG_LOCKS === "true") {
        console.error("[Search] Lock failed for user", userId, lockResult.error);
      }
      return ctx.reply(lockResult.error);
    }

    const result = lockResult.result;

    // Process result OUTSIDE the lock - heavy operations here
    if (result.type === "already_in_chat") {
      return ctx.reply(
        "You are already in a chat!\n\nUse /end to leave the chat or use /next to skip the current chat."
      );
    }

    if (result.type === "already_in_queue") {
      return ctx.reply("⚠️ You are already in the queue!");
    }

    if (result.type === "waiting") {
      // User added to queue - send message outside lock
      try {
        return await ctx.reply("⏳ Waiting for a partner...");
      } catch {
        await cleanupBlockedUserAsync(bot, userId);
        return ctx.reply("⚠️ Unable to send message. You may have blocked the bot.");
      }
    }

    if (result.type === "matched") {
      // Heavy DB operations outside lock
      const chatStartTime = Date.now();
      await updateUser(userId, { lastPartner: result.matchId, chatStartTime });
      await updateUser(result.matchId, { lastPartner: userId, chatStartTime });

      const matchUser = await getUser(result.matchId);
      bot.incrementChatCount();

      const userPartnerInfo = buildPartnerMatchMessage(result.isPremium, matchUser);
      const matchPartnerInfo = buildPartnerMatchMessage(checkPremiumStatus(user), user);

      // Send messages outside lock
      const matchSent = await sendMessageWithRetry(bot, result.matchId, matchPartnerInfo);
      if (!matchSent) {
        const partnerStillThere = bot.runningChats.has(result.matchId);
        await endChatDueToError(bot, userId, result.matchId);

        if (partnerStillThere) {
          const requeued = await bot.addToQueueAtomic({
            id: userId,
            preference: result.preference,
            gender: result.gender,
            isPremium: result.isPremium,
            blockedUsers: result.blockedUsers
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

      // Yield to event loop before final message
      await new Promise(resolve => setTimeout(resolve, 5));

      return ctx.reply(userPartnerInfo);
    }
  }
};
