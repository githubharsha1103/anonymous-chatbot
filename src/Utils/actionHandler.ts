import * as fs from "fs";
import * as path from "path";
import { bot } from "../index";
import { Context, Telegraf } from "telegraf";
import { Markup } from "telegraf";
import { updateUser, getUser, getReferralCount, banUser, isBanned, createReport } from "../storage/db";
import { handleTelegramError } from "./telegramErrorHandler";
import { isAdmin, ADMINS } from "./adminAuth";

// Because it doesn't know that ctx has a match property. by default, Context<Update> doesn't include match, but telegraf adds it dynamically when using regex triggers.
export interface ActionContext extends Context {
    match?: RegExpMatchArray;
}

export interface Action {
    name: string | RegExp;
    execute: (ctx: ActionContext, bot: Telegraf<Context>) => Promise<any>;
    disabled?: boolean;
}

export async function loadActions() {
    try {
        const commandsDir = path.join(process.cwd(), "dist/Commands");
        const Files: string[] = [];
        
        // Recursively get all .js files in Commands directory
        function getAllFiles(dir: string): void {
            if (!fs.existsSync(dir)) return;
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    getAllFiles(fullPath);
                } else if (entry.isFile() && entry.name.endsWith('.js')) {
                    Files.push(fullPath);
                }
            }
        }
        getAllFiles(commandsDir);

        for (const file of Files) {
            // Ensure absolute path for require
            const absolutePath = path.resolve(file);
            const actionFile = require(absolutePath).default;
            
            // Skip if not a valid action (command files don't have 'execute' as async action handler)
            if (!actionFile || typeof actionFile !== 'object') continue;
            
            const action = actionFile as Action;

            if (action.disabled) continue;

            const actionName = action.name;
            if (!actionName || typeof actionName === 'string' && (actionName === 'start' || actionName === 'help' || actionName === 'search' || actionName === 'next' || actionName === 'end' || actionName === 'settings' || actionName === 'report' || actionName === 'adminaccess' || actionName === 'ping' || actionName === 'find' || actionName === 'setgender' || actionName === 'ban' || actionName === 'broadcast' || actionName === 'active')) continue;

            try {
                bot.action(actionName, async (ctx) => {
                    try {
                        await action.execute(ctx, bot);
                    } catch (err) {
                        const userId = ctx.from?.id;
                        handleTelegramError(bot, err, userId);
                    }
                });
            } catch (error) {
                console.error(`[ActionHandler] -`, error);
            }
        }
        console.info(`[INFO] - Actions Loaded`);
    } catch (err) {
        console.error(`[ActionHandler] -`, err);
    }
}

const premiumMessage = 
"⭐ *Premium Feature*\n\n" +
"This feature is available only for Premium users.\n\n" +
"📞 Contact admin @demonhunter1511 to purchase Premium\n" +
"🎁 Or use /settings → Referrals to earn free Premium!";

// Empty keyboards (no buttons)
const genderKeyboard: any = { reply_markup: { inline_keyboard: [] } };
const stateKeyboard: any = { reply_markup: { inline_keyboard: [] } };
const backKeyboard: any = { reply_markup: { inline_keyboard: [] } };
const preferenceKeyboard: any = { reply_markup: { inline_keyboard: [] } };
const mainMenuKeyboard: any = { reply_markup: { inline_keyboard: [] } };

// Group verification settings
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID || "-1001234567890";
const GROUP_INVITE_LINK = process.env.GROUP_INVITE_LINK || "https://t.me/teluguanomychat";

// Check if user is a member of the group
async function isUserGroupMember(userId: number): Promise<boolean> {
    try {
        // Use GROUP_CHAT_ID directly - Telegram API requires numeric chat ID
        const chatId = GROUP_CHAT_ID;
        const chatMember = await bot.telegram.getChatMember(chatId, userId);
        // Member status: 'creator', 'administrator', 'member', 'restricted' are valid
        const validStatuses = ['creator', 'administrator', 'member', 'restricted'];
        return validStatuses.includes(chatMember.status);
    } catch (error) {
        console.error(`[GroupCheck] - Error checking group membership for user ${userId}:`, error);
        return false;
    }
}

// Safe answerCallbackQuery helper
async function safeAnswerCbQuery(ctx: ActionContext, text?: string) {
    try {
        if (ctx.callbackQuery?.id) {
            await ctx.answerCbQuery(text);
        }
    } catch {
        // Query too old or invalid, ignore
    }
}

// Check and apply action cooldown - returns true if action should be blocked
function checkAndApplyCooldown(ctx: ActionContext, action: string): boolean {
    const userId = ctx.from?.id;
    if (!userId) return false;
    
    const botInstance = require("../index").bot;
    if (botInstance.isActionOnCooldown(userId, action)) {
        return true;
    }
    botInstance.setActionCooldown(userId, action);
    return false;
}

// Safe editMessageText helper - handles all errors with fallback to reply
// This prevents UI freeze when message can't be edited (too old, deleted, etc.)
async function safeEditMessageText(ctx: ActionContext, text: string, extra?: any) {
    try {
        await ctx.editMessageText(text, extra);
    } catch (error: any) {
        // Check for "message not modified" - this is not an error, just ignore it
        if (error.description && error.description.includes("message is not modified")) {
            return; // Message already has same content
        }
        
        // For all other errors (message too old, not found, etc.), try to reply instead
        console.log("[safeEditMessageText] Falling back to reply:", error.description || error.message);
        try {
            await ctx.reply(text, extra);
        } catch (replyError: any) {
            // Send user feedback on failure
            console.error("[safeEditMessageText] Failed to reply:", replyError.message);
            try {
                await ctx.answerCbQuery("Something went wrong. Please try again.");
            } catch { /* ignore */ }
        }
    }
}

// Function to show settings menu
async function showSettings(ctx: ActionContext) {
    if (!ctx.from) return;
    const u = await getUser(ctx.from.id);
    const referralCount = await getReferralCount(ctx.from.id);

    // Show gender only for premium users
    const genderDisplay = u.premium ? (u.gender ?? "Not Set") : "🔒 Hidden";

    const text =
    `⚙ Settings
 
 👤 Gender: ${genderDisplay}
 🎂 Age: ${u.age ?? "Not Set"}
 📍 State: ${u.state ?? "Not Set"}
 💕 Preference: ${u.premium ? (u.preference === "any" ? "Any" : u.preference === "male" ? "Male" : "Female") : "🔒 Premium Only"}
 💎 Premium: ${u.premium ? "Yes ✅" : "No ❌"}
 💬 Daily chats left: ${100 - (u.daily || 0)}/100
 👥 Referrals: ${referralCount}/30

 Use buttons below to update:`;

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback("👤 Gender", "SET_GENDER")],
        [Markup.button.callback("🎂 Age", "SET_AGE")],
        [Markup.button.callback("📍 State", "SET_STATE")],
        [Markup.button.callback("💕 Preference", "SET_PREFERENCE")],
        [Markup.button.callback("🎁 Referrals", "OPEN_REFERRAL")],
        [Markup.button.callback("⭐ Premium", "BUY_PREMIUM")]
    ]);

    // Try to edit with fallback to reply
    await safeEditMessageText(ctx, text, keyboard);
}

// Open settings
bot.action("OPEN_SETTINGS", async (ctx) => {
    // Check cooldown to prevent button spamming
    if (checkAndApplyCooldown(ctx, "OPEN_SETTINGS")) {
        await safeAnswerCbQuery(ctx);
        return;
    }
    await safeAnswerCbQuery(ctx);
    await showSettings(ctx);
});

// Start menu actions
bot.action("START_SEARCH", async (ctx) => {
    // Check cooldown to prevent button spamming
    if (checkAndApplyCooldown(ctx, "START_SEARCH")) {
        await safeAnswerCbQuery(ctx, "Please wait a moment...");
        return;
    }
    await safeAnswerCbQuery(ctx);
    // Trigger search command
    const searchCommand = require("../Commands/search").default;
    await searchCommand.execute(ctx, bot);
});

bot.action("START_HELP", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    await ctx.reply(
        "📚 *Available Commands:*\n\n" +
        "/start - Start the bot\n" +
        "/search - Find a chat partner\n" +
        "/next - Skip current chat and find new partner\n" +
        "/end - End the current chat\n" +
        "/settings - Open settings menu\n" +
        "/report - Report a user\n" +
        "/help - Show this help message",
        { parse_mode: "Markdown" }
    );
});

// ==============================
// NEW USER SETUP HANDLERS
// ==============================

// Setup age manual input keyboard (NO BACK/CANCEL - must complete)
const setupAgeManualKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("⬅️ Back", "SETUP_BACK_AGE")]
]);

// Welcome back handler
bot.action("WELCOME_BACK", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await safeEditMessageText(ctx,
        "🌟 *Welcome to Anonymous Chat!* 🌟\n\n" +
        "✨ Connect with strangers anonymously\n" +
        "🔒 Your privacy is protected\n" +
        "💬 Chat freely and safely\n\n" +
        "Tap *Get Started* to begin!",
        { parse_mode: "Markdown", ...Markup.inlineKeyboard([
            [Markup.button.callback("🌟 Get Started", "SETUP_GENDER_MALE")]
        ]) }
    );
});

// Setup gender keyboard with NO BACK/CANCEL - must complete setup
const setupGenderKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("👨 Male", "SETUP_GENDER_MALE")],
    [Markup.button.callback("👩 Female", "SETUP_GENDER_FEMALE")]
]);

// Setup age keyboard with ranges and manual input option (NO BACK/CANCEL)
const setupAgeKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("13-17", "SETUP_AGE_13_17")],
    [Markup.button.callback("18-25", "SETUP_AGE_18_25")],
    [Markup.button.callback("26-40", "SETUP_AGE_26_40")],
    [Markup.button.callback("40+", "SETUP_AGE_40_PLUS")],
    [Markup.button.callback("📝 Type Age", "SETUP_AGE_MANUAL")]
]);

// Setup state keyboard (NO BACK/CANCEL - must complete)
const setupStateKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🟢 Telangana", "SETUP_STATE_TELANGANA")],
    [Markup.button.callback("🔵 Andhra Pradesh", "SETUP_STATE_AP")],
    [Markup.button.callback("🇮🇳 Other Indian State", "SETUP_STATE_OTHER")],
    [Markup.button.callback("🌍 Outside India", "SETUP_COUNTRY_OTHER")]
]);

// Gender selected - move to age input
bot.action("SETUP_GENDER_MALE", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { gender: "male", setupStep: "age" });
    await safeEditMessageText(ctx,
        "📝 *Step 2 of 3*\n\n" +
        "🎂 *Select your age range:*\n" +
        "(This helps us match you with people in similar age groups)",
        { parse_mode: "Markdown", ...setupAgeKeyboard }
    );
});

bot.action("SETUP_GENDER_FEMALE", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { gender: "female", setupStep: "age" });
    await safeEditMessageText(ctx,
        "📝 *Step 2 of 3*\n\n" +
        "🎂 *Select your age range:*\n" +
        "(This helps us match you with people in similar age groups)",
        { parse_mode: "Markdown", ...setupAgeKeyboard }
    );
});

// Age range selected - ask for state
const ageToGenderMap: Record<string, string> = {
    "SETUP_AGE_13_17": "13-17",
    "SETUP_AGE_18_25": "18-25",
    "SETUP_AGE_26_40": "26-40",
    "SETUP_AGE_40_PLUS": "40+"
};

for (const [action, ageLabel] of Object.entries(ageToGenderMap)) {
    bot.action(action, async (ctx) => {
        if (!ctx.from) return;
        await safeAnswerCbQuery(ctx);
        await updateUser(ctx.from.id, { age: ageLabel, setupStep: "state" });
        await safeEditMessageText(ctx,
            "📝 *Step 3 of 3*\n\n" +
            "📍 *Select your location:*\n" +
            "(Helps match you with nearby people)",
            { parse_mode: "Markdown", ...setupStateKeyboard }
        );
    });
}

// Manual age input - ask user to type their age
bot.action("SETUP_AGE_MANUAL", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await safeEditMessageText(ctx,
        "📝 *Enter your age:*\n\n" +
        "Please type a number between 13 and 80\n" +
        "(e.g., 21)",
        { parse_mode: "Markdown", ...setupAgeManualKeyboard }
    );
});

// State selected - complete setup
bot.action("SETUP_STATE_TELANGANA", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Telangana", setupStep: "done" });
    await showSetupComplete(ctx);
});

bot.action("SETUP_STATE_AP", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Andhra Pradesh", setupStep: "done" });
    await showSetupComplete(ctx);
});

bot.action("SETUP_STATE_OTHER", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { setupStep: "state_other" });
    await safeEditMessageText(ctx,
        "📍 *Enter your state:*\n\n" +
        "(e.g., Karnataka, Tamil Nadu, Maharashtra, etc.)",
        { parse_mode: "Markdown", ...Markup.inlineKeyboard([
            [Markup.button.callback("⬅️ Back", "SETUP_BACK_STATE")]
        ]) }
    );
});

bot.action("SETUP_COUNTRY_OTHER", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Other", setupStep: "done" });
    await showSetupComplete(ctx);
});

// Back actions
bot.action("SETUP_BACK_GENDER", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    await safeEditMessageText(ctx,
        "📝 *Step 1 of 3*\n" +
        "👤 *Select your gender:*",
        { parse_mode: "Markdown", ...setupGenderKeyboard }
    );
});

bot.action("SETUP_BACK_AGE", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    await safeEditMessageText(ctx,
        "📝 *Step 2 of 3*\n\n" +
        "🎂 *Select your age range:*\n" +
        "(This helps us match you with people in similar age groups)",
        { parse_mode: "Markdown", ...setupAgeKeyboard }
    );
});

bot.action("SETUP_BACK_STATE", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    await safeEditMessageText(ctx,
        "📝 *Step 3 of 3*\n\n" +
        "📍 *Select your location:*\n" +
        "(Helps match you with nearby people)",
        { parse_mode: "Markdown", ...setupStateKeyboard }
    );
});

// Cancel setup - redirect to complete setup instead of allowing cancel
bot.action("SETUP_CANCEL", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    const user = await getUser(ctx.from.id);
    
    // Check which step they're missing and redirect
    if (!user.gender) {
        await safeEditMessageText(ctx,
            "📝 *Setup Required*\n\n" +
            "⚠️ You must complete your profile before using the bot.\n\n" +
            "👤 *Step 1 of 3*\n" +
            "Select your gender:",
            { parse_mode: "Markdown", ...setupGenderKeyboard }
        );
    } else if (!user.age) {
        await safeEditMessageText(ctx,
            "📝 *Setup Required*\n\n" +
            "⚠️ You must complete your profile before using the bot.\n\n" +
            "👤 *Step 2 of 3*\n" +
            "🎂 *Select your age range:*\n" +
            "(This helps us match you with people in similar age groups)",
            { parse_mode: "Markdown", ...setupAgeKeyboard }
        );
    } else if (!user.state) {
        await safeEditMessageText(ctx,
            "📝 *Setup Required*\n\n" +
            "⚠️ You must complete your profile before using the bot.\n\n" +
            "👤 *Step 3 of 3*\n" +
            "📍 *Select your location:*\n" +
            "(Helps match you with nearby people)",
            { parse_mode: "Markdown", ...setupStateKeyboard }
        );
    } else {
        // Setup complete - show main menu
        await safeEditMessageText(ctx,
            "🌟 *Welcome back!* 🌟\n\n" +
            "This bot helps you chat anonymously with people worldwide.\n\n" +
            "Use the menu below to navigate:",
            { parse_mode: "Markdown", ...mainMenuKeyboard }
        );
    }
});

// ==============================
// SETTINGS ACTIONS
// ==============================

// Gender actions
bot.action("SET_GENDER", async (ctx) => {
    const user = await getUser(ctx.from.id);
    
    // Only allow premium users to change their gender
    if (!user.premium) {
        await safeAnswerCbQuery(ctx);
        return ctx.reply("🔒 This feature is only available for Premium users.\n\nUpgrade to Premium to set your gender!");
    }
    
    await safeAnswerCbQuery(ctx);
    await safeEditMessageText(ctx, "Select your gender:", genderKeyboard);
});

bot.action("GENDER_MALE", async (ctx) => {
    if (!ctx.from) return;
    const user = await getUser(ctx.from.id);
    
    // Only allow premium users to change their gender
    if (!user.premium) {
        await safeAnswerCbQuery(ctx, "🔒 This feature is only available for Premium users!");
        return;
    }
    
    await updateUser(ctx.from.id, { gender: "male" });
    await safeAnswerCbQuery(ctx, "Gender set to Male ✅");
    await showSettings(ctx);
});

bot.action("GENDER_FEMALE", async (ctx) => {
    if (!ctx.from) return;
    const user = await getUser(ctx.from.id);
    
    // Only allow premium users to change their gender
    if (!user.premium) {
        await safeAnswerCbQuery(ctx, "🔒 This feature is only available for Premium users!");
        return;
    }
    
    await updateUser(ctx.from.id, { gender: "female" });
    await safeAnswerCbQuery(ctx, "Gender set to Female ✅");
    await showSettings(ctx);
});

// Age selection keyboard for settings
const ageSelectionKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("13-17", "AGE_13_17")],
    [Markup.button.callback("18-25", "AGE_18_25")],
    [Markup.button.callback("26-40", "AGE_26_40")],
    [Markup.button.callback("40+", "AGE_40_PLUS")],
    [Markup.button.callback("🔙 Back", "OPEN_SETTINGS")]
]);

// Age actions
bot.action("SET_AGE", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    await safeEditMessageText(ctx, "Select your age range:", ageSelectionKeyboard);
});

// State actions
bot.action("SET_STATE", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    await safeEditMessageText(ctx, "Select your state:", stateKeyboard);
});

bot.action("STATE_TELANGANA", async (ctx) => {
    if (!ctx.from) return;
    await updateUser(ctx.from.id, { state: "Telangana" });
    await safeAnswerCbQuery(ctx, "State set to Telangana ✅");
    await showSettings(ctx);
});

bot.action("STATE_AP", async (ctx) => {
    if (!ctx.from) return;
    await updateUser(ctx.from.id, { state: "Andhra Pradesh" });
    await safeAnswerCbQuery(ctx, "State set to Andhra Pradesh ✅");
    await showSettings(ctx);
});

// Preference action - check premium status and show appropriate message
bot.action("SET_PREFERENCE", async (ctx) => {
    if (!ctx.from) return;
    const user = await getUser(ctx.from.id);
    
    if (!user.premium) {
        // Show premium message for non-premium users
        await safeAnswerCbQuery(ctx);
        return ctx.reply(
            "💕 *Gender Preference - Premium Only*\n\n" +
            "This feature is available for Premium users only.\n\n" +
            "✨ *Premium Benefits:*\n" +
            "• Set gender preference (Male/Female)\n" +
            "• See partner's gender\n" +
            "• Unlimited daily chats\n" +
            "• And more!\n\n" +
            "📞 Contact admin @demonhunter1511 to purchase\n" +
            "🎁 Or use /settings → Referrals to earn free Premium!",
            { parse_mode: "Markdown" }
        );
    }
    
    await safeAnswerCbQuery(ctx);
    await safeEditMessageText(ctx, "Select your gender preference:", preferenceKeyboard);
});

// Premium check for preference selection
bot.action("PREF_MALE", async (ctx) => {
    if (!ctx.from) return;
    const user = await getUser(ctx.from.id);
    
    if (!user.premium) {
        await safeAnswerCbQuery(ctx);
        return ctx.reply(premiumMessage, { parse_mode: "Markdown" });
    }
    
    await safeAnswerCbQuery(ctx, "Preference saved: Male ✅");
    await updateUser(ctx.from.id, { preference: "male" });
    await showSettings(ctx);
});

bot.action("PREF_FEMALE", async (ctx) => {
    if (!ctx.from) return;
    const user = await getUser(ctx.from.id);
    
    if (!user.premium) {
        await safeAnswerCbQuery(ctx);
        return ctx.reply(premiumMessage, { parse_mode: "Markdown" });
    }
    
    await safeAnswerCbQuery(ctx, "Preference saved: Female ✅");
    await updateUser(ctx.from.id, { preference: "female" });
    await showSettings(ctx);
});

// Buy premium action
bot.action("BUY_PREMIUM", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    await ctx.reply(
        "⭐ *Premium Features* 🔒\n\n" +
        "Upgrade to Premium to unlock:\n" +
        "• Set your chat preference (Male/Female/Any)\n" +
        "• Priority matching\n" +
        "• Unlimited daily chats\n" +
        "• And more!\n\n" +
        "Use /premium to upgrade!",
        { parse_mode: "Markdown" }
    );
});

// Open referral command
bot.action("OPEN_REFERRAL", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    const referralCommand = require("../Commands/referral").default;
    await referralCommand.execute(ctx, bot);
});

// ==============================
// REPORT SYSTEM
// ==============================

const reportReasons = Markup.inlineKeyboard([
    [Markup.button.callback("🎭 Impersonating", "REPORT_IMPERSONATING")],
    [Markup.button.callback("🔞 Sexual content", "REPORT_SEXUAL")],
    [Markup.button.callback("💰 Fraud", "REPORT_FRAUD")],
    [Markup.button.callback("😠 Insulting", "REPORT_INSULTING")],
    [Markup.button.callback("🔙 Cancel", "REPORT_CANCEL")]
]);

const confirmKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("✅ Confirm Report", "REPORT_CONFIRM")],
    [Markup.button.callback("🔙 Cancel", "REPORT_CANCEL")]
]);

// Show report reasons
bot.action("OPEN_REPORT", async (ctx) => {
    // Check cooldown to prevent button spamming
    if (checkAndApplyCooldown(ctx, "OPEN_REPORT")) {
        await safeAnswerCbQuery(ctx);
        return;
    }
    await safeAnswerCbQuery(ctx);
    if (!ctx.from) return;
    
    const user = await getUser(ctx.from.id);
    const partnerId = user.reportingPartner || user.lastPartner;
    const message = "Select a reason to report:";

    if (!partnerId) {
        return safeEditMessageText(ctx, "No user to report. Start a chat first.", backKeyboard);
    }

    // Store the partner ID for reporting
    await updateUser(ctx.from.id, { reportingPartner: partnerId });

    return safeEditMessageText(ctx, message, reportReasons);
});

// Report reason handlers
const reportReasonsMap: Record<string, string> = {
    "REPORT_IMPERSONATING": "Impersonating",
    "REPORT_SEXUAL": "Sexual content",
    "REPORT_FRAUD": "Fraud",
    "REPORT_INSULTING": "Insulting"
};

for (const [action, reason] of Object.entries(reportReasonsMap)) {
    bot.action(action, async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (!ctx.from) return;
        
        const user = await getUser(ctx.from.id);
        const partnerId = user.reportingPartner;
        
        if (!partnerId) {
            return safeEditMessageText(ctx, "No user to report.", backKeyboard);
        }
        
        // Store the report reason temporarily
        await updateUser(ctx.from.id, { reportReason: reason });
        
        return safeEditMessageText(
            ctx,
            `Report reason: ${reason}\n\nAre you sure you want to report this user?`,
            confirmKeyboard
        );
    });
}

// Confirm report
bot.action("REPORT_CONFIRM", async (ctx) => {
    // Check cooldown to prevent report abuse
    if (checkAndApplyCooldown(ctx, "REPORT_CONFIRM")) {
        await safeAnswerCbQuery(ctx, "Please wait...");
        return;
    }
    await safeAnswerCbQuery(ctx);
    if (!ctx.from) return;
    
    const user = await getUser(ctx.from.id);
    const partnerId = user.reportingPartner;
    const reportReason = user.reportReason;
    
    if (!partnerId || !reportReason) {
        return safeEditMessageText(ctx, "Report cancelled.", backKeyboard);
    }
    
    // Check if user has already reported this partner
    if (user.reportedUsers?.includes(partnerId)) {
        return safeEditMessageText(ctx, "⚠️ You have already reported this user.", backKeyboard);
    }
    
    // Create report in the reports collection (this also increments report count)
    const newReportCount = await createReport(partnerId, ctx.from.id, reportReason);
    
    // Track that this user has reported this partner
    await updateUser(ctx.from.id, {
        reportedUsers: [...(user.reportedUsers || []), partnerId]
    });
    
    // Notify the reporter
    await safeEditMessageText(ctx, "Thank you for reporting! 🙏", backKeyboard);
    
    // Notify admins on every report
    const adminIds = ADMINS.map(id => parseInt(id));
    for (const adminId of adminIds) {
        try {
            await ctx.telegram.sendMessage(
                adminId,
                `🚨 *User Reported*\n\n` +
                `👤 Reported User: ${partnerId}\n` +
                `📊 Total Reports: ${newReportCount}\n` +
                `📝 Reason: ${reportReason}\n` +
                `🙋 Reported By: ${ctx.from.id}`,
                {
                    parse_mode: "Markdown",
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: "🚫 Ban User",
                                    callback_data: `ADMIN_QUICK_BAN_${partnerId}`
                                }
                            ],
                            [
                                {
                                    text: "❌ Ignore",
                                    callback_data: "ADMIN_IGNORE_REPORT"
                                }
                            ]
                        ]
                    }
                }
            );
        } catch {
            // Admin might not exist, ignore
        }
    }
    
    // Clear report data
    await updateUser(ctx.from.id, { reportingPartner: null, reportReason: null });
});

// Cancel report
bot.action("REPORT_CANCEL", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    if (!ctx.from) return;
    
    // Clear report data
    await updateUser(ctx.from.id, { reportingPartner: null, reportReason: null });
    
    return safeEditMessageText(ctx, "Report cancelled.", backKeyboard);
});

// Quick ban from report notification
bot.action(/ADMIN_QUICK_BAN_(\d+)/, async (ctx) => {
    // Safety check for ctx.match
    if (!ctx.match) return;
    
    // Verify admin authorization
    if (!ctx.from || !isAdmin(ctx.from.id)) {
        await ctx.answerCbQuery("Unauthorized");
        return;
    }
    await ctx.answerCbQuery("User banned ✅");

    const userId = parseInt(ctx.match[1]);

    try {
        // Check if user is already banned
        const alreadyBanned = await isBanned(userId);
        if (alreadyBanned) {
            await ctx.editMessageText(
                `⚠️ *User Already Banned*\n\nUser ID: ${userId} is already banned.`,
                { parse_mode: "Markdown" }
            );
            return;
        }

        // Add to bans collection
        await banUser(userId);
        
        // Update user's banned field and ban reason
        await updateUser(userId, { 
            banned: true, 
            banReason: "Banned by admin via report notification" 
        });

        await ctx.editMessageText(
            `🚫 *User Banned Successfully*\n\nUser ID: ${userId} has been banned.`,
            { parse_mode: "Markdown" }
        );

        // Optionally notify banned user
        try {
            await ctx.telegram.sendMessage(
                userId,
                `🚫 *You Have Been Banned*\n\n` +
                `You were banned due to a report violation.`,
                { parse_mode: "Markdown" }
            );
        } catch {
            // User may have blocked bot
        }

    } catch (error) {
        console.error("[ERROR] Quick ban failed:", error);
        await ctx.answerCbQuery("Ban failed. Try again.");
    }
});

// Ignore report
bot.action("ADMIN_IGNORE_REPORT", async (ctx) => {
    // Verify admin authorization
    if (!ctx.from || !isAdmin(ctx.from.id)) {
        await ctx.answerCbQuery("Unauthorized");
        return;
    }
    await ctx.answerCbQuery("Ignored");
    await ctx.editMessageText("❌ Report ignored.");
});


// Show improved setup complete message with summary
async function showSetupComplete(ctx: ActionContext) {
    if (!ctx.from) return;
    const user = await getUser(ctx.from.id);
    
    // Get display values - show gender only for premium users
    const genderEmoji = user.premium && user.gender 
        ? (user.gender === "male" ? "👨" : "👩") 
        : "🔒";
    const genderText = user.premium && user.gender 
        ? (user.gender.charAt(0).toUpperCase() + user.gender.slice(1)) 
        : "Hidden";
    const stateText = user.state === "Other" ? "🌍 Other" : (user.state || "Not Set");
    
    let text: string;
    let keyboard: any;
    
    // Always show main menu - group join is now optional
    // Users can chat without joining the group, but we show the invite link as optional
    text =
    "✨ *Profile Complete!* ✨\n\n" +
    "━━━━━━━━━━━━━━━━━━━━\n\n" +
    "📋 *Your Profile:*\n\n" +
    `${genderEmoji} *Gender:* ${genderText}\n` +
    `🎂 *Age:* ${user.age || "Not Set"}\n` +
    `📍 *Location:* ${stateText}\n\n` +
    "━━━━━━━━━━━━━━━━━━━━\n\n";
    
    // Add optional group join message
    text += "📢 *Want to join our community group?*\n" +
    "Join to meet more people and stay updated!\n" +
    `👉 ${GROUP_INVITE_LINK}\n\n` +
    "━━━━━━━━━━━━━━━━━━━━\n\n" +
    "🎉 *You're all set to start chatting!*\n" +
    "/search - Find a chat partner now\n" +
    "⚙️ /settings - Update your profile anytime\n" +
    "❓ /help - Get help with commands\n\n" +
    "💡 *Tip:* Be friendly and respectful for the best experience!";
    
    keyboard = mainMenuKeyboard;

    // Use safeEditMessageText to prevent UI freeze
    await safeEditMessageText(ctx, text, { parse_mode: "Markdown", ...keyboard });
}

// Setup done - show main menu (same as setup complete)
bot.action("SETUP_DONE", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    await showSetupComplete(ctx);
});

// ========================================
// GROUP VERIFICATION SYSTEM
// ========================================

// User clicks "I've Joined" button - verify group membership
bot.action("VERIFY_GROUP_JOIN", async (ctx) => {
    console.log("[GroupCheck] - VERIFY_GROUP_JOIN action triggered by user:", ctx.from?.id);
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    
    const userId = ctx.from.id;
    console.log("[GroupCheck] - Checking membership for user:", userId);
    
    // Check if user is actually a member of the group
    const isMember = await isUserGroupMember(userId);
    console.log("[GroupCheck] - User", userId, "is member:", isMember);
    
    if (isMember) {
        // User joined - update database and show main menu
        await updateUser(userId, { hasJoinedGroup: true });
        await safeAnswerCbQuery(ctx, "✅ Welcome to the group! You can now start chatting!");
        await showSetupComplete(ctx);
    } else {
        // User hasn't joined - show error
        await safeAnswerCbQuery(ctx, "❌ You haven't joined the group yet! Please click the link to join.");
        // Re-show the group join message
        await showSetupComplete(ctx);
    }
});

// ========================================
// CHAT RATING SYSTEM
// ========================================

const ratingThankYouKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🔍 Find New Partner", "START_SEARCH")],
    [Markup.button.callback("⚙️ Settings", "OPEN_SETTINGS")]
]);

// Rate chat as Good
bot.action("RATE_GOOD", async (ctx) => {
    await safeAnswerCbQuery(ctx, "We're glad you had a good experience! 😊");
    if (!ctx.from) return;
    
    const user = await getUser(ctx.from.id);
    
    const text =
        `😊 *Thanks for your feedback!*\n\n` +
        `Great to hear you had a positive chat experience!\n\n` +
        `Your feedback helps us make the community better.`;
    
    await safeEditMessageText(ctx, text, { parse_mode: "Markdown", ...ratingThankYouKeyboard });
    
    const partnerId = user.lastPartner;
    if (partnerId) {
        await updateUser(partnerId, { chatRating: 5 });
    }
});

// Rate chat as Bad
bot.action("RATE_BAD", async (ctx) => {
    await safeAnswerCbQuery(ctx, "Thanks for your feedback. We'll use it to improve.");
    if (!ctx.from) return;
    
    const user = await getUser(ctx.from.id);
    
    const text =
        `📝 *Thanks for your feedback!*\n\n` +
        `Sorry to hear your chat experience wasn't great.\n\n` +
        `Your feedback helps us make the community better.`;
    
    await safeEditMessageText(ctx, text, { parse_mode: "Markdown", ...ratingThankYouKeyboard });
    
    const partnerId = user.lastPartner;
    if (partnerId) {
        await updateUser(partnerId, { chatRating: 1 });
    }
});

// Rate chat as Medium
bot.action("RATE_MEDIUM", async (ctx) => {
    await safeAnswerCbQuery(ctx, "Thanks for your feedback!");
    if (!ctx.from) return;
    
    const user = await getUser(ctx.from.id);
    
    const text =
        `📝 *Thanks for your feedback!*\n\n` +
        `We appreciate your honesty.\n\n` +
        `Your feedback helps us make the community better.`;
    
    await safeEditMessageText(ctx, text, { parse_mode: "Markdown", ...ratingThankYouKeyboard });
    
    const partnerId = user.lastPartner;
    if (partnerId) {
        await updateUser(partnerId, { chatRating: 3 });
    }
});

// ==============================
// NEW CHAT BUTTON HANDLERS
// ==============================

// End chat button - triggers /end command
bot.action("END_CHAT", async (ctx) => {
    // Check cooldown to prevent button spamming
    if (checkAndApplyCooldown(ctx, "END_CHAT")) {
        await safeAnswerCbQuery(ctx, "Please wait a moment...");
        return;
    }
    await safeAnswerCbQuery(ctx);
    // Trigger end command
    const endCommand = require("../Commands/end").default;
    await endCommand.execute(ctx, bot);
});

// Back to main menu button
bot.action("BACK_MAIN_MENU", async (ctx) => {
    // Check cooldown to prevent button spamming
    if (checkAndApplyCooldown(ctx, "BACK_MAIN_MENU")) {
        await safeAnswerCbQuery(ctx);
        return;
    }
    await safeAnswerCbQuery(ctx);
    
    const mainMenuKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback("🔍 Find Partner", "START_SEARCH")],
        [Markup.button.callback("⚙️ Settings", "OPEN_SETTINGS")],
        [Markup.button.callback("🎁 Referrals", "OPEN_REFERRAL")],
        [Markup.button.callback("❓ Help", "START_HELP")]
    ]);
    
    await safeEditMessageText(
        ctx,
        "🌟 <b>Main Menu</b> 🌟\n\nThis bot helps you chat anonymously with people worldwide.\n\nUse the menu below to navigate:",
        { parse_mode: "HTML", ...mainMenuKeyboard }
    );
});

// Cancel search button
bot.action("CANCEL_SEARCH", async (ctx) => {
    // Check cooldown to prevent button spamming
    if (checkAndApplyCooldown(ctx, "CANCEL_SEARCH")) {
        await safeAnswerCbQuery(ctx, "Please wait...");
        return;
    }
    await safeAnswerCbQuery(ctx);
    
    const userId = ctx.from?.id;
    if (!userId) return;
    
    // Remove from waiting queue
    const botInstance = require("../index").bot;
    const queueIndex = botInstance.waitingQueue.findIndex((w: any) => w.id === userId);
    if (queueIndex !== -1) {
        botInstance.waitingQueue.splice(queueIndex, 1);
    }
    
    const mainMenuKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback("🔍 Find Partner", "START_SEARCH")],
        [Markup.button.callback("⚙️ Settings", "OPEN_SETTINGS")],
        [Markup.button.callback("🎁 Referrals", "OPEN_REFERRAL")],
        [Markup.button.callback("❓ Help", "START_HELP")]
    ]);
    
    await safeEditMessageText(
        ctx,
        "🔍 <b>Search Cancelled</b>\n\nYou have been removed from the waiting queue.",
        { parse_mode: "HTML", ...mainMenuKeyboard }
    );
});

// Rate chat as Okay (RATE_OKAY)
bot.action("RATE_OKAY", async (ctx) => {
    await safeAnswerCbQuery(ctx, "Thanks for your feedback!");
    if (!ctx.from) return;
    
    const user = await getUser(ctx.from.id);
    
    const text =
        `📝 <b>Thanks for your feedback!</b>\n\n` +
        `We appreciate your input.\n\n` +
        `Your feedback helps us make the community better.`;
    
    const ratingThankYouKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback("🔍 Find New Partner", "START_SEARCH")],
        [Markup.button.callback("🚨 Report User", "OPEN_REPORT")],
        [Markup.button.callback("🔙 Main Menu", "BACK_MAIN_MENU")]
    ]);
    
    await safeEditMessageText(ctx, text, { parse_mode: "HTML", ...ratingThankYouKeyboard });
    
    const partnerId = user.lastPartner;
    if (partnerId) {
        await updateUser(partnerId, { chatRating: 3 });
    }
});

// Age selection buttons for settings
bot.action("AGE_13_17", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { age: "13-17" });
    await showSettings(ctx);
});

bot.action("AGE_18_25", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { age: "18-25" });
    await showSettings(ctx);
});

bot.action("AGE_26_40", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { age: "26-40" });
    await showSettings(ctx);
});

bot.action("AGE_40_PLUS", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { age: "40+" });
    await showSettings(ctx);
});
