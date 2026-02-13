import { Context } from "telegraf";
import { Command } from "../Utils/commandHandler";

const GROUP_INVITE_LINK = process.env.GROUP_INVITE_LINK || "https://t.me/teluguanomychat";

export default {
    name: "getgroupid",
    description: "Get the group chat ID from the invite link",
    adminOnly: true,
    execute: async (ctx: Context) => {
        if (!ctx.from) return;
        
        try {
            // Get chat info using the invite link
            const chat = await ctx.telegram.getChat(GROUP_INVITE_LINK);
            
            const chatId = chat.id;
            const chatType = chat.type;
            
            // Get title if available (for supergroups and channels)
            const chatTitle = (chat as any).title || "N/A";
            
            await ctx.reply(
                "📋 *Group Information*\n\n" +
                "🆔 *Chat ID:* `" + chatId + "`\n" +
                "📛 *Title:* " + chatTitle + "\n" +
                "👥 *Type:* " + chatType + "\n\n" +
                "💡 Copy the Chat ID to your .env file as GROUP_CHAT_ID",
                { parse_mode: "Markdown" }
            );
        } catch (error: any) {
            console.error("[GetGroupId] - Error:", error);
            await ctx.reply(
                "❌ *Error getting group info*\n\n" +
                "Make sure the bot is added to the group and the invite link is valid.\n\n" +
                "Error: " + (error.description || error.message),
                { parse_mode: "Markdown" }
            );
        }
    }
} as Command;
