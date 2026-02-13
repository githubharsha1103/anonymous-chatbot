"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const telegraf_1 = require("telegraf");
const db_1 = require("../storage/db");
const telegramErrorHandler_1 = require("../Utils/telegramErrorHandler");
// Setup keyboards for forced setup
const setupGenderKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("👨 Male", "SETUP_GENDER_MALE")],
    [telegraf_1.Markup.button.callback("👩 Female", "SETUP_GENDER_FEMALE")]
]);
const setupAgeKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("13-17", "SETUP_AGE_13_17")],
    [telegraf_1.Markup.button.callback("18-25", "SETUP_AGE_18_25")],
    [telegraf_1.Markup.button.callback("26-40", "SETUP_AGE_26_40")],
    [telegraf_1.Markup.button.callback("40+", "SETUP_AGE_40_PLUS")],
    [telegraf_1.Markup.button.callback("📝 Type Age", "SETUP_AGE_MANUAL")]
]);
const setupStateKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("🟢 Telangana", "SETUP_STATE_TELANGANA")],
    [telegraf_1.Markup.button.callback("🔵 Andhra Pradesh", "SETUP_STATE_AP")],
    [telegraf_1.Markup.button.callback("🇮🇳 Other Indian State", "SETUP_STATE_OTHER")],
    [telegraf_1.Markup.button.callback("🌍 Outside India", "SETUP_COUNTRY_OTHER")]
]);
// Group join keyboard
const GROUP_INVITE_LINK = process.env.GROUP_INVITE_LINK || "https://t.me/teluguanomychat";
const groupJoinKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.url("📢 Join Our Group", GROUP_INVITE_LINK)],
    [telegraf_1.Markup.button.callback("✅ I've Joined", "VERIFY_GROUP_JOIN")]
]);
// Function to redirect user to complete setup
function redirectToSetup(ctx) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!ctx.from)
            return;
        const user = yield (0, db_1.getUser)(ctx.from.id);
        if (!user.gender) {
            return ctx.reply("📝 *Setup Required*\n\n" +
                "⚠️ You must complete your profile before searching for a partner.\n\n" +
                "👤 *Step 1 of 3*\n" +
                "Select your gender:", Object.assign({ parse_mode: "Markdown" }, setupGenderKeyboard));
        }
        else if (!user.age) {
            return ctx.reply("📝 *Setup Required*\n\n" +
                "⚠️ You must complete your profile before searching for a partner.\n\n" +
                "👤 *Step 2 of 3*\n" +
                "🎂 *Select your age range:*\n" +
                "(This helps us match you with people in similar age groups)", Object.assign({ parse_mode: "Markdown" }, setupAgeKeyboard));
        }
        else if (!user.state) {
            return ctx.reply("📝 *Setup Required*\n\n" +
                "⚠️ You must complete your profile before searching for a partner.\n\n" +
                "👤 *Step 3 of 3*\n" +
                "📍 *Select your location:*\n" +
                "(Helps match you with nearby people)", Object.assign({ parse_mode: "Markdown" }, setupStateKeyboard));
        }
        return null; // Setup is complete
    });
}
// Function to check if user is group member (re-verifies on each search for security)
function isUserGroupMember(bot, userId) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID || "-1001234567890";
            // Use GROUP_CHAT_ID directly - Telegram API requires numeric chat ID
            const chatMember = yield bot.telegram.getChatMember(GROUP_CHAT_ID, userId);
            const validStatuses = ['creator', 'administrator', 'member', 'restricted'];
            return validStatuses.includes(chatMember.status);
        }
        catch (error) {
            console.error(`[GroupCheck] - Error checking group membership for user ${userId}:`, error);
            return false;
        }
    });
}
exports.default = {
    name: "search",
    description: "Search for a chat",
    execute: (ctx, bot) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const userId = (_a = ctx.from) === null || _a === void 0 ? void 0 : _a.id;
        // Check rate limit
        if (bot.isRateLimited(userId)) {
            return ctx.reply("⏳ Please wait a moment before searching again.");
        }
        // Check queue size limit
        if (bot.isQueueFull()) {
            return ctx.reply("🚫 Queue is full. Please try again later.");
        }
        // Check if user has completed setup (gender, age, state)
        const user = yield (0, db_1.getUser)(userId);
        if (!user.gender || !user.age || !user.state) {
            return redirectToSetup(ctx);
        }
        // Check if user has joined the required group (re-verify for security)
        const hasJoined = user.hasJoinedGroup === true && (yield isUserGroupMember(bot, userId));
        if (!hasJoined) {
            // Update database to remove verified status if they're no longer in group
            yield (0, db_1.updateUser)(userId, { hasJoinedGroup: false });
            return ctx.reply("📢 *Group Membership Required*\n\n" +
                "🔒 You must join our group before you can search for chat partners.\n\n" +
                "📢 Click the link below to join:\n" +
                GROUP_INVITE_LINK + "\n\n" +
                "After joining, click /start to verify and unlock all features!", Object.assign({ parse_mode: "Markdown" }, groupJoinKeyboard));
        }
        // Acquire mutex to prevent race conditions
        yield bot.queueMutex.acquire();
        try {
            // User already fetched above, use that data
            const gender = user.gender;
            const preference = user.preference || "any";
            const isPremium = user.premium || false;
            if (bot.runningChats.includes(userId)) {
                return ctx.reply("You are already in a chat!\n\nUse /end to leave the chat or use /next to skip the current chat.");
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
            // We fetch fresh user data from DB to ensure preferences are up-to-date
            let matchIndex = -1;
            for (let i = 0; i < bot.waitingQueue.length; i++) {
                const w = bot.waitingQueue[i];
                // Fetch fresh user data for the waiting user
                const waitingUserData = yield (0, db_1.getUser)(w.id);
                // Check if waiting user's gender matches current user's preference
                const genderMatches = !matchPreference || (waitingUserData.gender || "any") === matchPreference;
                // Check if current user's gender matches waiting user's preference
                const waitingPref = waitingUserData.preference || "any";
                const preferenceMatches = waitingPref === "any" || waitingPref === gender;
                if (genderMatches && preferenceMatches) {
                    matchIndex = i;
                    break;
                }
            }
            if (matchIndex !== -1) {
                const match = bot.waitingQueue[matchIndex];
                const matchUser = yield (0, db_1.getUser)(match.id);
                bot.waitingQueue.splice(matchIndex, 1);
                bot.runningChats.push(match.id, userId);
                // Store last partner for both users
                yield (0, db_1.updateUser)(userId, { lastPartner: match.id });
                yield (0, db_1.updateUser)(match.id, { lastPartner: userId });
                // Store chat start time for media restriction (2 minutes)
                const chatStartTime = Date.now();
                yield (0, db_1.updateUser)(userId, { chatStartTime });
                yield (0, db_1.updateUser)(match.id, { chatStartTime });
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
                const userPartnerInfo = `✅ Partner Matched

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
                const matchPartnerInfo = `✅ Partner Matched

🔢 Age: ${user.age || "Not Set"}
👥 Gender: ${matchUserGender}
🌍 Country: 🇮🇳 India${user.state ? ` - ${user.state.charAt(0).toUpperCase() + user.state.slice(1)}` : ""}

🚫 Links are restricted
⏱️ Media sharing unlocked after 2 minutes

/end — Leave the chat`;
                // Use sendMessageWithRetry to handle blocked partners
                const matchSent = yield (0, telegramErrorHandler_1.sendMessageWithRetry)(bot, match.id, matchPartnerInfo);
                // If message failed to send, check if partner is still in running chats
                // They might have network issues, but we can try to reconnect
                if (!matchSent) {
                    // Check if partner is still in running chats (they haven't left)
                    const partnerStillThere = bot.runningChats.includes(match.id);
                    if (partnerStillThere) {
                        // Partner is still there - maybe network issue, try to notify and let them continue waiting
                        // Don't end the chat completely, just notify the current user
                        yield (0, telegramErrorHandler_1.sendMessageWithRetry)(bot, match.id, "⚠️ Connection issue. Please wait...", { parse_mode: "Markdown" });
                        // Add current user back to queue to find another partner
                        bot.waitingQueue.push({ id: userId, preference, gender, isPremium });
                        return ctx.reply("⚠️ Temporary connection issue with partner. You've been added back to the queue...\n⏳ Waiting for a new partner...");
                    }
                    else {
                        // Partner has actually left (was removed from running chats by cleanup)
                        (0, telegramErrorHandler_1.endChatDueToError)(bot, userId, match.id);
                        return ctx.reply("🚫 Could not connect to partner. They may have left or restricted the bot.");
                    }
                }
                return ctx.reply(userPartnerInfo);
            }
            // No match found, add to queue
            bot.waitingQueue.push({ id: userId, preference, gender, isPremium });
            bot.waiting = userId;
            return ctx.reply("⏳ Waiting for a partner...");
        }
        finally {
            // Always release the mutex
            bot.queueMutex.release();
        }
    })
};
