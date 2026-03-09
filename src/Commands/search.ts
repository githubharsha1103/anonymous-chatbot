import { Context, Markup } from "telegraf";
import { ExtraTelegraf } from "..";
import { getUser, updateUser, incDaily, checkAndResetDaily } from "../storage/db";
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

export async function redirectToSetup(ctx: Context) {
    if (!ctx.from) return null;
    
    try {
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
    } catch (error) {
        console.error("[redirectToSetup] Error fetching user:", error);
        return ctx.reply("⚠️ An error occurred. Please try again.");
    }
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

    // Keep queue Set and array synchronized for reliable queue checks/matching
    if (bot.queueSet.size !== bot.waitingQueue.length) {
      bot.queueSet.clear();
      for (const queued of bot.waitingQueue) {
        bot.queueSet.add(queued.id);
      }
    }

    // Check queue size limit
    if (bot.isQueueFull()) {
      return ctx.reply("🚫 Queue is full. Please try again later.");
    }
    
    // Enforce queue size limit by removing oldest if approaching limit
    const MAX_QUEUE_SOFT_LIMIT = 9500; // Start removing at 95% capacity
    if (bot.waitingQueue.length > MAX_QUEUE_SOFT_LIMIT) {
      const removeCount = bot.waitingQueue.length - MAX_QUEUE_SOFT_LIMIT;
      // Remove oldest entries (from the beginning of the array)
      bot.waitingQueue = bot.waitingQueue.slice(removeCount);
      bot.queueSet.clear();
      for (const queued of bot.waitingQueue) {
        bot.queueSet.add(queued.id);
      }
      console.log(`[QUEUE] - Queue size limit enforced, removed ${removeCount} oldest users`);
    }
    
    // Check if user has completed setup (gender, age, state)
    const user = await getUser(userId);
    if (!user.gender || !user.age || !user.state) {
        return redirectToSetup(ctx);
    }
    
    // Check daily chat limit for non-premium users
    const canChat = await checkAndResetDaily(userId);
    if (!canChat) {
        return ctx.reply(
            "⏰ *Daily chat limit reached!*\n\n" +
            "You've used all 100 free chats for today.\n\n" +
            "💎 *Upgrade to Premium for unlimited chats!*/settings",
            { parse_mode: "Markdown" }
        );
    }
    
    // Group join is now optional - user can search without joining the group
    // Proceed with search - no group verification needed

    // Acquire mutex to prevent race conditions in matchmaking
    try {
        await bot.matchMutex.acquire();
    } catch (error) {
        console.error("[Search command] Mutex acquisition failed:", error);
        return ctx.reply("⚠️ Server is busy. Please try again in a moment.");
    }

    try {
      // User already fetched above, use that data
      const gender = user.gender;
      const preference = user.preference || "any";
      const isPremium = user.premium || false;
      
      if (bot.runningChats.has(userId)) {
        return ctx.reply(
          "You are already in a chat!\n\nUse /end to leave the chat or use /next to skip the current chat."
        );
      }

      // Check if already in queue
      if (bot.isInQueue(userId)) {
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
      // We use data cached in the queue entry to avoid excessive DB calls.
      let matchIndex = -1;
      for (let i = 0; i < bot.waitingQueue.length; i++) {
        const w = bot.waitingQueue[i] as WaitingUser;
        if (!bot.queueSet.has(w.id)) continue;
        
        // Use stored gender/preference to evaluate compatibility
        const waitingGender = w.gender || "any";
        const waitingPref = w.preference || "any";
        
        // Check if waiting user's gender matches current user's preference
        const genderMatches = !matchPreference || waitingGender === matchPreference;
        
        // Check if current user's gender matches waiting user's preference
        const preferenceMatches = waitingPref === "any" || waitingPref === gender;
        
        if (genderMatches && preferenceMatches) {
          matchIndex = i;
          break;
        }
      }

      if (matchIndex !== -1) {
        const match = bot.waitingQueue[matchIndex] as WaitingUser;
        bot.waitingQueue.splice(matchIndex, 1);
        bot.queueSet.delete(match.id);

        bot.runningChats.set(match.id, userId);
        bot.runningChats.set(userId, match.id);

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

        // fetch match user's profile for display
        const matchUser = await getUser(match.id);

        // Increment chat count
        bot.incrementChatCount();
        
        // Increment daily chat count for both matched users (non-premium only)
        await incDaily(userId);
        await incDaily(match.id);

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
          const partnerStillThere = bot.runningChats.has(match.id);
          
          if (partnerStillThere) {
            // Partner is still there - treat this as a failed match and cleanly end chat state first
            await endChatDueToError(bot, userId, match.id);
            
            // Add current user back to queue to find another partner
            const requeued = bot.addToQueueAtomic({ id: userId, preference, gender, isPremium });
            if (!requeued) {
              return ctx.reply("⚠️ Temporary connection issue. Please try /search again.");
            }
            
            return ctx.reply("⚠️ Temporary connection issue with partner. You've been added back to the queue...\n⏳ Waiting for a new partner...");
          } else {
            // Partner has actually left (was removed from running chats by cleanup)
            await endChatDueToError(bot, userId, match.id);
            return ctx.reply("🚫 Could not connect to partner. They may have left or restricted the bot.");
          }
        }

        return ctx.reply(userPartnerInfo);
      }

      // No match found, add to queue
      const added = bot.addToQueueAtomic({ id: userId, preference, gender, isPremium });
      if (!added) {
        return ctx.reply("You are already in the queue!");
      }
      return ctx.reply("⏳ Waiting for a partner...");
    } finally {
      // Always release the mutex
      bot.matchMutex.release();
    }
  }
};
