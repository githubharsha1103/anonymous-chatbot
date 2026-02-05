import { Context, Telegraf, Markup } from "telegraf";
import { Command } from "../Utils/commandHandler";
import { ExtraTelegraf } from "..";
import { getUser, updateUser, updateLastActive } from "../storage/db";

// Setup step constants
export const SETUP_STEP_GENDER = "gender";
export const SETUP_STEP_AGE = "age";
export const SETUP_STEP_STATE = "state";
export const SETUP_STEP_DONE = "done";

// Welcome keyboard with animated welcome
const welcomeKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🌟 Get Started", "SETUP_GENDER_MALE")]
]);

// Gender selection with back button
const genderKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("👨 Male", "SETUP_GENDER_MALE")],
    [Markup.button.callback("👩 Female", "SETUP_GENDER_FEMALE")],
    [Markup.button.callback("⬅️ Back", "WELCOME_BACK")]
]);

// Cancel button for input steps
const cancelKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("⬅️ Cancel", "SETUP_CANCEL")]
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
        
        // Initialize new user
        if (user.isNew) {
            await updateUser(userId, { 
                createdAt: Date.now(), 
                lastActive: Date.now(),
                name: username
            });
            (bot as ExtraTelegraf).incrementUserCount();
            
            // New user - show animated welcome with Get Started button
            await ctx.reply(
                "🌟 *Welcome to Anonymous Chat!* 🌟\n\n" +
                "✨ Connect with strangers anonymously\n" +
                "🔒 Your privacy is protected\n" +
                "💬 Chat freely and safely\n\n" +
                "Tap *Get Started* to begin!",
                { parse_mode: "Markdown", ...welcomeKeyboard }
            );
            return;
        }
        
        // Update lastActive for returning users
        await updateLastActive(userId);

        // Check if user is in the middle of setup
        const setupStep = (user as any).setupStep;
        
        if (setupStep === SETUP_STEP_AGE) {
            // User needs to enter age - show age range buttons
            const ageKeyboard = Markup.inlineKeyboard([
                [Markup.button.callback("13-17", "SETUP_AGE_13_17")],
                [Markup.button.callback("18-25", "SETUP_AGE_18_25")],
                [Markup.button.callback("26-40", "SETUP_AGE_26_40")],
                [Markup.button.callback("40+", "SETUP_AGE_40_PLUS")],
                [Markup.button.callback("📝 Type Age", "SETUP_AGE_MANUAL")],
                [Markup.button.callback("⬅️ Back", "SETUP_BACK_GENDER")]
            ]);
            
            await ctx.reply(
                "📝 *Step 2 of 3*\n\n" +
                "🎂 *Select your age range:*\n" +
                "(This helps us match you with people in similar age groups)",
                { parse_mode: "Markdown", ...ageKeyboard }
            );
            return;
        }
        
        if (setupStep === SETUP_STEP_STATE) {
            // User needs to select state
            const stateKeyboard = Markup.inlineKeyboard([
                [Markup.button.callback("🟢 Telangana", "SETUP_STATE_TELANGANA")],
                [Markup.button.callback("🔵 Andhra Pradesh", "SETUP_STATE_AP")],
                [Markup.button.callback("🇮🇳 Other Indian State", "SETUP_STATE_OTHER")],
                [Markup.button.callback("🌍 Outside India", "SETUP_COUNTRY_OTHER")],
                [Markup.button.callback("⬅️ Back", "SETUP_BACK_AGE")]
            ]);
            
            await ctx.reply(
                "📝 *Step 3 of 3*\n\n" +
                "📍 *Select your location:*\n" +
                "(Helps match you with nearby people)",
                { parse_mode: "Markdown", ...stateKeyboard }
            );
            return;
        }

        // Existing user with complete profile - show main menu
        await ctx.reply(
            "🌟 *Welcome back!* 🌟\n\n" +
            "This bot helps you chat anonymously with people worldwide.\n\n" +
            "Use the menu below to navigate:",
            { parse_mode: "Markdown", ...mainMenuKeyboard }
        );
    }
} as Command;

// Export keyboards for action handlers
export { mainMenuKeyboard, cancelKeyboard, genderKeyboard };
