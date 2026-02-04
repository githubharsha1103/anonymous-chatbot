import { Context, Telegraf, Markup } from "telegraf";
import { Command } from "../Utils/commandHandler";
import { ExtraTelegraf } from "..";
import { getUser, updateUser } from "../storage/db";

// Profile setup keyboards
const genderKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("👨 Male", "SETUP_GENDER_MALE")],
    [Markup.button.callback("👩 Female", "SETUP_GENDER_FEMALE")]
]);

const ageInputKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("⬅️ Cancel", "SETUP_CANCEL")]
]);

const stateKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("Telangana", "SETUP_STATE_TELANGANA")],
    [Markup.button.callback("Andhra Pradesh", "SETUP_STATE_AP")]
]);

export default {
    name: "start",
    description: "Start the bot",
    execute: async (ctx: Context, bot: Telegraf<Context>) => {
        const userId = ctx.from?.id as number;
        
        // Save user's username if available
        const username = ctx.from?.username || ctx.from?.first_name || "Unknown";
        await updateUser(userId, { name: username });

        // Check if user is new and increment user count
        const user = await getUser(userId);
        if (user.isNew) {
            (bot as ExtraTelegraf).incrementUserCount();
            
            // New user - show profile setup (Gender → Age → State)
            await ctx.reply(
                "🌟 Welcome to Anonymous Chat! 🌟\n\nLet's set up your profile to get started.\n\n📝 *Step 1/3:* Please select your gender:",
                { parse_mode: "Markdown", ...genderKeyboard }
            );
            return;
        }

        // Existing user - show main menu
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback("🔍 Search", "START_SEARCH")],
            [Markup.button.callback("⚙️ Settings", "OPEN_SETTINGS")],
            [Markup.button.callback("❓ Help", "START_HELP")]
        ]);

        await ctx.reply(
            "🌟 Welcome back!\n\nThis bot helps you chat anonymously with people worldwide.\n\nUse the menu below to navigate:",
            keyboard
        );
    }
} as Command;
