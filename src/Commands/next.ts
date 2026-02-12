import { Context, Markup } from "telegraf";
import { ExtraTelegraf } from "..";
import { getGender, getUser, updateUser } from "../storage/db";
import { sendMessageWithRetry, endChatDueToError, cleanupBlockedUser } from "../Utils/telegramErrorHandler";

// Type for users in waiting queue
interface WaitingUser {
  id: number;
  preference: string;
  gender: string;
  isPremium: boolean;
}

export default {
  name: "next",
  description: "Skip current chat and find new partner",
  execute: async (ctx: Context, bot: ExtraTelegraf) => {

    const userId = ctx.from?.id as number;

    // Check rate limit
    if (bot.isRateLimited(userId)) {
      return ctx.reply("⏳ Please wait a moment before trying again.");
    }

    // Acquire mutex to prevent race conditions
    await bot.chatMutex.acquire();

    try {
      const gender = await getGender(userId);
      
      // End current chat if in one
      if (bot.runningChats.includes(userId)) {
        const partner = bot.getPartner(userId);
        
        // Remove users from running chats (handle null partner)
        const usersToRemove = [userId];
        if (partner) usersToRemove.push(partner);
        bot.runningChats = bot.runningChats.filter(u => !usersToRemove.includes(u));
        
        // Clean up message maps
        bot.messageMap.delete(userId);
        if (partner) bot.messageMap.delete(partner);
        
        // Clean up message count
        bot.messageCountMap.delete(userId);
        if (partner) bot.messageCountMap.delete(partner);

        // Store partner ID for potential report (both ways)
        if (partner) {
          await updateUser(userId, { reportingPartner: partner, chatStartTime: null });
          await updateUser(partner, { reportingPartner: userId, chatStartTime: null });
        }
        
        // Report keyboard
        const reportKeyboard = Markup.inlineKeyboard([
          [Markup.button.callback("🚨 Report User", "OPEN_REPORT")]
        ]);

        // Use sendMessageWithRetry to handle blocked partners
        const notifySent = partner ? await sendMessageWithRetry(
          bot,
          partner,
          "🚫 Partner left the chat\n\n/next - Find new partner\n\n━━━━━━━━━━━━━━━━━\nTo report this chat:",
          reportKeyboard
        ) : false;

        // If message failed to send, end the chat properly
        if (!notifySent && partner) {
          cleanupBlockedUser(bot, partner);
          endChatDueToError(bot, userId, partner);
          return ctx.reply("🚫 Partner left the chat");
        }

        return ctx.reply(
          "🚫 Partner left the chat\n\n/next - Find new partner\n\n━━━━━━━━━━━━━━━━━\nTo report this chat:",
          reportKeyboard
        );
      }

      // Remove from queue if already waiting
      const queueIndex = bot.waitingQueue.findIndex(w => w.id === userId);
      if (queueIndex !== -1) {
        bot.waitingQueue.splice(queueIndex, 1);
      }

      // Get user preference
      const user = await getUser(userId);
      const preference = user.preference || "any";
      const isPremium = user.premium || false;

      // SIMPLIFIED MATCHING LOGIC:
      // - Normal users (non-premium): preference is locked to "any" → match with BOTH genders randomly
      // - Premium users: can set preference → match ONLY with preferred gender
      // If user is premium AND has specific preference, match only with that gender
      // Otherwise (free user or "any" preference), match with anyone
      const matchPreference = (isPremium && preference !== "any") ? preference : null;

      // Find a compatible match
      // Bidirectional matching: both users must be compatible
      // 1. Current user's preference must match waiting user's gender
      // 2. Waiting user's preference must match current user's gender
      const matchIndex = bot.waitingQueue.findIndex(waiting => {
        const w = waiting as WaitingUser;
        
        // Check if waiting user's gender matches current user's preference
        const genderMatches = !matchPreference || w.gender === matchPreference;
        
        // Check if current user's gender matches waiting user's preference
        const preferenceMatches = !w.preference || w.preference === "any" || w.preference === gender;
        
        return genderMatches && preferenceMatches;
      });

      if (matchIndex !== -1) {
        const match = bot.waitingQueue[matchIndex] as WaitingUser;
        const matchUser = await getUser(match.id);
        bot.waitingQueue.splice(matchIndex, 1);

        bot.runningChats.push(match.id, userId);

        // Store last partner and chat start time
        await updateUser(userId, { lastPartner: match.id, chatStartTime: Date.now() });
        await updateUser(match.id, { lastPartner: userId, chatStartTime: Date.now() });

        // Initialize message count for both users
        bot.messageCountMap.set(userId, 0);
        bot.messageCountMap.set(match.id, 0);

        if (bot.waiting === match.id) {
          bot.waiting = null;
        }

        // Increment chat count for new chat
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

        // Use sendMessageWithRetry to handle blocked matches
        const matchSent = await sendMessageWithRetry(
          bot,
          match.id,
          matchPartnerInfo
        );

        // If message failed to send, end the chat
        if (!matchSent) {
          endChatDueToError(bot, userId, match.id);
          return ctx.reply("🚫 Could not connect to partner. They may have left or restricted the bot.");
        }

        return ctx.reply(userPartnerInfo);
      }

      // No match, add to queue
      bot.waitingQueue.push({ id: userId, preference, gender: gender || "any", isPremium } as WaitingUser);
      bot.waiting = userId;
      return ctx.reply("⏳ Waiting for a partner...");
    } finally {
      bot.chatMutex.release();
    }
  }
};
