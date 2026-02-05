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
      return ctx.reply("⏳ Please wait a moment before searching again.");
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

      // SIMPLIFIED MATCHING LOGIC:
      // - Normal users (non-premium): preference is locked to "any" → match with BOTH genders randomly
      // - Premium users: can set preference → match ONLY with preferred gender
      // If user is premium AND has specific preference, match only with that gender
      // Otherwise (free user or "any" preference), match with anyone
      const matchPreference = (isPremium && preference !== "any") ? preference : null;

      // Find a compatible match from the queue
      const matchIndex = bot.waitingQueue.findIndex(waiting => {
        const w = waiting as WaitingUser;
        
        if (matchPreference) {
          // Premium user with specific preference - only match with that gender
          return w.gender === matchPreference;
        } else {
          // Normal user or "any" preference - match with anyone
          return true;
        }
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

        // Initialize message count for both users
        bot.messageCountMap.set(userId, 0);
        bot.messageCountMap.set(match.id, 0);

        // Clear waiting if it was this user
        if (bot.waiting === match.id) {
          bot.waiting = null;
        }

        // Increment chat count
        bot.incrementChatCount();

        // Build partner info message - hide gender for non-premium users
        const partnerGender = isPremium 
            ? (matchUser.gender ? matchUser.gender.charAt(0).toUpperCase() + matchUser.gender.slice(1) : "Not Set")
            : "🔒 Hidden";
        const partnerAge = matchUser.age || "Not Set";
        
        const userPartnerInfo = 
`✅ Partner Matched

🔢 Age: ${partnerAge}
👥 Gender: ${partnerGender}
🌍 Country: 🇮🇳 India${matchUser.state ? ` - ${matchUser.state.charAt(0).toUpperCase() + matchUser.state.slice(1)}` : ""}

🚫 Links are restricted
⏱️ Media sharing unlocked after 2 minutes

/end — Leave the chat`;

        // For match user - also hide gender if they're not premium
        const matchUserGender = user.premium 
            ? (user.gender ? user.gender.charAt(0).toUpperCase() + user.gender.slice(1) : "Not Set")
            : "🔒 Hidden";
            
        const matchPartnerInfo = 
`✅ Partner Matched

🔢 Age: ${user.age || "Not Set"}
👥 Gender: ${matchUserGender}
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
