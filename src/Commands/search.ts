import { Context, Markup } from "telegraf";
import { ExtraTelegraf } from "..";
import { getGender, getUser, updateUser } from "../storage/db";
import { sendMessageWithRetry, endChatDueToError } from "../Utils/telegramErrorHandler";

// Setup keyboards for forced setup
const setupGenderKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("👨 Male", "SETUP_GENDER_MALE")],
    [Markup.button.callback("👩 Female", "SETUP_GENDER_FEMALE")]
]);

const setupAgeKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("13-17", "SETUP_AGE_13_17")],
    [Markup.button.callback("18-25", "SETUP_AGE_18_25")],
    [Markup.button.callback("26-40", "SETUP_AGE_26_40")],
    [Markup.button.callback("40+", "SETUP_AGE_40_PLUS")],
    [Markup.button.callback("📝 Type Age", "SETUP_AGE_MANUAL")]
]);

const setupStateKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🟢 Telangana", "SETUP_STATE_TELANGANA")],
    [Markup.button.callback("🔵 Andhra Pradesh", "SETUP_STATE_AP")],
    [Markup.button.callback("🇮🇳 Other Indian State", "SETUP_STATE_OTHER")],
    [Markup.button.callback("🌍 Outside India", "SETUP_COUNTRY_OTHER")]
]);

// Type for users in waiting queue
interface WaitingUser {
  id: number;
  preference: string;
  gender: string;
  isPremium: boolean;
}

// Function to redirect user to complete setup
async function redirectToSetup(ctx: Context) {
    if (!ctx.from) return;
    
    const user = await getUser(ctx.from.id);
    
    if (!user.gender) {
        return ctx.reply(
            "📝 *Setup Required*\n\n" +
            "⚠️ You must complete your profile before searching for a partner.\n\n" +
            "👤 *Step 1 of 3*\n" +
            "Select your gender:",
            { parse_mode: "Markdown", ...setupGenderKeyboard }
        );
    } else if (!user.age) {
        return ctx.reply(
            "📝 *Setup Required*\n\n" +
            "⚠️ You must complete your profile before searching for a partner.\n\n" +
            "👤 *Step 2 of 3*\n" +
            "🎂 *Select your age range:*\n" +
            "(This helps us match you with people in similar age groups)",
            { parse_mode: "Markdown", ...setupAgeKeyboard }
        );
    } else if (!user.state) {
        return ctx.reply(
            "📝 *Setup Required*\n\n" +
            "⚠️ You must complete your profile before searching for a partner.\n\n" +
            "👤 *Step 3 of 3*\n" +
            "📍 *Select your location:*\n" +
            "(Helps match you with nearby people)",
            { parse_mode: "Markdown", ...setupStateKeyboard }
        );
    }
    
    return null; // Setup is complete
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
    
    // Check if user has completed setup (gender, age, state)
    const user = await getUser(userId);
    if (!user.gender || !user.age || !user.state) {
        return redirectToSetup(ctx);
    }

    // Acquire mutex to prevent race conditions
    await bot.queueMutex.acquire();

    try {
      // User already fetched above, use that data
      const gender = user.gender;
      const preference = user.preference || "any";
      const isPremium = user.premium || false;
      
      if (bot.runningChats.includes(userId)) {
        return ctx.reply(
          "You are already in a chat!\n\nUse /end to leave the chat or use /next to skip the current chat."
        );
      }

      // Check if already in queue
      if (bot.waitingQueue.some(w => w.id === userId)) {
        return ctx.reply("You are already in the queue!");
      }

      // SIMPLIFIED MATCHING LOGIC:
      // - Normal users (non-premium): preference is locked to "any" → match with BOTH genders randomly
      // - Premium users: can set preference → match ONLY with preferred gender
      // If user is premium AND has specific preference, match only with that gender
      // Otherwise (free user or "any" preference), match with anyone
      const matchPreference = (isPremium && preference !== "any") ? preference : null;

      // Find a compatible match from the queue
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

        // If message failed to send, check if partner is still in running chats
        // They might have network issues, but we can try to reconnect
        if (!matchSent) {
          // Check if partner is still in running chats (they haven't left)
          const partnerStillThere = bot.runningChats.includes(match.id);
          
          if (partnerStillThere) {
            // Partner is still there - maybe network issue, try to notify and let them continue waiting
            // Don't end the chat completely, just notify the current user
            await sendMessageWithRetry(bot, match.id, "⚠️ Connection issue. Please wait...", { parse_mode: "Markdown" });
            
            // Add current user back to queue to find another partner
            bot.waitingQueue.push({ id: userId, preference, gender, isPremium } as WaitingUser);
            
            return ctx.reply("⚠️ Temporary connection issue with partner. You've been added back to the queue...\n⏳ Waiting for a new partner...");
          } else {
            // Partner has actually left (was removed from running chats by cleanup)
            endChatDueToError(bot, userId, match.id);
            return ctx.reply("🚫 Could not connect to partner. They may have left or restricted the bot.");
          }
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
