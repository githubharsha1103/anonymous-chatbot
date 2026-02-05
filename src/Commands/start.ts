import { Context, Telegraf, Markup } from "telegraf";
import { Command } from "../Utils/commandHandler";
import { ExtraTelegraf } from "..";
import { getUser, updateUser, updateLastActive } from "../storage/db";

// Profile setup keyboards with improved UX

// Step 1: Gender selection with back button
const genderKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("👨 Male", "SETUP_GENDER_MALE")],
    [Markup.button.callback("👩 Female", "SETUP_GENDER_FEMALE")],
    [Markup.button.callback("⬅️ Back", "SETUP_BACK_START")]
]);

// Step 2: Age range selection (easier than typing exact age)
const ageRangeKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("13-17", "SETUP_AGE_13_17")],
    [Markup.button.callback("18-25", "SETUP_AGE_18_25")],
    [Markup.button.callback("26-40", "SETUP_AGE_26_40")],
    [Markup.button.callback("40+", "SETUP_AGE_40_PLUS")],
    [Markup.button.callback("⬅️ Back", "SETUP_BACK_GENDER")]
]);

// Step 3: Country selection
const countryKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🇮🇳 India", "SETUP_COUNTRY_INDIA")],
    [Markup.button.callback("🌍 Other", "SETUP_COUNTRY_OTHER")],
    [Markup.button.callback("⬅️ Back", "SETUP_BACK_AGE")]
]);

// Step 3b: Indian states (if India selected)
const stateKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("Telangana", "SETUP_STATE_TELANGANA")],
    [Markup.button.callback("Andhra Pradesh", "SETUP_STATE_AP")],
    [Markup.button.callback("⬅️ Back", "SETUP_BACK_COUNTRY")]
]);

// Skip state button (for non-Indian users)
const skipStateKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("Skip", "SETUP_SKIP_STATE")],
    [Markup.button.callback("⬅️ Back", "SETUP_BACK_COUNTRY")]
]);

// Main menu keyboard
const mainMenuKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🔍 Search", "START_SEARCH")],
    [Markup.button.callback("⚙️ Settings", "OPEN_SETTINGS")],
    [Markup.button.callback("❓ Help", "START_HELP")]
]);

export default {
    name: "start",
    description: "Start the bot",
    execute: async (ctx: Context, bot: Telegraf<Context>) => {
        const userId = ctx.from?.id as number;
        
        // Save user's username if available
        const username = ctx.from?.username || ctx.from?.first_name || "Unknown";
        
        // Update user activity
        await updateLastActive(userId);
        
        // Check if user is new and increment user count
        const user = await getUser(userId);
        if (user.isNew) {
            // Set createdAt and lastActive for new users
            await updateUser(userId, { createdAt: Date.now(), lastActive: Date.now() });
            (bot as ExtraTelegraf).incrementUserCount();
            
            // New user - show improved profile setup
            await ctx.reply(
                "🌟 *Welcome to Anonymous Chat!* 🌟\n\n" +
                "Let's set up your profile to help you find great chat partners!\n\n" +
                "📝 *Step 1 of 3*\n" +
                "👤 *Select your gender:*",
                { parse_mode: "Markdown", ...genderKeyboard }
            );
            return;
        }
        
        // Update lastActive for returning users
        await updateLastActive(userId);

        // Existing user - show main menu
        await ctx.reply(
            "🌟 *Welcome back!* 🌟\n\n" +
            "This bot helps you chat anonymously with people worldwide.\n\n" +
            "Use the menu below to navigate:",
            { parse_mode: "Markdown", ...mainMenuKeyboard }
        );
    }
} as Command;

// Export keyboards for action handlers
export { mainMenuKeyboard };
