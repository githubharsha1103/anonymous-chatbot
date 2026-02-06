import { Context, Markup } from "telegraf";
import { Command } from "../Utils/commandHandler";
import { ExtraTelegraf } from "..";
import { getInactiveUsers, getUserStats } from "../storage/db";

const backKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🔙 Back to Menu", "ADMIN_BACK")]
]);

// Admin checking functions (same as adminaccess.ts)
const ADMINS = process.env.ADMIN_IDS?.split(",") || [];

function isAdmin(id: number) {
    return ADMINS.some(admin => {
        if (/^\d+$/.test(admin)) {
            return admin === id.toString();
        }
        return false;
    });
}

function isAdminByUsername(username: string | undefined) {
    if (!username) return false;
    return ADMINS.some(admin => admin.startsWith("@") && admin.toLowerCase() === `@${username.toLowerCase()}`);
}

function checkAdmin(ctx: Context): boolean {
    const userId = ctx.from?.id;
    const username = ctx.from?.username;
    if (!userId) return false;
    return isAdmin(userId) || isAdminByUsername(username);
}

export default {
    name: "reengagement",
    description: "Re-engagement campaign for inactive users",
    execute: async (ctx: Context, bot: ExtraTelegraf) => {
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

        await ctx.reply(text, { parse_mode: "HTML", ...keyboard });
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

export function initReengagementActions(bot: ExtraTelegraf) {
    // Handle 7-day inactive notification
    bot.action("REENGAGE_7", async (ctx) => {
        if (!ctx.from) return ctx.answerCbQuery("Error");
        
        if (!checkAdmin(ctx)) return ctx.answerCbQuery("🚫 Not authorized");

        const inactiveUsers = await getInactiveUsers(7);
        
        if (inactiveUsers.length === 0) {
            await ctx.answerCbQuery("No users inactive for 7+ days");
            return ctx.editMessageText("<b>📊 Re-engagement Campaign</b>\n\nNo users inactive for 7+ days! 🎉", { parse_mode: "HTML", ...backKeyboard });
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

        await ctx.answerCbQuery();
        await ctx.editMessageText(message, { parse_mode: "HTML", ...confirmKeyboard });
    });

    // Handle 30-day inactive notification
    bot.action("REENGAGE_30", async (ctx) => {
        if (!ctx.from) return ctx.answerCbQuery("Error");
        
        if (!checkAdmin(ctx)) return ctx.answerCbQuery("🚫 Not authorized");

        const inactiveUsers = await getInactiveUsers(30);
        
        if (inactiveUsers.length === 0) {
            await ctx.answerCbQuery("No users inactive for 30+ days");
            return ctx.editMessageText("<b>📊 Re-engagement Campaign</b>\n\nNo users inactive for 30+ days! 🎉", { parse_mode: "HTML", ...backKeyboard });
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

        await ctx.answerCbQuery();
        await ctx.editMessageText(message, { parse_mode: "HTML", ...confirmKeyboard });
    });

    // Send 7-day re-engagement
    bot.action("REENGAGE_7_SEND", async (ctx) => {
        if (!ctx.from) return ctx.answerCbQuery("Error");
        
        if (!checkAdmin(ctx)) return ctx.answerCbQuery("🚫 Not authorized");

        const inactiveUsers = await getInactiveUsers(7);
        if (inactiveUsers.length === 0) return ctx.answerCbQuery("No users found");

        await ctx.answerCbQuery("Sending...");

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

        let sent = 0;
        let failed = 0;

        for (const id of inactiveUsers) {
            const userId = parseInt(id);
            if (isNaN(userId)) continue;
            
            try {
                await bot.telegram.sendMessage(userId, introText, { parse_mode: "HTML", ...keyboard });
                sent++;
            } catch {
                failed++;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        await ctx.editMessageText(
            `<b>✅ 7-Day Re-engagement Complete!</b>\n\n📤 Sent: ${sent}\n❌ Failed: ${failed}`,
            { parse_mode: "HTML", ...backKeyboard }
        );
    });

    // Send 30-day re-engagement
    bot.action("REENGAGE_30_SEND", async (ctx) => {
        if (!ctx.from) return ctx.answerCbQuery("Error");
        
        if (!checkAdmin(ctx)) return ctx.answerCbQuery("🚫 Not authorized");

        const inactiveUsers = await getInactiveUsers(30);
        if (inactiveUsers.length === 0) return ctx.answerCbQuery("No users found");

        await ctx.answerCbQuery("Sending...");

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

        let sent = 0;
        let failed = 0;

        for (const id of inactiveUsers) {
            const userId = parseInt(id);
            if (isNaN(userId)) continue;
            
            try {
                await bot.telegram.sendMessage(userId, introText, { parse_mode: "HTML", ...keyboard });
                sent++;
            } catch {
                failed++;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        await ctx.editMessageText(
            `<b>✅ 30-Day Re-engagement Complete!</b>\n\n📤 Sent: ${sent}\n❌ Failed: ${failed}`,
            { parse_mode: "HTML", ...backKeyboard }
        );
    });
}
