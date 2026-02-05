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

// Setup keyboards for improved onboarding (setup prefix for setup-specific keyboards)
const setupGenderKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("👨 Male", "SETUP_GENDER_MALE")],
    [Markup.button.callback("👩 Female", "SETUP_GENDER_FEMALE")],
    [Markup.button.callback("⬅️ Back", "SETUP_BACK_START")]
]);

const setupAgeRangeKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("13-17", "SETUP_AGE_13_17")],
    [Markup.button.callback("18-25", "SETUP_AGE_18_25")],
    [Markup.button.callback("26-40", "SETUP_AGE_26_40")],
    [Markup.button.callback("40+", "SETUP_AGE_40_PLUS")],
    [Markup.button.callback("⬅️ Back", "SETUP_BACK_GENDER")]
]);

const setupCountryKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🇮🇳 India", "SETUP_COUNTRY_INDIA")],
    [Markup.button.callback("🌍 Other", "SETUP_COUNTRY_OTHER")],
    [Markup.button.callback("⬅️ Back", "SETUP_BACK_AGE")]
]);

const setupStateKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("Telangana", "SETUP_STATE_TELANGANA")],
    [Markup.button.callback("Andhra Pradesh", "SETUP_STATE_AP")],
    [Markup.button.callback("⬅️ Back", "SETUP_BACK_COUNTRY")]
]);

const setupSkipStateKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("Skip", "SETUP_SKIP_STATE")],
    [Markup.button.callback("⬅️ Back", "SETUP_BACK_COUNTRY")]
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
// IMPROVED PROFILE SETUP FOR NEW USERS
// Flow: Gender → Age Range → Country → State
// ========================================

// Step 1: Gender selected - ask for age range
bot.action("SETUP_GENDER_MALE", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { gender: "male" });
    await ctx.editMessageText(
        "📝 *Step 2 of 3*\n\n" +
        "🎂 *Select your age range:*\n" +
        "(This helps us match you with people in similar age groups)",
        { parse_mode: "Markdown", ...setupAgeRangeKeyboard }
    );
});

bot.action("SETUP_GENDER_FEMALE", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { gender: "female" });
    await ctx.editMessageText(
        "📝 *Step 2 of 3*\n\n" +
        "🎂 *Select your age range:*\n" +
        "(This helps us match you with people in similar age groups)",
        { parse_mode: "Markdown", ...setupAgeRangeKeyboard }
    );
});

// Step 1b: Non-premium user skips gender selection
bot.action("SETUP_SKIP_GENDER", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    // Gender stays null for non-premium users
    await ctx.editMessageText(
        "📝 *Step 2 of 3*\n\n" +
        "🎂 *Select your age range:*\n" +
        "(This helps us match you with people in similar age groups)",
        { parse_mode: "Markdown", ...setupAgeRangeKeyboard }
    );
});

// Step 1c: Go back to start from gender selection
bot.action("SETUP_BACK_START", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    const user = await getUser(ctx.from.id);
    
    if (user.premium) {
        // Premium user - show gender selection
        await ctx.editMessageText(
            "🌟 *Welcome to Anonymous Chat!* 🌟\n\n" +
            "Let's set up your profile to help you find great chat partners!\n\n" +
            "📝 *Step 1 of 3* - *PREMIUM*\n" +
            "👤 *Select your gender:*",
            { parse_mode: "Markdown", ...setupGenderKeyboard }
        );
    } else {
        // Non-premium user - skip gender
        await ctx.editMessageText(
            "🌟 *Welcome to Anonymous Chat!* 🌟\n\n" +
            "Let's set up your profile to help you find great chat partners!\n\n" +
            "📝 *Step 1 of 3*\n" +
            "👤 *Select your gender:*",
            { parse_mode: "Markdown", ...setupGenderKeyboard }
        );
    }
});

// Step 2: Age ranges - ask for country
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
        await updateUser(ctx.from.id, { age: ageLabel });
        await ctx.editMessageText(
            "📝 *Step 3 of 3*\n\n" +
            "🌍 *Select your country:*\n" +
            "(We'll match you with people from similar regions)",
            { parse_mode: "Markdown", ...setupCountryKeyboard }
        );
    });
}

// Step 2b: Go back to gender selection
bot.action("SETUP_BACK_GENDER", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    await ctx.editMessageText(
        "📝 *Step 1 of 3*\n" +
        "👤 *Select your gender:*",
        { parse_mode: "Markdown", ...setupGenderKeyboard }
    );
});

// Step 3: Country selection - if India, ask for state; if Other, skip state
bot.action("SETUP_COUNTRY_INDIA", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "" }); // Clear state, will be set below
    await ctx.editMessageText(
        "📝 *Step 3 of 3*\n\n" +
        "📍 *Select your state:*\n" +
        "(Optional - helps match you with nearby people)",
        { parse_mode: "Markdown", ...setupStateKeyboard }
    );
});

bot.action("SETUP_COUNTRY_OTHER", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Other" });
    await showSetupComplete(ctx);
});

// Step 3b: Go back to age selection
bot.action("SETUP_BACK_AGE", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    await ctx.editMessageText(
        "📝 *Step 2 of 3*\n\n" +
        "🎂 *Select your age range:*\n" +
        "(This helps us match you with people in similar age groups)",
        { parse_mode: "Markdown", ...setupAgeRangeKeyboard }
    );
});

// Step 4: State selection - show completion
bot.action("SETUP_STATE_TELANGANA", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Telangana" });
    await showSetupComplete(ctx);
});

bot.action("SETUP_STATE_AP", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Andhra Pradesh" });
    await showSetupComplete(ctx);
});

// Step 4b: Go back to country selection
bot.action("SETUP_BACK_COUNTRY", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    await ctx.editMessageText(
        "📝 *Step 3 of 3*\n\n" +
        "🌍 *Select your country:*\n" +
        "(We'll match you with people from similar regions)",
        { parse_mode: "Markdown", ...setupCountryKeyboard }
    );
});

// Skip state (for non-Indian users)
bot.action("SETUP_SKIP_STATE", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Other" });
    await showSetupComplete(ctx);
});

// Setup: Cancel setup
bot.action("SETUP_CANCEL", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    await ctx.editMessageText(
        "❌ *Setup Cancelled*\n\n" +
        "Use /start to begin again when you're ready!",
        { parse_mode: "Markdown", ...mainMenuKeyboard }
    );
});

// Show improved setup complete message with summary
async function showSetupComplete(ctx: ActionContext) {
    if (!ctx.from) return;
    const user = await getUser(ctx.from.id);
    
    // Get display values
    const genderEmoji = user.gender === "male" ? "👨" : user.gender === "female" ? "👩" : "❓";
    const genderText = user.gender ? (user.gender.charAt(0).toUpperCase() + user.gender.slice(1)) : "Not Set";
    const stateText = user.state === "Other" ? "🌍 Other" : (user.state || "Not Set");
    
    const text =
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
    
    await ctx.editMessageText(
        `😊 *Thanks for your feedback!*

Great to hear you had a positive chat experience!

Your feedback helps us make the community better.`,
        { parse_mode: "Markdown", ...ratingThankYouKeyboard }
    );
    
    // Log positive feedback for admins
    console.log(`[RATING] User ${ctx.from.id} rated chat as GOOD`);
});

// Rate chat as Okay
bot.action("RATE_OKAY", async (ctx) => {
    await safeAnswerCbQuery(ctx, "Thanks for your feedback!");
    if (!ctx.from) return;
    
    await ctx.editMessageText(
        `😐 *Thanks for your feedback!*

We appreciate your honest rating.

If you have suggestions to improve, feel free to share them with the admin!`,
        { parse_mode: "Markdown", ...ratingThankYouKeyboard }
    );
    
    console.log(`[RATING] User ${ctx.from.id} rated chat as OKAY`);
});

// Rate chat as Bad - prompt for report
const badRatingKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🚨 Report User", "OPEN_REPORT")],
    [Markup.button.callback("Skip", "RATE_SKIP")]
]);

bot.action("RATE_BAD", async (ctx) => {
    await safeAnswerCbQuery(ctx, "We're sorry to hear that 😞");
    if (!ctx.from) return;
    
    await ctx.editMessageText(
        `😟 *We're sorry to hear that!*

We want to make this community safe for everyone.

Would you like to report the user for violating our guidelines? Your report is anonymous and helps us take action.`,
        { parse_mode: "Markdown", ...badRatingKeyboard }
    );
    
    console.log(`[RATING] User ${ctx.from.id} rated chat as BAD - potential report`);
});

// Skip rating after bad experience
bot.action("RATE_SKIP", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    if (!ctx.from) return;
    
    await ctx.editMessageText(
        `💡 *No problem!*

Thanks for using our chat service.

Use /search to find a new partner anytime!`,
        { parse_mode: "Markdown", ...mainMenuKeyboard }
    );
});

// End menu action (for END_MENU callback)
bot.action("END_MENU", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    if (!ctx.from) return;
    
    const text =
`🌟 *Welcome back!*

Use the menu below to navigate:`;

    try {
        await ctx.editMessageText(text, { parse_mode: "Markdown", ...mainMenuKeyboard });
    } catch {
        await ctx.reply(text, { parse_mode: "Markdown", ...mainMenuKeyboard });
    }
});
