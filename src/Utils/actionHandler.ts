import { glob } from "glob";
import { bot } from "../index";
import { Context, Telegraf } from "telegraf";
import { Markup } from "telegraf";
import { updateUser, getUser, getReferralCount, getReportCount } from "../storage/db";
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


const mainMenuKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🔍 Search", "START_SEARCH")],
    [Markup.button.callback("⚙️ Settings", "OPEN_SETTINGS")],
    [Markup.button.callback("❓ Help", "START_HELP")]
]);

// Group verification settings
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID || "-1001234567890";
const GROUP_INVITE_LINK = process.env.GROUP_INVITE_LINK || "https://t.me/teluguanomychat";

// Keyboard for group join verification
const groupJoinKeyboard = Markup.inlineKeyboard([
    [Markup.button.url("📢 Join Our Group", GROUP_INVITE_LINK)],
    [Markup.button.callback("✅ I've Joined", "VERIFY_GROUP_JOIN")]
]);

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

// Safe editMessageText helper - handles "message not modified" errors
async function safeEditMessageText(ctx: ActionContext, text: string, extra?: any) {
    try {
        await ctx.editMessageText(text, extra);
    } catch (error: any) {
        // Ignore "message not modified" errors (400 Bad Request)
        if (error.description && error.description.includes("message is not modified")) {
            // Message already edited, ignore
        } else {
            throw error; // Re-throw other errors
        }
    }
}

// Function to show settings menu
async function showSettings(ctx: ActionContext) {
    if (!ctx.from) return;
    const u = await getUser(ctx.from.id);
    const referralCount = await getReferralCount(ctx.from.id);

    const text =
    `⚙ Settings
 
 👤 Gender: ${u.gender ?? "Not Set"}
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

    // Try to edit, if fails (same content), send new message
    try {
        await ctx.editMessageText(text, keyboard);
    } catch (error: any) {
        if (!error.description?.includes("message is not modified")) {
            await safeAnswerCbQuery(ctx);
            await ctx.reply(text, keyboard);
        }
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
    await safeAnswerCbQuery(ctx);
    await safeEditMessageText(ctx, "Select your gender:", genderKeyboard);
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
    await safeEditMessageText(ctx, "Please enter your age (13-80):", backKeyboard);
});

// State actions
bot.action("SET_STATE", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    await safeEditMessageText(ctx, "Select your state:", stateKeyboard);
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
        return safeEditMessageText(ctx, "No user to report. Start a chat first.", backKeyboard);
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
            return safeEditMessageText(ctx, "No user to report.", backKeyboard);
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
        return safeEditMessageText(ctx, "Report cancelled.", backKeyboard);
    }
    
    // Notify the reporter
    await safeEditMessageText(ctx, "Thank you for reporting! 🙏", backKeyboard);
    
    // Increment report count on the reported user
    const currentReportCount = await getReportCount(partnerId);
    await updateUser(partnerId, { reportCount: currentReportCount + 1, reportReason: reportReason });
    
    // Send report to all admins
    const adminIds = ADMINS.map(id => parseInt(id));
    for (const adminId of adminIds) {
        try {
            await ctx.telegram.sendMessage(
                adminId,
                `🚨 *Report Submitted*\n\n` +
                `📋 *Reason:* ${reportReason}\n` +
                `👤 *Reported User ID:* ${partnerId}\n` +
                `👤 *Reported by:* ${ctx.from.id}\n\n` +
                `Please review this report.`,
                { parse_mode: "Markdown" }
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


// Show improved setup complete message with summary
async function showSetupComplete(ctx: ActionContext) {
    if (!ctx.from) return;
    const user = await getUser(ctx.from.id);
    
    // Get display values
    const genderEmoji = user.gender === "male" ? "👨" : user.gender === "female" ? "👩" : "❓";
    const genderText = user.gender ? (user.gender.charAt(0).toUpperCase() + user.gender.slice(1)) : "Not Set";
    const stateText = user.state === "Other" ? "🌍 Other" : (user.state || "Not Set");
    
    // Check if user has joined the group (optional - for display purposes only)
    const hasJoined = user.hasJoinedGroup === true;
    
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

    try {
        await ctx.editMessageText(text, { parse_mode: "Markdown", ...keyboard });
    } catch (error: any) {
        if (!error.description?.includes("message is not modified")) {
            await safeAnswerCbQuery(ctx);
            await ctx.reply(text, { parse_mode: "Markdown", ...keyboard });
        }
    }
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
    
    try {
        await ctx.editMessageText(text, { parse_mode: "Markdown", ...ratingThankYouKeyboard });
    } catch (error: any) {
        // Ignore "message not modified" errors
        if (!error.description?.includes("message is not modified")) {
            await safeAnswerCbQuery(ctx, "We're glad you had a good experience! 😊");
        }
    }
    
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
    
    try {
        await ctx.editMessageText(text, { parse_mode: "Markdown", ...ratingThankYouKeyboard });
    } catch (error: any) {
        // Ignore "message not modified" errors
        if (!error.description?.includes("message is not modified")) {
            await safeAnswerCbQuery(ctx, "Thanks for your feedback. We'll use it to improve.");
        }
    }
    
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
    
    try {
        await ctx.editMessageText(text, { parse_mode: "Markdown", ...ratingThankYouKeyboard });
    } catch (error: any) {
        // Ignore "message not modified" errors
        if (!error.description?.includes("message is not modified")) {
            await safeAnswerCbQuery(ctx, "Thanks for your feedback!");
        }
    }
    
    const partnerId = user.lastPartner;
    if (partnerId) {
        await updateUser(partnerId, { chatRating: 3 });
    }
});
