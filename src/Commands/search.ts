import { Context } from "telegraf";
import { ExtraTelegraf } from "..";
import { getUser, updateUser } from "../storage/db";
import { beginChatRuntime, buildPartnerMatchMessage } from "../Utils/chatFlow";
import { endChatDueToError, sendMessageWithRetry } from "../Utils/telegramErrorHandler";
import { getSetupRequiredPrompt } from "../Utils/setupFlow";
import { isPremium as checkPremiumStatus } from "../Utils/starsPayments";
import { getIsBroadcasting } from "../index";
import { getIsSystemBusy, checkUserRateLimit, RATE_LIMIT_MESSAGE } from "../index";
import { onMatchFound, startSearch, sendConnectionMessage, removeUserEverywhere } from "../Utils/actionHandler";

type LockResult = 
  | { type: "already_in_chat" }
  | { type: "already_in_queue" }
  | { type: "duplicate_request" }
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
      return ctx.reply(RATE_LIMIT_MESSAGE);
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

    // Extract user data OUTSIDE the lock callback for use inside
    const preference = user.preference || "any";
    const gender = user.gender || "any";
    const isPremium = checkPremiumStatus(user);
    const myBlockedUsers = user.blockedUsers || [];

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
        // Check for duplicate request INSIDE lock to prevent race condition
        if (bot.hasPendingLockRequest(userId)) {
          return { type: "duplicate_request" };
        }
        bot.setPendingLockRequest(userId);

        try {
          // Double-check state inside lock
          if (bot.runningChats.has(userId) || (user.lastPartner && user.chatStartTime)) {
            return { type: "already_in_chat" };
          }

          if (bot.isInQueue(userId)) {
            return { type: "already_in_queue" };
          }

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
              return { type: "already_in_queue" };
            }
            return { type: "waiting" };
          }

          // Found match
          const matchId = matchResult.partnerId;

          // Initialize chat runtime
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
        } finally {
          bot.clearPendingLockRequest(userId);
        }
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

    if (result.type === "duplicate_request") {
      return ctx.reply("⏳ Your search request is already being processed. Please wait.");
    }

    if (result.type === "waiting") {
      // User added to queue - use startSearch function for animation
      // Note: No need to cleanup here - user was just added in addToQueueAtomic
      await startSearch(ctx, bot, userId);
      return;
    }

    if (result.type === "matched") {
      // FIX #4: Atomic match safety - check BEFORE async
      if (bot.runningChats.has(userId) || bot.runningChats.has(result.matchId)) {
        console.error(`[MATCH] Race condition detected! user1=${userId}, user2=${result.matchId}`);
        return ctx.reply("⏳ Connection failed. Please try again.");
      }
      
      // Immediately add to runningChats (BEFORE any async)
      bot.runningChats.set(userId, result.matchId);
      bot.runningChats.set(result.matchId, userId);
      
      // Update search UI to show "Partner found!" BEFORE heavy operations
      await onMatchFound(bot, userId);
      
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
        
        // FIX #7: Running chat cleanup on error
        bot.runningChats.delete(userId);
        bot.runningChats.delete(result.matchId);
        
        await endChatDueToError(bot, userId, result.matchId);

        if (partnerStillThere) {
          // FIX #6: Ensure queue consistency after error
          removeUserEverywhere(bot, userId);
          
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

          // User re-added to queue - use startSearch for animated UI
          return await startSearch(ctx, bot, userId);
        }

        return ctx.reply("⏳ Could not connect to partner. They may have left or restricted the bot.");
      }

      // FIX #5: setTimeout BUG - wrap in runningChats check
      setTimeout(() => {
        // Verify both users are still in runningChats before sending
        if (!bot.runningChats.has(userId) || !bot.runningChats.has(result.matchId)) {
          console.log(`[MATCH] Skipping connection message - user no longer in chat`);
          return;
        }
        
        sendConnectionMessage(bot, userId);
        sendConnectionMessage(bot, result.matchId);
      }, 1200);
      
      // Yield to event loop before final message
      await new Promise(resolve => setTimeout(resolve, 5));

      return ctx.reply(userPartnerInfo);
    }
  }
};
