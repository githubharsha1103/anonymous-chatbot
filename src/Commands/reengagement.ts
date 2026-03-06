import { Context, Markup } from "telegraf";
import { Command } from "../Utils/commandHandler";
import { ExtraTelegraf } from "..";
import { getInactiveUsers, getUserStats } from "../storage/db";
import { broadcastWithRateLimit, sendMessageWithRetry } from "../Utils/telegramErrorHandler";
import { isAdmin, isAdminByUsername, isAdminContext } from "../Utils/adminAuth";

// Removed local isAdmin/isAdminByUsername - now using shared utility from adminAuth.ts

const backKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🔙 Back to Menu", "ADMIN_BACK")]
]);

function checkAdmin(ctx: Context): boolean {
    return isAdminContext(ctx);
}

// Helper function for safe editMessageText
export async function safeEditMessageText(ctx: any, text: string, extra?: any) {
    try {
        await ctx.editMessageText(text, extra);
    } catch (error: any) {
        // Check for "message not modified" - this is not an error
        if (error.description && error.description.includes("message is not modified")) {
            return;
        }
        // For all other errors, try to reply instead to prevent UI freeze
        console.log("[Reengagement safeEditMessageText] Falling back to reply:", error.description || error.message);
        try {
            await ctx.reply(text, extra);
            return; // Exit after successful fallback
        } catch (replyError: any) {
            console.error("[Reengagement safeEditMessageText] Failed to reply:", replyError.message);
        }
    }
}

export default {
    name: "reengagement",
    description: "Re-engagement campaign for inactive users",
    execute: async (ctx: Context, bot: ExtraTelegraf, useEdit: boolean = false) => {
        const adminId = ctx.from?.id;
        
        if (!adminId) return ctx.reply("Error: Could not identify user.");
        
        // Check if admin (supports both ID and username)
        if (!checkAdmin(ctx)) {
            return ctx.reply("🚫 You are not authorized to access this command.");
        }

        // Get user stats
        const stats = await getUserStats();
        
        const text = 
`<b>📊 Re-engagement Campaign</b>

<b>User Statistics:</b>
• Total Users: ${stats.total}
• Active Today: ${stats.activeToday}
• Inactive (7+ days): ${stats.inactive7Days}
• Inactive (30+ days): ${stats.inactive30Days}

Select inactive users to notify:`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback(`📢 Notify 7+ Days Inactive (${stats.inactive7Days} users)`, "REENGAGE_7")],
            [Markup.button.callback(`📢 Notify 30+ Days Inactive (${stats.inactive30Days} users)`, "REENGAGE_30")],
            [Markup.button.callback("🔙 Back to Menu", "ADMIN_BACK")]
        ]);

        if (useEdit) {
            // When called from admin panel, use editMessageText for transition effect
            await safeEditMessageText(ctx, text, { parse_mode: "HTML", ...keyboard });
        } else {
            await ctx.reply(text, { parse_mode: "HTML", ...keyboard });
        }
    }
} as Command;

// Pre-defined re-engagement messages
const reengageMessages = {
    "7": [
        "👋 Hey! We miss you!",
        "Your chat friends are waiting for you!",
        "Come back and make new connections today!",
        "💬 Someone wants to chat with you!",
        "🎉 Your anonymous friends are online!"
    ],
    "30": [
        "🌟 We miss you! Come back for new chats!",
        "👋 Long time no see! Your chat buddies are here!",
        "🎯 Fresh connections waiting for you!",
        "💭 Someone amazing wants to chat with you!",
        "🔥 Don't miss out on new conversations!"
    ]
};

// Helper function for safe answer callback query
async function safeAnswerCbQuery(ctx: any, text?: string) {
    try {
        if (ctx.callbackQuery?.id) {
            await ctx.answerCbQuery(text);
        }
    } catch {
        // Ignore errors
    }
}

export function initReengagementActions(bot: ExtraTelegraf) {
    // Handle 7-day inactive notification
    bot.action("REENGAGE_7", async (ctx) => {
        if (!ctx.from) return safeAnswerCbQuery(ctx, "Error");
        
        if (!checkAdmin(ctx)) return safeAnswerCbQuery(ctx, "🚫 Not authorized");

        const inactiveUsers = await getInactiveUsers(7);
        
        if (inactiveUsers.length === 0) {
            await safeAnswerCbQuery(ctx, "No users inactive for 7+ days");
            return safeEditMessageText(ctx, "<b>📊 Re-engagement Campaign</b>\n\nNo users inactive for 7+ days! 🎉", { parse_mode: "HTML", ...backKeyboard });
        }

        const message = 
`<b>📢 Confirm Re-engagement Campaign</b>

<b>Target:</b> ${inactiveUsers.length} users (inactive 7+ days)

<b>Preview Message:</b>
"${reengageMessages["7"][0]}"

Ready to send?`;

        const confirmKeyboard = Markup.inlineKeyboard([
            [Markup.button.callback("✅ Yes, Send", "REENGAGE_7_SEND")],
            [Markup.button.callback("❌ Cancel", "ADMIN_BACK")]
        ]);

        await safeAnswerCbQuery(ctx);
        await safeEditMessageText(ctx, message, { parse_mode: "HTML", ...confirmKeyboard });
    });

    // Handle 30-day inactive notification
    bot.action("REENGAGE_30", async (ctx) => {
        if (!ctx.from) return safeAnswerCbQuery(ctx, "Error");
        
        if (!checkAdmin(ctx)) return safeAnswerCbQuery(ctx, "🚫 Not authorized");

        const inactiveUsers = await getInactiveUsers(30);
        
        if (inactiveUsers.length === 0) {
            await safeAnswerCbQuery(ctx, "No users inactive for 30+ days");
            return safeEditMessageText(ctx, "<b>📊 Re-engagement Campaign</b>\n\nNo users inactive for 30+ days! 🎉", { parse_mode: "HTML", ...backKeyboard });
        }

        const message = 
`<b>📢 Confirm Re-engagement Campaign</b>

<b>Target:</b> ${inactiveUsers.length} users (inactive 30+ days)

<b>Preview Message:</b>
"${reengageMessages["30"][0]}"

Ready to send?`;

        const confirmKeyboard = Markup.inlineKeyboard([
            [Markup.button.callback("✅ Yes, Send", "REENGAGE_30_SEND")],
            [Markup.button.callback("❌ Cancel", "ADMIN_BACK")]
        ]);

        await safeAnswerCbQuery(ctx);
        await safeEditMessageText(ctx, message, { parse_mode: "HTML", ...confirmKeyboard });
    });

    // Send 7-day re-engagement
    bot.action("REENGAGE_7_SEND", async (ctx) => {
        if (!ctx.from) return safeAnswerCbQuery(ctx, "Error");
        
        if (!checkAdmin(ctx)) return safeAnswerCbQuery(ctx, "🚫 Not authorized");

        const inactiveUsers = await getInactiveUsers(7);
        if (inactiveUsers.length === 0) return safeAnswerCbQuery(ctx, "No users found");

        await safeAnswerCbQuery(ctx, "Sending...");

        const message = reengageMessages["7"][Math.floor(Math.random() * reengageMessages["7"].length)];
        const introText = 
`<b>📢 We're Back!</b>

${message}

👆 Click to start chatting!

🔒 Anonymous & Safe
🌍 Connect Worldwide

/start`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback("🚀 Start Chatting", "START_SEARCH")]
        ]);

        // Use broadcastWithRateLimit for sequential safe sending
        const userIds = inactiveUsers.map(id => parseInt(id)).filter(id => !isNaN(id));
        
        console.log(`[REENGAGE_7] - Starting to send to ${userIds.length} users`);
        
        const result = await broadcastWithRateLimit(
            bot,
            userIds,
            introText,
            { parse_mode: "HTML", reply_markup: keyboard.reply_markup }
        );

        await safeEditMessageText(ctx,
            `<b>✅ 7-Day Re-engagement Complete!</b>\n\n📤 Sent: ${result.success}\n❌ Failed: ${result.failed}\n📊 Total: ${userIds.length}`,
            { parse_mode: "HTML", ...backKeyboard }
        );
    });

    // Send 30-day re-engagement
    bot.action("REENGAGE_30_SEND", async (ctx) => {
        if (!ctx.from) return safeAnswerCbQuery(ctx, "Error");
        
        if (!checkAdmin(ctx)) return safeAnswerCbQuery(ctx, "🚫 Not authorized");

        const inactiveUsers = await getInactiveUsers(30);
        if (inactiveUsers.length === 0) return safeAnswerCbQuery(ctx, "No users found");

        await safeAnswerCbQuery(ctx, "Sending...");

        const message = reengageMessages["30"][Math.floor(Math.random() * reengageMessages["30"].length)];
        const introText = 
`<b>🌟 We Miss You!</b>

${message}

👆 Come back for amazing chats!

🔒 100% Anonymous
💬 Make New Friends

/start`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback("🚀 Let's Chat!", "START_SEARCH")]
        ]);

        // Use broadcastWithRateLimit for sequential safe sending
        const userIds = inactiveUsers.map(id => parseInt(id)).filter(id => !isNaN(id));
        
        console.log(`[REENGAGE_30] - Starting to send to ${userIds.length} users`);
        
        const result = await broadcastWithRateLimit(
            bot,
            userIds,
            introText,
            { parse_mode: "HTML", reply_markup: keyboard.reply_markup }
        );

        await safeEditMessageText(ctx,
            `<b>✅ 30-Day Re-engagement Complete!</b>\n\n📤 Sent: ${result.success}\n❌ Failed: ${result.failed}\n📊 Total: ${userIds.length}`,
            { parse_mode: "HTML", ...backKeyboard }
        );
    });
}
