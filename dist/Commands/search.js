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
            const matchIndex = bot.waitingQueue.findIndex(waiting => {
                const w = waiting;
                if (matchPreference) {
                    // Premium user with specific preference - only match with that gender
                    return w.gender === matchPreference;
                }
                else {
                    // Normal user or "any" preference - match with anyone
                    return true;
                }
            });
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
                // If message failed to send (partner blocked/removed bot), end the chat
                if (!matchSent) {
                    (0, telegramErrorHandler_1.endChatDueToError)(bot, userId, match.id);
                    return ctx.reply("🚫 Could not connect to partner. They may have left or restricted the bot.");
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
