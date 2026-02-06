import { Context, Telegraf } from "telegraf";
import { Command } from "../Utils/commandHandler";
import { removeKeyboard } from "telegraf/markup";

export default {
    name: "help",
    description: "See the available commands",
    execute: async (ctx: Context, bot: Telegraf<Context>) => {
        await ctx.reply(
            "📚 <b>Available Commands:</b>\n\n" +
            "/start - Start the bot\n" +
            "/search - Find a chat partner\n" +
            "/next - Skip current chat and find new partner\n" +
            "/end - End the current chat\n" +
            "/settings - Open settings menu\n" +
            "/report - Report a user\n" +
            "/referral - Invite friends & earn premium\n" +
            "/help - Show this help message",
            { parse_mode: "HTML", ...removeKeyboard() }
        );
    }
} as Command;
