import { Context, Telegraf } from "telegraf";
import { Command } from "../Utils/commandHandler";
import { isAdmin } from "../Utils/adminAuth";

export default {
    name: "menu",
    description: "Open the menu",
    execute: async (ctx: Context, bot: Telegraf<Context>) => {
        const userId = ctx.from?.id as number;
        const webAppUrl = process.env.WEBAPP_URL || "http://localhost:3000";
        
        // Check if user is admin
        const adminStatus = isAdmin(userId);
        
        // Create inline keyboard with WebApp button
        const keyboard = {
            inline_keyboard: [
                [
                    {
                        text: "📋 Open Menu",
                        web_app: { url: webAppUrl }
                    }
                ]
            ]
        };
        
        await ctx.reply(
            "📋 Tap the button below to open the menu:",
            { reply_markup: keyboard }
        );
    }
} as Command;
