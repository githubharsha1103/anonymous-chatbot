import { Context, Markup } from "telegraf";
import { ExtraTelegraf } from "..";
import { getGender, getUser, updateUser, incDaily, checkAndResetDaily } from "../storage/db";
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
    
    // Check queue size limit
    if (bot.isQueueFull()) {
      return ctx.reply("🚫 Queue is full. Please try again later.");
    }
    
    // Enforce queue size limit by removing oldest if approaching limit
    const MAX_QUEUE_SOFT_LIMIT = 9500; // Start removing at 95% capacity
    if (bot.waitingQueue.length > MAX_QUEUE_SOFT_LIMIT) {
      const removeCount = bot.waitingQueue.length - MAX_QUEUE_SOFT_LIMIT;
      bot.waitingQueue = bot.waitingQueue.slice(removeCount);
      console.log(`[QUEUE] - Queue size limit enforced, removed ${removeCount} oldest users`);
    }

    // Acquire mutex to prevent race conditions
    await bot.chatMutex.acquire();

    try {
      const gender = await getGender(userId);
      
      // End current chat if in one
      if (bot.runningChats.has(userId)) {
        const partner = bot.getPartner(userId);
        
        // Remove users from running chats using Map delete
        bot.runningChats.delete(userId);
        if (partner) bot.runningChats.delete(partner);
        
        // Clean up message maps
        bot.messageMap.delete(userId);
        if (partner) bot.messageMap.delete(partner);
        
        // Clean up message count
        bot.messageCountMap.delete(userId);
        if (partner) bot.messageCountMap.delete(partner);
        
        // Clean up rate limit entries to prevent memory growth
        bot.rateLimitMap.delete(userId);
        if (partner) bot.rateLimitMap.delete(partner);

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
      
      // Check daily chat limit for non-premium users (only when looking for a new match)
      const canChat = await checkAndResetDaily(userId);
      if (!canChat) {
          return ctx.reply(
              "⏰ *Daily chat limit reached!*\n\n" +
              "You've used all 100 free chats for today.\n\n" +
              "💎 *Upgrade to Premium for unlimited chats!*/settings",
              { parse_mode: "Markdown" }
          );
      }
      
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
      // Use stored queue entry data to avoid database roundtrips
      let matchIndex = -1;
      
      for (let i = 0; i < bot.waitingQueue.length; i++) {
        const w = bot.waitingQueue[i] as WaitingUser;
        const waitingGender = w.gender || "any";
        const waitingPref = w.preference || "any";

        const genderMatches = !matchPreference || waitingGender === matchPreference;
        const preferenceMatches = waitingPref === "any" || waitingPref === gender;

        if (genderMatches && preferenceMatches) {
          matchIndex = i;
          break;
        }
      }

      if (matchIndex !== -1) {
        const match = bot.waitingQueue[matchIndex] as WaitingUser;
        bot.waitingQueue.splice(matchIndex, 1);

        bot.runningChats.set(match.id, userId);
        bot.runningChats.set(userId, match.id);

        // Store last partner and chat start time
        await updateUser(userId, { lastPartner: match.id, chatStartTime: Date.now() });
        await updateUser(match.id, { lastPartner: userId, chatStartTime: Date.now() });
        
        // load matched user profile for display
        const matchUser = await getUser(match.id);
        // Increment chat count for new chat
        bot.incrementChatCount();
        
        // Increment daily chat count for non-premium user
        await incDaily(userId);

        // Build partner info message - hide gender for non-premium users
        // Premium users can see partner's gender only if partner has set it
        const partnerGender = isPremium && matchUser.gender 
            ? matchUser.gender.charAt(0).toUpperCase() + matchUser.gender.slice(1) 
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
        // Premium users can see their own gender only if they have set it
        const matchUserGender = user.premium && user.gender 
            ? user.gender.charAt(0).toUpperCase() + user.gender.slice(1) 
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

        // If message failed to send, check if partner is still in running chats
        if (!matchSent) {
          // Check if partner is still in running chats (they haven't left)
          const partnerStillThere = bot.runningChats.has(match.id);
          
          if (partnerStillThere) {
            // Partner is still there - maybe network issue, try to notify and let them continue waiting
            await sendMessageWithRetry(bot, match.id, "⚠️ Connection issue. Please wait...", { parse_mode: "Markdown" });
            
            // Add current user back to queue to find another partner
            const currentGender = await getGender(userId);
            bot.waitingQueue.push({ id: userId, preference, gender: currentGender || "any", isPremium } as any);
            
            return ctx.reply("⚠️ Temporary connection issue with partner. You've been added back to the queue...\n⏳ Waiting for a new partner...");
          } else {
            // Partner has actually left
            endChatDueToError(bot, userId, match.id);
            return ctx.reply("🚫 Could not connect to partner. They may have left or restricted the bot.");
          }
        }

        return ctx.reply(userPartnerInfo);
      }

      // No match, add to queue
      bot.waitingQueue.push({ id: userId, preference, gender: gender || "any", isPremium } as WaitingUser);
      return ctx.reply("⏳ Waiting for a partner...");
    } finally {
      bot.chatMutex.release();
    }
  }
};
