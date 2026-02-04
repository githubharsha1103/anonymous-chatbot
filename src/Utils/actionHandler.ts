import { glob } from "glob";
import { bot } from "../index";
import { Context, Telegraf } from "telegraf";
import { Markup } from "telegraf";
import { updateUser, getUser } from "../storage/db";
import { handleTelegramError } from "./telegramErrorHandler";

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
        const Files = await glob(`${process.cwd()}/dist/Commands/**/*.js`);

        for (let file of Files) {
            // Ensure absolute path for require
            const absolutePath = require("path").resolve(file);
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

// Inline keyboard helpers
const genderKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("👨 Male", "GENDER_MALE")],
    [Markup.button.callback("👩 Female", "GENDER_FEMALE")],
    [Markup.button.callback("🔙 Back", "OPEN_SETTINGS")]
]);

const stateKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("Telangana", "STATE_TELANGANA")],
    [Markup.button.callback("Andhra Pradesh", "STATE_AP")],
    [Markup.button.callback("🔙 Back", "OPEN_SETTINGS")]
]);

const backKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🔙 Back", "OPEN_SETTINGS")]
]);

const preferenceKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("👨 Male", "PREF_MALE")],
    [Markup.button.callback("👩 Female", "PREF_FEMALE")],
    [Markup.button.callback("🔙 Back", "OPEN_SETTINGS")]
]);

const premiumMessage = 
"⭐ *Premium Feature*\n\n" +
"Gender preference is available only for Premium users.\n\n" +
"To unlock this feature, please contact the admin @demonhunter1511 to purchase Premium access.";

// Setup keyboards
const ageInputKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("⬅️ Cancel", "SETUP_CANCEL")]
]);

const setupStateKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("Telangana", "SETUP_STATE_TELANGANA")],
    [Markup.button.callback("Andhra Pradesh", "SETUP_STATE_AP")]
]);

const mainMenuKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🔍 Search", "START_SEARCH")],
    [Markup.button.callback("⚙️ Settings", "OPEN_SETTINGS")],
    [Markup.button.callback("❓ Help", "START_HELP")]
]);

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

// Function to show settings menu
async function showSettings(ctx: ActionContext) {
    if (!ctx.from) return;
    const u = await getUser(ctx.from.id);

    const text =
`⚙ Settings

👤 Gender: ${u.gender ?? "Not Set"}
🎂 Age: ${u.age ?? "Not Set"}
📍 State: ${u.state ?? "Not Set"}
💕 Preference: ${u.premium ? (u.preference === "any" ? "Any" : u.preference === "male" ? "Male" : "Female") : "🔒 Premium Only"}
💎 Premium: ${u.premium ? "Yes ✅" : "No ❌"}
💬 Daily chats left: ${100 - (u.daily || 0)}/100

Use buttons below to update:`;

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback("👤 Gender", "SET_GENDER")],
        [Markup.button.callback("🎂 Age", "SET_AGE")],
        [Markup.button.callback("📍 State", "SET_STATE")],
        [Markup.button.callback("💕 Preference", "SET_PREFERENCE"), Markup.button.callback("⭐ Premium", "BUY_PREMIUM")]
    ]);

    // Try to edit, if fails (same content), send new message
    try {
        await ctx.editMessageText(text, keyboard);
    } catch {
        await safeAnswerCbQuery(ctx);
        await ctx.reply(text, keyboard);
    }
}

// Open settings
bot.action("OPEN_SETTINGS", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    await showSettings(ctx);
});

// Start menu actions
bot.action("START_SEARCH", async (ctx) => {
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

// Gender actions
bot.action("SET_GENDER", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    await ctx.editMessageText("Select your gender:", genderKeyboard);
});

bot.action("GENDER_MALE", async (ctx) => {
    if (!ctx.from) return;
    await updateUser(ctx.from.id, { gender: "male" });
    await safeAnswerCbQuery(ctx, "Gender set to Male ✅");
    await showSettings(ctx);
});

bot.action("GENDER_FEMALE", async (ctx) => {
    if (!ctx.from) return;
    await updateUser(ctx.from.id, { gender: "female" });
    await safeAnswerCbQuery(ctx, "Gender set to Female ✅");
    await showSettings(ctx);
});

// Age actions
bot.action("SET_AGE", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    await ctx.editMessageText("Please enter your age (13-80):", backKeyboard);
});

// State actions
bot.action("SET_STATE", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    await ctx.editMessageText("Select your state:", stateKeyboard);
});

bot.action("STATE_TELANGANA", async (ctx) => {
    if (!ctx.from) return;
    await updateUser(ctx.from.id, { state: "telangana" });
    await safeAnswerCbQuery(ctx, "State set to Telangana ✅");
    await showSettings(ctx);
});

bot.action("STATE_AP", async (ctx) => {
    if (!ctx.from) return;
    await updateUser(ctx.from.id, { state: "andhra pradesh" });
    await safeAnswerCbQuery(ctx, "State set to Andhra Pradesh ✅");
    await showSettings(ctx);
});

// Preference action - available for all users, but only works for premium
bot.action("SET_PREFERENCE", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    await ctx.editMessageText("Select your gender preference:", preferenceKeyboard);
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

const ADMINS = process.env.ADMIN_IDS?.split(",") || [];

function isAdmin(id: number) {
    return ADMINS.includes(id.toString());
}

// Show report reasons
bot.action("OPEN_REPORT", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    if (!ctx.from) return;
    
    const user = await getUser(ctx.from.id);
    let partnerId = user.reportingPartner || user.lastPartner;
    let message = "Select a reason to report:";

    if (!partnerId) {
        return ctx.editMessageText("No user to report. Start a chat first.", backKeyboard);
    }

    // Store the partner ID for reporting
    await updateUser(ctx.from.id, { reportingPartner: partnerId });

    return ctx.editMessageText(message, reportReasons);
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
            return ctx.editMessageText("No user to report.", backKeyboard);
        }
        
        // Store the report reason temporarily
        await updateUser(ctx.from.id, { reportReason: reason });
        
        return ctx.editMessageText(
            `Report reason: ${reason}\n\nAre you sure you want to report this user?`,
            confirmKeyboard
        );
    });
}

// Confirm report
bot.action("REPORT_CONFIRM", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    if (!ctx.from) return;
    
    const user = await getUser(ctx.from.id);
    const partnerId = user.reportingPartner;
    const reportReason = user.reportReason;
    
    if (!partnerId || !reportReason) {
        return ctx.editMessageText("Report cancelled.", backKeyboard);
    }
    
    // Notify the reporter
    await ctx.editMessageText("Thank you for reporting! 🙏", backKeyboard);
    
    // Send report to all admins
    const adminIds = ADMINS.map(id => parseInt(id));
    for (const adminId of adminIds) {
        try {
            await ctx.telegram.sendMessage(
                adminId,
                `🚨 REPORT RECEIVED\n\n` +
                `Reporter: ${ctx.from.id}\n` +
                `Reported User: ${partnerId}\n` +
                `Reason: ${reportReason}\n` +
                `Time: ${new Date().toLocaleString()}`
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
    
    return ctx.editMessageText("Report cancelled.", backKeyboard);
});

// ========================================
// PROFILE SETUP FOR NEW USERS (Gender → Age → State)
// ========================================

// Setup: Gender selected - ask for age
bot.action("SETUP_GENDER_MALE", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { gender: "male" });
    await ctx.editMessageText(
        "📝 *Step 2/3:* Please enter your age (13-80):",
        { parse_mode: "Markdown", ...ageInputKeyboard }
    );
});

bot.action("SETUP_GENDER_FEMALE", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { gender: "female" });
    await ctx.editMessageText(
        "📝 *Step 2/3:* Please enter your age (13-80):",
        { parse_mode: "Markdown", ...ageInputKeyboard }
    );
});

// Setup: Cancel setup
bot.action("SETUP_CANCEL", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    await ctx.editMessageText(
        "Setup cancelled. Use /start to begin again.",
        mainMenuKeyboard
    );
});

// Setup: State selected - show completion with commands
bot.action("SETUP_STATE_TELANGANA", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "telangana" });
    await showSetupComplete(ctx);
});

bot.action("SETUP_STATE_AP", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "andhra pradesh" });
    await showSetupComplete(ctx);
});

// Show setup complete message with all commands
async function showSetupComplete(ctx: ActionContext) {
    if (!ctx.from) return;
    const user = await getUser(ctx.from.id);
    
    const text =
`✅ *Profile Setup Complete!*\n\n` +
`👤 Gender: ${user.gender ?? "Not Set"}\n` +
`🎂 Age: ${user.age ?? "Not Set"}\n` +
`📍 State: ${user.state ?? "Not Set"}\n\n` +
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
        await ctx.editMessageText(text, { parse_mode: "Markdown", ...mainMenuKeyboard });
    } catch {
        await safeAnswerCbQuery(ctx);
        await ctx.reply(text, { parse_mode: "Markdown", ...mainMenuKeyboard });
    }
}

// Setup done - show main menu (same as setup complete)
bot.action("SETUP_DONE", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    await showSetupComplete(ctx);
});
