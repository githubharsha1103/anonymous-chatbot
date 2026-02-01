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
// Setup keyboards
const ageInputKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("⬅️ Cancel", "SETUP_CANCEL")]
]);
const setupStateKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("Telangana", "SETUP_STATE_TELANGANA")],
    [telegraf_1.Markup.button.callback("Andhra Pradesh", "SETUP_STATE_AP")]
]);
const mainMenuKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("🔍 Search", "START_SEARCH")],
    [telegraf_1.Markup.button.callback("⚙️ Settings", "OPEN_SETTINGS")],
    [telegraf_1.Markup.button.callback("❓ Help", "START_HELP")]
]);
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
// Function to show settings menu
function showSettings(ctx) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        if (!ctx.from)
            return;
        const u = (0, db_1.getUser)(ctx.from.id);
        const text = `⚙ Settings

👤 Gender: ${(_a = u.gender) !== null && _a !== void 0 ? _a : "Not Set"}
🎂 Age: ${(_b = u.age) !== null && _b !== void 0 ? _b : "Not Set"}
📍 State: ${(_c = u.state) !== null && _c !== void 0 ? _c : "Not Set"}
💕 Preference: ${u.premium ? (u.preference === "any" ? "Any" : u.preference === "male" ? "Male" : "Female") : "🔒 Premium Only"}
💎 Premium: ${u.premium ? "Yes ✅" : "No ❌"}
💬 Daily chats left: ${100 - (u.daily || 0)}/100

Use buttons below to update:`;
        const keyboard = telegraf_1.Markup.inlineKeyboard([
            [telegraf_1.Markup.button.callback("👤 Gender", "SET_GENDER")],
            [telegraf_1.Markup.button.callback("🎂 Age", "SET_AGE")],
            [telegraf_1.Markup.button.callback("📍 State", "SET_STATE")],
            [telegraf_1.Markup.button.callback("💕 Preference", "SET_PREFERENCE"), telegraf_1.Markup.button.callback("⭐ Premium", "BUY_PREMIUM")]
        ]);
        // Try to edit, if fails (same content), send new message
        try {
            yield ctx.editMessageText(text, keyboard);
        }
        catch (_d) {
            yield safeAnswerCbQuery(ctx);
            yield ctx.reply(text, keyboard);
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
// Gender actions
index_1.bot.action("SET_GENDER", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield safeAnswerCbQuery(ctx);
    yield ctx.editMessageText("Select your gender:", genderKeyboard);
}));
index_1.bot.action("GENDER_MALE", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    if (!ctx.from)
        return;
    (0, db_1.updateUser)(ctx.from.id, { gender: "male" });
    yield safeAnswerCbQuery(ctx, "Gender set to Male ✅");
    yield showSettings(ctx);
}));
index_1.bot.action("GENDER_FEMALE", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    if (!ctx.from)
        return;
    (0, db_1.updateUser)(ctx.from.id, { gender: "female" });
    yield safeAnswerCbQuery(ctx, "Gender set to Female ✅");
    yield showSettings(ctx);
}));
// Age actions
index_1.bot.action("SET_AGE", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield safeAnswerCbQuery(ctx);
    yield ctx.editMessageText("Please enter your age (13-80):", backKeyboard);
}));
// State actions
index_1.bot.action("SET_STATE", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield safeAnswerCbQuery(ctx);
    yield ctx.editMessageText("Select your state:", stateKeyboard);
}));
index_1.bot.action("STATE_TELANGANA", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    if (!ctx.from)
        return;
    (0, db_1.updateUser)(ctx.from.id, { state: "telangana" });
    yield safeAnswerCbQuery(ctx, "State set to Telangana ✅");
    yield showSettings(ctx);
}));
index_1.bot.action("STATE_AP", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    if (!ctx.from)
        return;
    (0, db_1.updateUser)(ctx.from.id, { state: "andhra pradesh" });
    yield safeAnswerCbQuery(ctx, "State set to Andhra Pradesh ✅");
    yield showSettings(ctx);
}));
// Preference action - available for all users, but only works for premium
index_1.bot.action("SET_PREFERENCE", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield safeAnswerCbQuery(ctx);
    yield ctx.editMessageText("Select your gender preference:", preferenceKeyboard);
}));
// Premium check for preference selection
index_1.bot.action("PREF_MALE", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    if (!ctx.from)
        return;
    const user = (0, db_1.getUser)(ctx.from.id);
    if (!user.premium) {
        yield safeAnswerCbQuery(ctx);
        return ctx.reply(premiumMessage, { parse_mode: "Markdown" });
    }
    yield safeAnswerCbQuery(ctx, "Preference saved: Male ✅");
    (0, db_1.updateUser)(ctx.from.id, { preference: "male" });
    yield showSettings(ctx);
}));
index_1.bot.action("PREF_FEMALE", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    if (!ctx.from)
        return;
    const user = (0, db_1.getUser)(ctx.from.id);
    if (!user.premium) {
        yield safeAnswerCbQuery(ctx);
        return ctx.reply(premiumMessage, { parse_mode: "Markdown" });
    }
    yield safeAnswerCbQuery(ctx, "Preference saved: Female ✅");
    (0, db_1.updateUser)(ctx.from.id, { preference: "female" });
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
    const user = (0, db_1.getUser)(ctx.from.id);
    let partnerId = user.reportingPartner || user.lastPartner;
    let message = "Select a reason to report:";
    if (!partnerId) {
        return ctx.editMessageText("No user to report. Start a chat first.", backKeyboard);
    }
    // Store the partner ID for reporting
    (0, db_1.updateUser)(ctx.from.id, { reportingPartner: partnerId });
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
        const user = (0, db_1.getUser)(ctx.from.id);
        const partnerId = user.reportingPartner;
        if (!partnerId) {
            return ctx.editMessageText("No user to report.", backKeyboard);
        }
        // Store the report reason temporarily
        (0, db_1.updateUser)(ctx.from.id, { reportReason: reason });
        return ctx.editMessageText(`Report reason: ${reason}\n\nAre you sure you want to report this user?`, confirmKeyboard);
    }));
}
// Confirm report
index_1.bot.action("REPORT_CONFIRM", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield safeAnswerCbQuery(ctx);
    if (!ctx.from)
        return;
    const user = (0, db_1.getUser)(ctx.from.id);
    const partnerId = user.reportingPartner;
    const reportReason = user.reportReason;
    if (!partnerId || !reportReason) {
        return ctx.editMessageText("Report cancelled.", backKeyboard);
    }
    // Notify the reporter
    yield ctx.editMessageText("Thank you for reporting! 🙏", backKeyboard);
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
    (0, db_1.updateUser)(ctx.from.id, { reportingPartner: null, reportReason: null });
}));
// Cancel report
index_1.bot.action("REPORT_CANCEL", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield safeAnswerCbQuery(ctx);
    if (!ctx.from)
        return;
    // Clear report data
    (0, db_1.updateUser)(ctx.from.id, { reportingPartner: null, reportReason: null });
    return ctx.editMessageText("Report cancelled.", backKeyboard);
}));
// ========================================
// PROFILE SETUP FOR NEW USERS (Gender → Age → State)
// ========================================
// Setup: Gender selected - ask for age
index_1.bot.action("SETUP_GENDER_MALE", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    if (!ctx.from)
        return;
    yield safeAnswerCbQuery(ctx);
    (0, db_1.updateUser)(ctx.from.id, { gender: "male" });
    yield ctx.editMessageText("📝 *Step 2/3:* Please enter your age (13-80):", Object.assign({ parse_mode: "Markdown" }, ageInputKeyboard));
}));
index_1.bot.action("SETUP_GENDER_FEMALE", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    if (!ctx.from)
        return;
    yield safeAnswerCbQuery(ctx);
    (0, db_1.updateUser)(ctx.from.id, { gender: "female" });
    yield ctx.editMessageText("📝 *Step 2/3:* Please enter your age (13-80):", Object.assign({ parse_mode: "Markdown" }, ageInputKeyboard));
}));
// Setup: Cancel setup
index_1.bot.action("SETUP_CANCEL", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield safeAnswerCbQuery(ctx);
    yield ctx.editMessageText("Setup cancelled. Use /start to begin again.", mainMenuKeyboard);
}));
// Setup: State selected - show completion with commands
index_1.bot.action("SETUP_STATE_TELANGANA", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    if (!ctx.from)
        return;
    yield safeAnswerCbQuery(ctx);
    (0, db_1.updateUser)(ctx.from.id, { state: "telangana" });
    yield showSetupComplete(ctx);
}));
index_1.bot.action("SETUP_STATE_AP", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    if (!ctx.from)
        return;
    yield safeAnswerCbQuery(ctx);
    (0, db_1.updateUser)(ctx.from.id, { state: "andhra pradesh" });
    yield showSetupComplete(ctx);
}));
// Show setup complete message with all commands
function showSetupComplete(ctx) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        if (!ctx.from)
            return;
        const user = (0, db_1.getUser)(ctx.from.id);
        const text = `✅ *Profile Setup Complete!*\n\n` +
            `👤 Gender: ${(_a = user.gender) !== null && _a !== void 0 ? _a : "Not Set"}\n` +
            `🎂 Age: ${(_b = user.age) !== null && _b !== void 0 ? _b : "Not Set"}\n` +
            `📍 State: ${(_c = user.state) !== null && _c !== void 0 ? _c : "Not Set"}\n\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `📚 *Available Commands:*\n\n` +
            `🔍 /search - Find a chat partner\n` +
            `/next - Skip current chat & find new\n` +
            `/end - End current chat\n` +
            `/settings - Update your profile\n` +
            `/report - Report a user\n` +
            `/help - Show this help message\n\n` +
            `💡 *Tip:* Press /search to find a chat partner!`;
        try {
            yield ctx.editMessageText(text, Object.assign({ parse_mode: "Markdown" }, mainMenuKeyboard));
        }
        catch (_d) {
            yield safeAnswerCbQuery(ctx);
            yield ctx.reply(text, Object.assign({ parse_mode: "Markdown" }, mainMenuKeyboard));
        }
    });
}
// Setup done - show main menu (same as setup complete)
index_1.bot.action("SETUP_DONE", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield safeAnswerCbQuery(ctx);
    yield showSetupComplete(ctx);
}));
