import { Context, Markup } from "telegraf";
import { ExtraTelegraf } from "..";
import { getGender, getUser, updateUser } from "../storage/db";
import { sendMessageWithRetry, endChatDueToError } from "../Utils/telegramErrorHandler";

// Type for users in waiting queue
interface WaitingUser {
  id: number;
  preference: string;
  gender: string;
  isPremium: boolean;
}

export default {
  name: "search",
  description: "Search for a chat",
  execute: async (ctx: Context, bot: ExtraTelegraf) => {

    const userId = ctx.from?.id as number;

    // Check rate limit
    if (bot.isRateLimited(userId)) {
      return ctx.reply("⏳ Please wait a few seconds before searching again.");
    }

    // Check queue size limit
    if (bot.isQueueFull()) {
      return ctx.reply("🚫 Queue is full. Please try again later.");
    }

    // Acquire mutex to prevent race conditions
    await bot.queueMutex.acquire();

    try {
      const gender = await getGender(userId);
      
      if (!gender) {
        return ctx.reply("Set gender first using /setgender");
      }

      if (bot.runningChats.includes(userId)) {
        return ctx.reply(
          "You are already in a chat!\n\nUse /end to leave the chat or use /next to skip the current chat."
        );
      }

      // Check if already in queue
      if (bot.waitingQueue.some(w => w.id === userId)) {
        return ctx.reply("You are already in the queue!");
      }

      // Get user info and preference
      const user = await getUser(userId);
      const preference = user.preference || "any";
      const isPremium = user.premium || false;

      // Find a compatible match from the queue
      const matchIndex = bot.waitingQueue.findIndex(waiting => {
        const w = waiting as WaitingUser;
        
        // If current user has preference, check if waiting user's gender matches
        const currentUserSatisfied = 
          preference === "any" || preference === w.gender;
        
        // If waiting user has preference, check if current user's gender matches
        const waitingUserSatisfied = 
          w.preference === "any" || w.preference === gender;
        
        // Premium user preference takes priority:
        // If current user is premium with a specific preference, match even if waiting user has no preference
        const premiumPriority = isPremium && preference !== "any" && preference === w.gender;
        
        // If waiting user is premium with a specific preference, match even if current user has no preference
        const waitingPremiumPriority = w.isPremium && w.preference !== "any" && w.preference === gender;
        
        return (currentUserSatisfied && waitingUserSatisfied) || premiumPriority || waitingPremiumPriority;
      });

      if (matchIndex !== -1) {
        const match = bot.waitingQueue[matchIndex] as WaitingUser;
        const matchUser = await getUser(match.id);
        bot.waitingQueue.splice(matchIndex, 1);

        bot.runningChats.push(match.id, userId);

        // Store last partner for both users
        await updateUser(userId, { lastPartner: match.id });
        await updateUser(match.id, { lastPartner: userId });

        // Store chat start time for media restriction (2 minutes)
        const chatStartTime = Date.now();
        await updateUser(userId, { chatStartTime });
        await updateUser(match.id, { chatStartTime });

        // Clear waiting if it was this user
        if (bot.waiting === match.id) {
          bot.waiting = null;
        }

        // Increment chat count
        bot.incrementChatCount();

        // Build partner info message
        const partnerGender = isPremium ? (matchUser.gender ? matchUser.gender.charAt(0).toUpperCase() + matchUser.gender.slice(1) : "Not Set") : "Available with Premium";
        const partnerAge = matchUser.age || "Not Set";
        
        const userPartnerInfo = 
`✅ Partner Matched

🔢 Age: ${partnerAge}
👥 Gender: ${partnerGender}
🌍 Country: 🇮🇳 India${matchUser.state ? ` - ${matchUser.state.charAt(0).toUpperCase() + matchUser.state.slice(1)}` : ""}

🚫 Links are restricted
⏱️ Media sharing unlocked after 2 minutes

/end — Leave the chat`;

        const matchPartnerInfo = 
`✅ Partner Matched

🔢 Age: ${user.age || "Not Set"}
👥 Gender: ${user.gender ? user.gender.charAt(0).toUpperCase() + user.gender.slice(1) : "Not Set"}
🌍 Country: 🇮🇳 India${user.state ? ` - ${user.state.charAt(0).toUpperCase() + user.state.slice(1)}` : ""}

🚫 Links are restricted
⏱️ Media sharing unlocked after 2 minutes

/end — Leave the chat`;

        // Use sendMessageWithRetry to handle blocked partners
        const matchSent = await sendMessageWithRetry(
          bot,
          match.id,
          matchPartnerInfo
        );

        // If message failed to send (partner blocked/removed bot), end the chat
        if (!matchSent) {
          endChatDueToError(bot, userId, match.id);
          return ctx.reply("🚫 Could not connect to partner. They may have left or restricted the bot.");
        }

        return ctx.reply(userPartnerInfo);
      }

      // No match found, add to queue
      bot.waitingQueue.push({ id: userId, preference, gender, isPremium } as WaitingUser);
      bot.waiting = userId;
      return ctx.reply("⏳ Waiting for a partner...");
    } finally {
      // Always release the mutex
      bot.queueMutex.release();
    }
  }
};
