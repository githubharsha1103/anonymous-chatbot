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
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadActions = loadActions;
const glob_1 = require("glob");
const index_1 = require("../index");
const telegraf_1 = require("telegraf");
const db_1 = require("../storage/db");
const telegramErrorHandler_1 = require("./telegramErrorHandler");
function loadActions() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const Files = yield (0, glob_1.glob)(`${process.cwd()}/dist/Commands/**/*.js`);
            for (let file of Files) {
                // Ensure absolute path for require
                const absolutePath = require("path").resolve(file);
                const actionFile = require(absolutePath).default;
                // Skip if not a valid action (command files don't have 'execute' as async action handler)
                if (!actionFile || typeof actionFile !== 'object')
                    continue;
                const action = actionFile;
                if (action.disabled)
                    continue;
                const actionName = action.name;
                if (!actionName || typeof actionName === 'string' && (actionName === 'start' || actionName === 'help' || actionName === 'search' || actionName === 'next' || actionName === 'end' || actionName === 'settings' || actionName === 'report' || actionName === 'adminaccess' || actionName === 'ping' || actionName === 'find' || actionName === 'setgender' || actionName === 'ban' || actionName === 'broadcast' || actionName === 'active'))
                    continue;
                try {
                    index_1.bot.action(actionName, (ctx) => __awaiter(this, void 0, void 0, function* () {
                        var _a;
                        try {
                            yield action.execute(ctx, index_1.bot);
                        }
                        catch (err) {
                            const userId = (_a = ctx.from) === null || _a === void 0 ? void 0 : _a.id;
                            (0, telegramErrorHandler_1.handleTelegramError)(index_1.bot, err, userId);
                        }
                    }));
                }
                catch (error) {
                    console.error(`[ActionHandler] -`, error);
                }
            }
            console.info(`[INFO] - Actions Loaded`);
        }
        catch (err) {
            console.error(`[ActionHandler] -`, err);
        }
    });
}
// Inline keyboard helpers
const genderKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("👨 Male", "GENDER_MALE")],
    [telegraf_1.Markup.button.callback("👩 Female", "GENDER_FEMALE")],
    [telegraf_1.Markup.button.callback("🔙 Back", "OPEN_SETTINGS")]
]);
const stateKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("Telangana", "STATE_TELANGANA")],
    [telegraf_1.Markup.button.callback("Andhra Pradesh", "STATE_AP")],
    [telegraf_1.Markup.button.callback("🔙 Back", "OPEN_SETTINGS")]
]);
const backKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("🔙 Back", "OPEN_SETTINGS")]
]);
const preferenceKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("👨 Male", "PREF_MALE")],
    [telegraf_1.Markup.button.callback("👩 Female", "PREF_FEMALE")],
    [telegraf_1.Markup.button.callback("🔙 Back", "OPEN_SETTINGS")]
]);
const premiumMessage = "⭐ *Premium Feature*\n\n" +
    "Gender preference is available only for Premium users.\n\n" +
    "To unlock this feature, please contact the admin @demonhunter1511 to purchase Premium access.";
const mainMenuKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("🔍 Search", "START_SEARCH")],
    [telegraf_1.Markup.button.callback("⚙️ Settings", "OPEN_SETTINGS")],
    [telegraf_1.Markup.button.callback("❓ Help", "START_HELP")]
]);
// Group verification settings
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID || "-1001234567890";
const GROUP_INVITE_LINK = process.env.GROUP_INVITE_LINK || "https://t.me/teluguanomychat";
// Cache for resolved chat ID
let resolvedChatId = null;
// Keyboard for group join verification
const groupJoinKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.url("📢 Join Our Group", GROUP_INVITE_LINK)],
    [telegraf_1.Markup.button.callback("✅ I've Joined", "VERIFY_GROUP_JOIN")]
]);
// Check if user is a member of the group
function isUserGroupMember(userId) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // Use GROUP_CHAT_ID directly - Telegram API requires numeric chat ID
            const chatId = GROUP_CHAT_ID;
            const chatMember = yield index_1.bot.telegram.getChatMember(chatId, userId);
            // Member status: 'creator', 'administrator', 'member', 'restricted' are valid
            const validStatuses = ['creator', 'administrator', 'member', 'restricted'];
            return validStatuses.includes(chatMember.status);
        }
        catch (error) {
            console.error(`[GroupCheck] - Error checking group membership for user ${userId}:`, error);
            return false;
        }
    });
}
// Safe answerCallbackQuery helper
function safeAnswerCbQuery(ctx, text) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            if ((_a = ctx.callbackQuery) === null || _a === void 0 ? void 0 : _a.id) {
                yield ctx.answerCbQuery(text);
            }
        }
        catch (_b) {
            // Query too old or invalid, ignore
        }
    });
}
// Safe editMessageText helper - handles "message not modified" errors
function safeEditMessageText(ctx, text, extra) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield ctx.editMessageText(text, extra);
        }
        catch (error) {
            // Ignore "message not modified" errors (400 Bad Request)
            if (error.description && error.description.includes("message is not modified")) {
                // Message already edited, ignore
            }
            else {
                throw error; // Re-throw other errors
            }
        }
    });
}
// Function to show settings menu
function showSettings(ctx) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        if (!ctx.from)
            return;
        const u = yield (0, db_1.getUser)(ctx.from.id);
        const referralCount = yield (0, db_1.getReferralCount)(ctx.from.id);
        const text = `⚙ Settings

👤 Gender: ${(_a = u.gender) !== null && _a !== void 0 ? _a : "Not Set"}
🎂 Age: ${(_b = u.age) !== null && _b !== void 0 ? _b : "Not Set"}
📍 State: ${(_c = u.state) !== null && _c !== void 0 ? _c : "Not Set"}
💕 Preference: ${u.premium ? (u.preference === "any" ? "Any" : u.preference === "male" ? "Male" : "Female") : "🔒 Premium Only"}
💎 Premium: ${u.premium ? "Yes ✅" : "No ❌"}
💬 Daily chats left: ${100 - (u.daily || 0)}/100
👥 Referrals: ${referralCount}/30

Use buttons below to update:`;
        const keyboard = telegraf_1.Markup.inlineKeyboard([
            [telegraf_1.Markup.button.callback("👤 Gender", "SET_GENDER")],
            [telegraf_1.Markup.button.callback("🎂 Age", "SET_AGE")],
            [telegraf_1.Markup.button.callback("📍 State", "SET_STATE")],
            [telegraf_1.Markup.button.callback("💕 Preference", "SET_PREFERENCE")],
            [telegraf_1.Markup.button.callback("🎁 Referrals", "OPEN_REFERRAL")],
            [telegraf_1.Markup.button.callback("⭐ Premium", "BUY_PREMIUM")]
        ]);
        // Try to edit, if fails (same content), send new message
        try {
            yield ctx.editMessageText(text, keyboard);
        }
        catch (error) {
            if (!((_d = error.description) === null || _d === void 0 ? void 0 : _d.includes("message is not modified"))) {
                yield safeAnswerCbQuery(ctx);
                yield ctx.reply(text, keyboard);
            }
        }
    });
}
// Open settings
index_1.bot.action("OPEN_SETTINGS", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield safeAnswerCbQuery(ctx);
    yield showSettings(ctx);
}));
// Start menu actions
index_1.bot.action("START_SEARCH", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield safeAnswerCbQuery(ctx);
    // Trigger search command
    const searchCommand = require("../Commands/search").default;
    yield searchCommand.execute(ctx, index_1.bot);
}));
index_1.bot.action("START_HELP", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield safeAnswerCbQuery(ctx);
    yield ctx.reply("📚 *Available Commands:*\n\n" +
        "/start - Start the bot\n" +
        "/search - Find a chat partner\n" +
        "/next - Skip current chat and find new partner\n" +
        "/end - End the current chat\n" +
        "/settings - Open settings menu\n" +
        "/report - Report a user\n" +
        "/help - Show this help message", { parse_mode: "Markdown" });
}));
// ==============================
// NEW USER SETUP HANDLERS
// ==============================
// Setup age manual input keyboard (NO BACK/CANCEL - must complete)
const setupAgeManualKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("⬅️ Back", "SETUP_BACK_AGE")]
]);
// Welcome back handler
index_1.bot.action("WELCOME_BACK", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    if (!ctx.from)
        return;
    yield safeAnswerCbQuery(ctx);
    yield safeEditMessageText(ctx, "🌟 *Welcome to Anonymous Chat!* 🌟\n\n" +
        "✨ Connect with strangers anonymously\n" +
        "🔒 Your privacy is protected\n" +
        "💬 Chat freely and safely\n\n" +
        "Tap *Get Started* to begin!", Object.assign({ parse_mode: "Markdown" }, telegraf_1.Markup.inlineKeyboard([
        [telegraf_1.Markup.button.callback("🌟 Get Started", "SETUP_GENDER_MALE")]
    ])));
}));
// Setup gender keyboard with NO BACK/CANCEL - must complete setup
const setupGenderKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("👨 Male", "SETUP_GENDER_MALE")],
    [telegraf_1.Markup.button.callback("👩 Female", "SETUP_GENDER_FEMALE")]
]);
// Setup age keyboard with ranges and manual input option (NO BACK/CANCEL)
const setupAgeKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("13-17", "SETUP_AGE_13_17")],
    [telegraf_1.Markup.button.callback("18-25", "SETUP_AGE_18_25")],
    [telegraf_1.Markup.button.callback("26-40", "SETUP_AGE_26_40")],
    [telegraf_1.Markup.button.callback("40+", "SETUP_AGE_40_PLUS")],
    [telegraf_1.Markup.button.callback("📝 Type Age", "SETUP_AGE_MANUAL")]
]);
// Setup state keyboard (NO BACK/CANCEL - must complete)
const setupStateKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("🟢 Telangana", "SETUP_STATE_TELANGANA")],
    [telegraf_1.Markup.button.callback("🔵 Andhra Pradesh", "SETUP_STATE_AP")],
    [telegraf_1.Markup.button.callback("🇮🇳 Other Indian State", "SETUP_STATE_OTHER")],
    [telegraf_1.Markup.button.callback("🌍 Outside India", "SETUP_COUNTRY_OTHER")]
]);
// Gender selected - move to age input
index_1.bot.action("SETUP_GENDER_MALE", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    if (!ctx.from)
        return;
    yield safeAnswerCbQuery(ctx);
    yield (0, db_1.updateUser)(ctx.from.id, { gender: "male", setupStep: "age" });
    yield safeEditMessageText(ctx, "📝 *Step 2 of 3*\n\n" +
        "🎂 *Select your age range:*\n" +
        "(This helps us match you with people in similar age groups)", Object.assign({ parse_mode: "Markdown" }, setupAgeKeyboard));
}));
index_1.bot.action("SETUP_GENDER_FEMALE", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    if (!ctx.from)
        return;
    yield safeAnswerCbQuery(ctx);
    yield (0, db_1.updateUser)(ctx.from.id, { gender: "female", setupStep: "age" });
    yield safeEditMessageText(ctx, "📝 *Step 2 of 3*\n\n" +
        "🎂 *Select your age range:*\n" +
        "(This helps us match you with people in similar age groups)", Object.assign({ parse_mode: "Markdown" }, setupAgeKeyboard));
}));
// Age range selected - ask for state
const ageToGenderMap = {
    "SETUP_AGE_13_17": "13-17",
    "SETUP_AGE_18_25": "18-25",
    "SETUP_AGE_26_40": "26-40",
    "SETUP_AGE_40_PLUS": "40+"
};
for (const [action, ageLabel] of Object.entries(ageToGenderMap)) {
    index_1.bot.action(action, (ctx) => __awaiter(void 0, void 0, void 0, function* () {
        if (!ctx.from)
            return;
        yield safeAnswerCbQuery(ctx);
        yield (0, db_1.updateUser)(ctx.from.id, { age: ageLabel, setupStep: "state" });
        yield safeEditMessageText(ctx, "📝 *Step 3 of 3*\n\n" +
            "📍 *Select your location:*\n" +
            "(Helps match you with nearby people)", Object.assign({ parse_mode: "Markdown" }, setupStateKeyboard));
    }));
}
// Manual age input - ask user to type their age
index_1.bot.action("SETUP_AGE_MANUAL", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    if (!ctx.from)
        return;
    yield safeAnswerCbQuery(ctx);
    yield safeEditMessageText(ctx, "📝 *Enter your age:*\n\n" +
        "Please type a number between 13 and 80\n" +
        "(e.g., 21)", Object.assign({ parse_mode: "Markdown" }, setupAgeManualKeyboard));
}));
// State selected - complete setup
index_1.bot.action("SETUP_STATE_TELANGANA", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    if (!ctx.from)
        return;
    yield safeAnswerCbQuery(ctx);
    yield (0, db_1.updateUser)(ctx.from.id, { state: "Telangana", setupStep: "done" });
    yield showSetupComplete(ctx);
}));
index_1.bot.action("SETUP_STATE_AP", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    if (!ctx.from)
        return;
    yield safeAnswerCbQuery(ctx);
    yield (0, db_1.updateUser)(ctx.from.id, { state: "Andhra Pradesh", setupStep: "done" });
    yield showSetupComplete(ctx);
}));
index_1.bot.action("SETUP_STATE_OTHER", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    if (!ctx.from)
        return;
    yield safeAnswerCbQuery(ctx);
    yield (0, db_1.updateUser)(ctx.from.id, { setupStep: "state_other" });
    yield safeEditMessageText(ctx, "📍 *Enter your state:*\n\n" +
        "(e.g., Karnataka, Tamil Nadu, Maharashtra, etc.)", Object.assign({ parse_mode: "Markdown" }, telegraf_1.Markup.inlineKeyboard([
        [telegraf_1.Markup.button.callback("⬅️ Back", "SETUP_BACK_STATE")]
    ])));
}));
index_1.bot.action("SETUP_COUNTRY_OTHER", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    if (!ctx.from)
        return;
    yield safeAnswerCbQuery(ctx);
    yield (0, db_1.updateUser)(ctx.from.id, { state: "Other", setupStep: "done" });
    yield showSetupComplete(ctx);
}));
// Back actions
index_1.bot.action("SETUP_BACK_GENDER", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield safeAnswerCbQuery(ctx);
    yield safeEditMessageText(ctx, "📝 *Step 1 of 3*\n" +
        "👤 *Select your gender:*", Object.assign({ parse_mode: "Markdown" }, setupGenderKeyboard));
}));
index_1.bot.action("SETUP_BACK_AGE", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield safeAnswerCbQuery(ctx);
    yield safeEditMessageText(ctx, "📝 *Step 2 of 3*\n\n" +
        "🎂 *Select your age range:*\n" +
        "(This helps us match you with people in similar age groups)", Object.assign({ parse_mode: "Markdown" }, setupAgeKeyboard));
}));
index_1.bot.action("SETUP_BACK_STATE", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield safeAnswerCbQuery(ctx);
    yield safeEditMessageText(ctx, "📝 *Step 3 of 3*\n\n" +
        "📍 *Select your location:*\n" +
        "(Helps match you with nearby people)", Object.assign({ parse_mode: "Markdown" }, setupStateKeyboard));
}));
// Cancel setup - redirect to complete setup instead of allowing cancel
index_1.bot.action("SETUP_CANCEL", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    if (!ctx.from)
        return;
    yield safeAnswerCbQuery(ctx);
    const user = yield (0, db_1.getUser)(ctx.from.id);
    // Check which step they're missing and redirect
    if (!user.gender) {
        yield safeEditMessageText(ctx, "📝 *Setup Required*\n\n" +
            "⚠️ You must complete your profile before using the bot.\n\n" +
            "👤 *Step 1 of 3*\n" +
            "Select your gender:", Object.assign({ parse_mode: "Markdown" }, setupGenderKeyboard));
    }
    else if (!user.age) {
        yield safeEditMessageText(ctx, "📝 *Setup Required*\n\n" +
            "⚠️ You must complete your profile before using the bot.\n\n" +
            "👤 *Step 2 of 3*\n" +
            "🎂 *Select your age range:*\n" +
            "(This helps us match you with people in similar age groups)", Object.assign({ parse_mode: "Markdown" }, setupAgeKeyboard));
    }
    else if (!user.state) {
        yield safeEditMessageText(ctx, "📝 *Setup Required*\n\n" +
            "⚠️ You must complete your profile before using the bot.\n\n" +
            "👤 *Step 3 of 3*\n" +
            "📍 *Select your location:*\n" +
            "(Helps match you with nearby people)", Object.assign({ parse_mode: "Markdown" }, setupStateKeyboard));
    }
    else {
        // Setup complete - show main menu
        yield safeEditMessageText(ctx, "🌟 *Welcome back!* 🌟\n\n" +
            "This bot helps you chat anonymously with people worldwide.\n\n" +
            "Use the menu below to navigate:", Object.assign({ parse_mode: "Markdown" }, mainMenuKeyboard));
    }
}));
// ==============================
// SETTINGS ACTIONS
// ==============================
// Gender actions
index_1.bot.action("SET_GENDER", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield safeAnswerCbQuery(ctx);
    yield safeEditMessageText(ctx, "Select your gender:", genderKeyboard);
}));
index_1.bot.action("GENDER_MALE", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    if (!ctx.from)
        return;
    yield (0, db_1.updateUser)(ctx.from.id, { gender: "male" });
    yield safeAnswerCbQuery(ctx, "Gender set to Male ✅");
    yield showSettings(ctx);
}));
index_1.bot.action("GENDER_FEMALE", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    if (!ctx.from)
        return;
    yield (0, db_1.updateUser)(ctx.from.id, { gender: "female" });
    yield safeAnswerCbQuery(ctx, "Gender set to Female ✅");
    yield showSettings(ctx);
}));
// Age actions
index_1.bot.action("SET_AGE", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield safeAnswerCbQuery(ctx);
    yield safeEditMessageText(ctx, "Please enter your age (13-80):", backKeyboard);
}));
// State actions
index_1.bot.action("SET_STATE", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield safeAnswerCbQuery(ctx);
    yield safeEditMessageText(ctx, "Select your state:", stateKeyboard);
}));
index_1.bot.action("STATE_TELANGANA", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    if (!ctx.from)
        return;
    yield (0, db_1.updateUser)(ctx.from.id, { state: "telangana" });
    yield safeAnswerCbQuery(ctx, "State set to Telangana ✅");
    yield showSettings(ctx);
}));
index_1.bot.action("STATE_AP", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    if (!ctx.from)
        return;
    yield (0, db_1.updateUser)(ctx.from.id, { state: "andhra pradesh" });
    yield safeAnswerCbQuery(ctx, "State set to Andhra Pradesh ✅");
    yield showSettings(ctx);
}));
// Preference action - available for all users, but only works for premium
index_1.bot.action("SET_PREFERENCE", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield safeAnswerCbQuery(ctx);
    yield safeEditMessageText(ctx, "Select your gender preference:", preferenceKeyboard);
}));
// Premium check for preference selection
index_1.bot.action("PREF_MALE", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    if (!ctx.from)
        return;
    const user = yield (0, db_1.getUser)(ctx.from.id);
    if (!user.premium) {
        yield safeAnswerCbQuery(ctx);
        return ctx.reply(premiumMessage, { parse_mode: "Markdown" });
    }
    yield safeAnswerCbQuery(ctx, "Preference saved: Male ✅");
    yield (0, db_1.updateUser)(ctx.from.id, { preference: "male" });
    yield showSettings(ctx);
}));
index_1.bot.action("PREF_FEMALE", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    if (!ctx.from)
        return;
    const user = yield (0, db_1.getUser)(ctx.from.id);
    if (!user.premium) {
        yield safeAnswerCbQuery(ctx);
        return ctx.reply(premiumMessage, { parse_mode: "Markdown" });
    }
    yield safeAnswerCbQuery(ctx, "Preference saved: Female ✅");
    yield (0, db_1.updateUser)(ctx.from.id, { preference: "female" });
    yield showSettings(ctx);
}));
// Buy premium action
index_1.bot.action("BUY_PREMIUM", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield safeAnswerCbQuery(ctx);
    yield ctx.reply("⭐ *Premium Features* 🔒\n\n" +
        "Upgrade to Premium to unlock:\n" +
        "• Set your chat preference (Male/Female/Any)\n" +
        "• Priority matching\n" +
        "• Unlimited daily chats\n" +
        "• And more!\n\n" +
        "Use /premium to upgrade!", { parse_mode: "Markdown" });
}));
// Open referral command
index_1.bot.action("OPEN_REFERRAL", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield safeAnswerCbQuery(ctx);
    const referralCommand = require("../Commands/referral").default;
    yield referralCommand.execute(ctx, index_1.bot);
}));
// ==============================
// REPORT SYSTEM
// ==============================
const reportReasons = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("🎭 Impersonating", "REPORT_IMPERSONATING")],
    [telegraf_1.Markup.button.callback("🔞 Sexual content", "REPORT_SEXUAL")],
    [telegraf_1.Markup.button.callback("💰 Fraud", "REPORT_FRAUD")],
    [telegraf_1.Markup.button.callback("😠 Insulting", "REPORT_INSULTING")],
    [telegraf_1.Markup.button.callback("🔙 Cancel", "REPORT_CANCEL")]
]);
const confirmKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("✅ Confirm Report", "REPORT_CONFIRM")],
    [telegraf_1.Markup.button.callback("🔙 Cancel", "REPORT_CANCEL")]
]);
const ADMINS = ((_a = process.env.ADMIN_IDS) === null || _a === void 0 ? void 0 : _a.split(",")) || [];
function isAdmin(id) {
    return ADMINS.includes(id.toString());
}
// Show report reasons
index_1.bot.action("OPEN_REPORT", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield safeAnswerCbQuery(ctx);
    if (!ctx.from)
        return;
    const user = yield (0, db_1.getUser)(ctx.from.id);
    let partnerId = user.reportingPartner || user.lastPartner;
    let message = "Select a reason to report:";
    if (!partnerId) {
        return safeEditMessageText(ctx, "No user to report. Start a chat first.", backKeyboard);
    }
    // Store the partner ID for reporting
    yield (0, db_1.updateUser)(ctx.from.id, { reportingPartner: partnerId });
    return ctx.editMessageText(message, reportReasons);
}));
// Report reason handlers
const reportReasonsMap = {
    "REPORT_IMPERSONATING": "Impersonating",
    "REPORT_SEXUAL": "Sexual content",
    "REPORT_FRAUD": "Fraud",
    "REPORT_INSULTING": "Insulting"
};
for (const [action, reason] of Object.entries(reportReasonsMap)) {
    index_1.bot.action(action, (ctx) => __awaiter(void 0, void 0, void 0, function* () {
        yield safeAnswerCbQuery(ctx);
        if (!ctx.from)
            return;
        const user = yield (0, db_1.getUser)(ctx.from.id);
        const partnerId = user.reportingPartner;
        if (!partnerId) {
            return safeEditMessageText(ctx, "No user to report.", backKeyboard);
        }
        // Store the report reason temporarily
        yield (0, db_1.updateUser)(ctx.from.id, { reportReason: reason });
        return ctx.editMessageText(`Report reason: ${reason}\n\nAre you sure you want to report this user?`, confirmKeyboard);
    }));
}
// Confirm report
index_1.bot.action("REPORT_CONFIRM", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield safeAnswerCbQuery(ctx);
    if (!ctx.from)
        return;
    const user = yield (0, db_1.getUser)(ctx.from.id);
    const partnerId = user.reportingPartner;
    const reportReason = user.reportReason;
    if (!partnerId || !reportReason) {
        return safeEditMessageText(ctx, "Report cancelled.", backKeyboard);
    }
    // Notify the reporter
    yield safeEditMessageText(ctx, "Thank you for reporting! 🙏", backKeyboard);
    // Send report to all admins
    const adminIds = ADMINS.map(id => parseInt(id));
    for (const adminId of adminIds) {
        try {
            yield ctx.telegram.sendMessage(adminId, `🚨 REPORT RECEIVED\n\n` +
                `Reporter: ${ctx.from.id}\n` +
                `Reported User: ${partnerId}\n` +
                `Reason: ${reportReason}\n` +
                `Time: ${new Date().toLocaleString()}`);
        }
        catch (_a) {
            // Admin might not exist, ignore
        }
    }
    // Clear report data
    yield (0, db_1.updateUser)(ctx.from.id, { reportingPartner: null, reportReason: null });
}));
// Cancel report
index_1.bot.action("REPORT_CANCEL", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield safeAnswerCbQuery(ctx);
    if (!ctx.from)
        return;
    // Clear report data
    yield (0, db_1.updateUser)(ctx.from.id, { reportingPartner: null, reportReason: null });
    return safeEditMessageText(ctx, "Report cancelled.", backKeyboard);
}));
// Show improved setup complete message with summary
function showSetupComplete(ctx) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (!ctx.from)
            return;
        const user = yield (0, db_1.getUser)(ctx.from.id);
        // Get display values
        const genderEmoji = user.gender === "male" ? "👨" : user.gender === "female" ? "👩" : "❓";
        const genderText = user.gender ? (user.gender.charAt(0).toUpperCase() + user.gender.slice(1)) : "Not Set";
        const stateText = user.state === "Other" ? "🌍 Other" : (user.state || "Not Set");
        // Check if user has joined the group
        const hasJoined = user.hasJoinedGroup === true;
        let text;
        let keyboard;
        if (hasJoined) {
            // User has joined group - show main menu
            text =
                `✨ *Profile Complete!* ✨\n\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `📋 *Your Profile:*\n\n` +
                    `${genderEmoji} *Gender:* ${genderText}\n` +
                    `🎂 *Age:* ${user.age || "Not Set"}\n` +
                    `📍 *Location:* ${stateText}\n\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `🎉 *You're all set to start chatting!*/search - Find a chat partner now\n` +
                    `⚙️ /settings - Update your profile anytime\n` +
                    `❓ /help - Get help with commands\n\n` +
                    `💡 *Tip:* Be friendly and respectful for the best experience!`;
            keyboard = mainMenuKeyboard;
        }
        else {
            // User hasn't joined group yet - show group join requirement
            text =
                `✨ *Profile Complete!* ✨\n\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `📋 *Your Profile:*\n\n` +
                    `${genderEmoji} *Gender:* ${genderText}\n` +
                    `🎂 *Age:* ${user.age || "Not Set"}\n` +
                    `📍 *Location:* ${stateText}\n\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `🎉 *Almost there!*\n\n` +
                    `📢 *Please join our group to start chatting!*\n\n` +
                    `This helps us keep the community safe and verified.\n\n` +
                    `Click the button below to join, then confirm!`;
            keyboard = groupJoinKeyboard;
        }
        `✨ *Profile Complete!* ✨

` +
            `━━━━━━━━━━━━━━━━━━━━\n\n` +
            `📋 *Your Profile:*\n\n` +
            `${genderEmoji} *Gender:* ${genderText}\n` +
            `🎂 *Age:* ${user.age || "Not Set"}\n` +
            `📍 *Location:* ${stateText}\n\n` +
            `━━━━━━━━━━━━━━━━━━━━\n\n` +
            `🎉 *You're all set to start chatting!*/search - Find a chat partner now\n` +
            `⚙️ /settings - Update your profile anytime\n` +
            `❓ /help - Get help with commands\n\n` +
            `💡 *Tip:* Be friendly and respectful for the best experience!`;
        try {
            yield ctx.editMessageText(text, Object.assign({ parse_mode: "Markdown" }, keyboard));
        }
        catch (error) {
            if (!((_a = error.description) === null || _a === void 0 ? void 0 : _a.includes("message is not modified"))) {
                yield safeAnswerCbQuery(ctx);
                yield ctx.reply(text, Object.assign({ parse_mode: "Markdown" }, keyboard));
            }
        }
    });
}
// Setup done - show main menu (same as setup complete)
index_1.bot.action("SETUP_DONE", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield safeAnswerCbQuery(ctx);
    yield showSetupComplete(ctx);
}));
// ========================================
// GROUP VERIFICATION SYSTEM
// ========================================
// User clicks "I've Joined" button - verify group membership
index_1.bot.action("VERIFY_GROUP_JOIN", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    if (!ctx.from)
        return;
    yield safeAnswerCbQuery(ctx);
    const userId = ctx.from.id;
    // Check if user is actually a member of the group
    const isMember = yield isUserGroupMember(userId);
    if (isMember) {
        // User joined - update database and show main menu
        yield (0, db_1.updateUser)(userId, { hasJoinedGroup: true });
        yield safeAnswerCbQuery(ctx, "✅ Welcome to the group! You can now start chatting!");
        yield showSetupComplete(ctx);
    }
    else {
        // User hasn't joined - show error
        yield safeAnswerCbQuery(ctx, "❌ You haven't joined the group yet! Please click the link to join.");
        // Re-show the group join message
        yield showSetupComplete(ctx);
    }
}));
// ========================================
// CHAT RATING SYSTEM
// ========================================
const ratingThankYouKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("🔍 Find New Partner", "START_SEARCH")],
    [telegraf_1.Markup.button.callback("⚙️ Settings", "OPEN_SETTINGS")]
]);
// Rate chat as Good
index_1.bot.action("RATE_GOOD", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    yield safeAnswerCbQuery(ctx, "We're glad you had a good experience! 😊");
    if (!ctx.from)
        return;
    const user = yield (0, db_1.getUser)(ctx.from.id);
    const text = `😊 *Thanks for your feedback!*\n\n` +
        `Great to hear you had a positive chat experience!\n\n` +
        `Your feedback helps us make the community better.`;
    try {
        yield ctx.editMessageText(text, Object.assign({ parse_mode: "Markdown" }, ratingThankYouKeyboard));
    }
    catch (error) {
        // Ignore "message not modified" errors
        if (!((_a = error.description) === null || _a === void 0 ? void 0 : _a.includes("message is not modified"))) {
            yield safeAnswerCbQuery(ctx, "We're glad you had a good experience! 😊");
        }
    }
    // Log positive feedback for admins
    console.log(`[RATING] User ${ctx.from.id} rated chat as GOOD`);
}));
// Rate chat as Okay
index_1.bot.action("RATE_OKAY", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    yield safeAnswerCbQuery(ctx, "Thanks for your feedback!");
    if (!ctx.from)
        return;
    const text = `😐 *Thanks for your feedback!*\n\n` +
        `We appreciate your honest rating.\n\n` +
        `If you have suggestions to improve, feel free to share them with the admin!`;
    try {
        yield ctx.editMessageText(text, Object.assign({ parse_mode: "Markdown" }, ratingThankYouKeyboard));
    }
    catch (error) {
        // Ignore "message not modified" errors
        if (!((_a = error.description) === null || _a === void 0 ? void 0 : _a.includes("message is not modified"))) {
            yield safeAnswerCbQuery(ctx, "Thanks for your feedback!");
        }
    }
    console.log(`[RATING] User ${ctx.from.id} rated chat as OKAY`);
}));
// Rate chat as Bad - prompt for report
const badRatingKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("🚨 Report User", "OPEN_REPORT")],
    [telegraf_1.Markup.button.callback("Skip", "RATE_SKIP")]
]);
index_1.bot.action("RATE_BAD", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    yield safeAnswerCbQuery(ctx, "We're sorry to hear that 😞");
    if (!ctx.from)
        return;
    const text = `😟 *We're sorry to hear that!*\n\n` +
        `We want to make this community safe for everyone.\n\n` +
        `Would you like to report the user for violating our guidelines? Your report is anonymous and helps us take action.`;
    try {
        yield ctx.editMessageText(text, Object.assign({ parse_mode: "Markdown" }, badRatingKeyboard));
    }
    catch (error) {
        // Ignore "message not modified" errors
        if (!((_a = error.description) === null || _a === void 0 ? void 0 : _a.includes("message is not modified"))) {
            yield safeAnswerCbQuery(ctx, "We're sorry to hear that 😞");
        }
    }
    console.log(`[RATING] User ${ctx.from.id} rated chat as BAD - potential report`);
}));
// Skip rating after bad experience
index_1.bot.action("RATE_SKIP", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    yield safeAnswerCbQuery(ctx);
    if (!ctx.from)
        return;
    const text = `💡 *No problem!*\n\n` +
        `Thanks for using our chat service.\n\n` +
        `Use /search to find a new partner anytime!`;
    try {
        yield ctx.editMessageText(text, Object.assign({ parse_mode: "Markdown" }, mainMenuKeyboard));
    }
    catch (error) {
        if (!((_a = error.description) === null || _a === void 0 ? void 0 : _a.includes("message is not modified"))) {
            yield ctx.reply(text, Object.assign({ parse_mode: "Markdown" }, mainMenuKeyboard));
        }
    }
}));
// End menu action (for END_MENU callback)
index_1.bot.action("END_MENU", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    yield safeAnswerCbQuery(ctx);
    if (!ctx.from)
        return;
    const text = `🌟 *Welcome back!*

Use the menu below to navigate:`;
    try {
        yield ctx.editMessageText(text, Object.assign({ parse_mode: "Markdown" }, mainMenuKeyboard));
    }
    catch (error) {
        if (!((_a = error.description) === null || _a === void 0 ? void 0 : _a.includes("message is not modified"))) {
            yield ctx.reply(text, Object.assign({ parse_mode: "Markdown" }, mainMenuKeyboard));
        }
    }
}));
