import { Context } from "telegraf";
import { ExtraTelegraf, bot } from "..";
import { Command } from "../Utils/commandHandler";
import { Markup } from "telegraf";
import { getUser, updateUser, getAllUsers, readBans, isBanned, banUser, unbanUser, getReportCount, getBanReason, deleteUser, getReferralCount, verifyReferralCounts, fixReferralCounts } from "../storage/db";

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

// Helper function to format duration
function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
        return `${minutes} min${minutes > 1 ? 's' : ''}`;
    } else {
        return `${seconds}s`;
    }
}

// Admin main menu with clear options
const mainKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("👥 View All Users", "ADMIN_USERS")],
    [Markup.button.callback("🚫 View Bans", "ADMIN_BANS")],
    [Markup.button.callback("📊 Bot Statistics", "ADMIN_STATS")],
    [Markup.button.callback("💬 Active Chats", "ADMIN_ACTIVE_CHATS")],
    [Markup.button.callback("📢 Broadcast Message", "ADMIN_BROADCAST")],
    [Markup.button.callback("📣 Re-engagement", "ADMIN_REENGAGE")],
    [Markup.button.callback("👤 Ban User", "ADMIN_BAN_USER")],
    [Markup.button.callback("🔗 Referral Stats", "ADMIN_REFERRALS")],
    [Markup.button.callback("🔒 Logout", "ADMIN_LOGOUT")]
]);

const backKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🔙 Back to Menu", "ADMIN_BACK")]
]);

const userPages: Map<number, number> = new Map();

// Track admins waiting for broadcast input
export const waitingForBroadcast: Set<number> = new Set();

async function safeAnswerCbQuery(ctx: any, text?: string) {
    try {
        if (ctx.callbackQuery?.id) {
            await ctx.answerCbQuery(text);
        }
    } catch (error: any) {
        console.error("[ADMIN ERROR] - answerCbQuery failed:", error?.message || error);
    }
}

export default {
    name: "adminaccess",
    description: "Admin panel access",
    execute: async (ctx: Context, bot: ExtraTelegraf) => {
        if (!ctx.from) return;

        const userId = ctx.from.id;
        
        if (!isAdmin(userId) && !isAdminByUsername(ctx.from.username)) {
            return ctx.reply("🚫 You are not authorized to access the admin panel.");
        }

        await updateUser(userId, { isAdminAuthenticated: true });
        return ctx.reply(
            "🔐 *Admin Panel*\n\nWelcome, Admin!\n\nSelect an option below:",
            { parse_mode: "Markdown", ...mainKeyboard }
        );
    }
} as Command;

export function initAdminActions(bot: ExtraTelegraf) {
    // Safe editMessageText that ignores "not modified" error
    async function safeEditMessageText(ctx: any, text: string, extra?: any) {
        try {
            await ctx.editMessageText(text, extra);
        } catch (error: any) {
            // Ignore "message is not modified" error
            if (!error.message?.includes("not modified")) {
                console.error("[ADMIN ERROR] -", error.message || error);
            }
        }
    }

    // Back to main menu
    bot.action("ADMIN_BACK", async (ctx) => {
        console.log("[ADMIN] - ADMIN_BACK action triggered for user:", ctx.from?.id);
        try {
            await safeAnswerCbQuery(ctx);
            console.log("[ADMIN] - Answered callback query");
            await safeEditMessageText(
                ctx,
                "🔐 *Admin Panel*\n\nWelcome, Admin!\n\nSelect an option below:",
                { parse_mode: "Markdown", ...mainKeyboard }
            );
            console.log("[ADMIN] - Edited message");
        } catch (err) {
            console.error("[ADMIN] - Error in ADMIN_BACK:", err);
        }
    });

    // View all users
    bot.action("ADMIN_USERS", async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (!ctx.from) return;
        userPages.set(ctx.from.id, 0);
        await showUsersPage(ctx, 0);
    });

    // View bans
    bot.action("ADMIN_BANS", async (ctx) => {
        await safeAnswerCbQuery(ctx);
        const bans = await readBans();
        if (bans.length === 0) {
            await safeEditMessageText(ctx,
                "🚫 *Banned Users*\n\nNo users are currently banned.\n\nUse the button below to return to menu.",
                { parse_mode: "Markdown", ...backKeyboard }
            );
        } else {
            const banList = bans.map((id: number) => `• ${id}`).join("\n");
            await safeEditMessageText(ctx,
                `🚫 *Banned Users*\n\nTotal: ${bans.length}\n\n${banList}\n\nUse the button below to return to menu.`,
                { parse_mode: "Markdown", ...backKeyboard }
            );
        }
    });

    // View stats
    bot.action("ADMIN_STATS", async (ctx) => {
        await safeAnswerCbQuery(ctx);
        const allUsers = await getAllUsers();
        const bans = await readBans();
        
        // Get total chats from bot instance
        const totalChats = bot.totalChats || 0;
        
        const stats = `📊 *Bot Statistics*\n\n` +
            `👥 Total Users: ${allUsers.length}\n` +
            `🚫 Banned Users: ${bans.length}\n` +
            `💬 Total Chats: ${totalChats}\n\n` +
            `Use the button below to return to menu.`;
        await safeEditMessageText(ctx, stats, { parse_mode: "Markdown", ...backKeyboard });
    });

    // View active chats
    bot.action("ADMIN_ACTIVE_CHATS", async (ctx) => {
        await safeAnswerCbQuery(ctx);
        
        const runningChats = bot.runningChats;
        const activeChatsCount = runningChats.length / 2;
        
        if (activeChatsCount === 0) {
            await safeEditMessageText(ctx,
                "💬 *Active Chats*\n\nNo active chats at the moment.\n\nUse the button below to return to menu.",
                { parse_mode: "Markdown", ...backKeyboard }
            );
            return;
        }
        
        // Build list of active chats
        const chatButtons = [];
        for (let i = 0; i < runningChats.length; i += 2) {
            const user1 = runningChats[i];
            const user2 = runningChats[i + 1];
            chatButtons.push([
                Markup.button.callback(`👥 Chat #${(i / 2) + 1}`, `ADMIN_SPECTATE_${user1}_${user2}`)
            ]);
        }
        
        const keyboard = Markup.inlineKeyboard([
            ...chatButtons,
            [Markup.button.callback("🔙 Back to Menu", "ADMIN_BACK")]
        ]);
        
        await safeEditMessageText(ctx,
            `💬 *Active Chats*\n\nTotal: ${activeChatsCount}\n\nSelect a chat to spectate:`,
            { parse_mode: "Markdown", ...keyboard }
        );
    });

    // Spectate a specific chat
    bot.action(/ADMIN_SPECTATE_(\d+)_(\d+)/, async (ctx) => {
        await safeAnswerCbQuery(ctx);
        
        const user1 = parseInt(ctx.match[1]);
        const user2 = parseInt(ctx.match[2]);
        const adminId = ctx.from?.id;
        
        if (!adminId) return;
        
        // Store spectator session
        bot.spectatingChats.set(adminId, { user1, user2 });
        
        // Get chat statistics
        const user1Data = await getUser(user1);
        const user2Data = await getUser(user2);
        
        // Calculate duration
        const chatStartTime = user1Data.chatStartTime || user2Data.chatStartTime;
        let durationText = "Unknown";
        if (chatStartTime) {
            const durationMs = Date.now() - chatStartTime;
            durationText = formatDuration(durationMs);
        }
        
        // Get message counts
        const user1Messages = bot.messageCountMap.get(user1) || 0;
        const user2Messages = bot.messageCountMap.get(user2) || 0;
        const totalMessages = user1Messages + user2Messages;
        
        // Format user info with gender and username
        const formatUserInfo = (userData: any, userId: number) => {
            const name = userData.name || "Unknown";
            const gender = userData.gender ? (userData.gender.charAt(0).toUpperCase() + userData.gender.slice(1)) : "Not set";
            const age = userData.age || "Not set";
            const state = userData.state || "Not set";
            return `<b>${name}</b> (${userId})\n` +
                   `👤 Gender: ${gender} | Age: ${age} | 📍 ${state}`;
        };
        
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback("🛑 Terminate Chat", `ADMIN_TERMINATE_${user1}_${user2}`)],
            [Markup.button.callback("🔙 Exit Spectator Mode", `ADMIN_EXIT_SPECTATE`)]
        ]);
        
        await safeEditMessageText(ctx,
            `<b>👁️ Spectating Chat</b>\n\n` +
            `<b>User 1:</b>\n${formatUserInfo(user1Data, user1)}\n\n` +
            `<b>User 2:</b>\n${formatUserInfo(user2Data, user2)}\n\n` +
            `<b>⏱️ Duration:</b> ${durationText}\n` +
            `<b>💬 Messages:</b> ${totalMessages} (U1: ${user1Messages}, U2: ${user2Messages})\n\n` +
            `Messages from this chat will be forwarded here in real-time.\n\n` +
            `Use the buttons below to manage the chat.`,
            { parse_mode: "HTML", ...keyboard }
        );
    });

    // Terminate a chat (admin action)
    bot.action(/ADMIN_TERMINATE_(\d+)_(\d+)/, async (ctx) => {
        await safeAnswerCbQuery(ctx);
        
        const user1 = parseInt(ctx.match[1]);
        const user2 = parseInt(ctx.match[2]);
        const adminId = ctx.from?.id;
        
        if (!adminId) return;
        
        // Remove from spectating chats
        bot.spectatingChats.delete(adminId);
        
        // Clean up chat state for both users
        bot.runningChats = bot.runningChats.filter(u => u !== user1 && u !== user2);
        bot.messageMap.delete(user1);
        bot.messageMap.delete(user2);
        bot.messageCountMap.delete(user1);
        bot.messageCountMap.delete(user2);
        
        // Clear chat start time
        await updateUser(user1, { chatStartTime: null });
        await updateUser(user2, { chatStartTime: null });
        
        // Notify both users that chat was terminated by admin
        try {
            await ctx.telegram.sendMessage(
                user1,
                `🚫 *Chat Terminated by Admin*\n\n` +
                `Your chat has been ended by an administrator.\n\n` +
                `Use /search to find a new partner.`,
                { parse_mode: "Markdown" }
            );
        } catch (e) {
            // User might have blocked the bot
        }
        
        try {
            await ctx.telegram.sendMessage(
                user2,
                `🚫 *Chat Terminated by Admin*\n\n` +
                `Your chat has been ended by an administrator.\n\n` +
                `Use /search to find a new partner.`,
                { parse_mode: "Markdown" }
            );
        } catch (e) {
            // User might have blocked the bot
        }
        
        await safeEditMessageText(ctx,
            `<b>✅ Chat Terminated</b>\n\n` +
            `Chat between <code>${user1}</code> and <code>${user2}</code> has been ended.\n\n` +
            `Both users have been notified.\n\n` +
            `Use the button below to return to menu.`,
            { parse_mode: "HTML", ...backKeyboard }
        );
    });

    // Exit spectator mode
    bot.action("ADMIN_EXIT_SPECTATE", async (ctx) => {
        await safeAnswerCbQuery(ctx);
        
        const adminId = ctx.from?.id;
        if (adminId) {
            bot.spectatingChats.delete(adminId);
        }
        
        // Redirect to active chats view
        await safeEditMessageText(ctx,
            "👁️ Spectator Mode Exited.\n\nUse the button below to return to menu.",
            { parse_mode: "Markdown", ...backKeyboard }
        );
    });

    // Broadcast message - ask for input
    bot.action("ADMIN_BROADCAST", async (ctx) => {
        await safeAnswerCbQuery(ctx);
        
        const adminId = ctx.from?.id;
        if (!adminId) return;
        
        // Set waiting flag
        waitingForBroadcast.add(adminId);
        console.log(`[ADMIN] - Admin ${adminId} started broadcast, waitingForBroadcast.size = ${waitingForBroadcast.size}`);
        
        await safeEditMessageText(ctx,
            "📢 *Broadcast Message*\n\n" +
            "✍️ Type and send the message you want to broadcast to all users.\n\n" +
            "Use the button below to cancel.",
            { parse_mode: "Markdown", ...backKeyboard }
        );
    });

    // Cancel broadcast
    bot.action("ADMIN_BROADCAST_CANCEL", async (ctx) => {
        await safeAnswerCbQuery(ctx);
        
        const adminId = ctx.from?.id;
        if (adminId) {
            waitingForBroadcast.delete(adminId);
        }
        
        await safeEditMessageText(ctx,
            "📢 *Broadcast Message*\n\n" +
            "Broadcast cancelled.\n\n" +
            "Use the button below to return to menu.",
            { parse_mode: "Markdown", ...backKeyboard }
        );
    });

    // Ban user
    bot.action("ADMIN_BAN_USER", async (ctx) => {
        await safeAnswerCbQuery(ctx);
        await safeEditMessageText(ctx,
            "👤 *Ban User*\n\n" +
            "To ban a user, use the /ban command with their User ID.\n\n" +
            "Example: /ban 1130645873\n\n" +
            "Use the button below to return to menu.",
            { parse_mode: "Markdown", ...backKeyboard }
        );
    });

    // Re-engagement campaign
    bot.action("ADMIN_REENGAGE", async (ctx) => {
        await safeAnswerCbQuery(ctx);
        
        // Check admin authentication
        const adminId = ctx.from?.id;
        if (!adminId) return;
        
        const user = await getUser(adminId);
        if (!user.isAdminAuthenticated) {
            return ctx.reply("🚫 You are not authorized to access this command.");
        }
        
        // Import and execute reengagement command
        const reengagementCommand = require("./reengagement").default;
        await reengagementCommand.execute(ctx, bot);
    });

    // Referral management
    bot.action("ADMIN_REFERRALS", async (ctx) => {
        await safeAnswerCbQuery(ctx);
        
        const allUsers = await getAllUsers();
        let totalReferrals = 0;
        let usersWithReferrals = 0;
        
        for (const id of allUsers) {
            const count = await getReferralCount(parseInt(id));
            totalReferrals += count;
            if (count > 0) usersWithReferrals++;
        }
        
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback("🔄 Verify & Fix Counts", "ADMIN_VERIFY_REFERRALS")],
            [Markup.button.callback("🔙 Back to Menu", "ADMIN_BACK")]
        ]);
        
        await safeEditMessageText(ctx,
            `🔗 *Referral Statistics*\n\n` +
            `👥 Users with Referrals: ${usersWithReferrals}\n` +
            `📊 Total Referrals: ${totalReferrals}\n\n` +
            `Use the button below to verify and fix any referral count discrepancies.`,
            { parse_mode: "Markdown", ...keyboard }
        );
    });

    // Verify and fix referral counts
    bot.action("ADMIN_VERIFY_REFERRALS", async (ctx) => {
        await safeAnswerCbQuery(ctx, "Verifying referral counts...");
        
        const { accurate, discrepancies } = await verifyReferralCounts();
        
        if (accurate) {
            await safeEditMessageText(ctx,
                `✅ *Referral Verification Complete*\n\n` +
                `All referral counts are accurate!\n` +
                `No discrepancies found.`,
                { parse_mode: "Markdown", ...backKeyboard }
            );
        } else {
            // Auto-fix the discrepancies
            const fixed = await fixReferralCounts();
            
            await safeEditMessageText(ctx,
                `⚠️ *Referral Verification Complete*\n\n` +
                `Found ${discrepancies.length} discrepancies.\n` +
                `Fixed ${fixed} referral counts.\n\n` +
                `Details:\n` +
                discrepancies.slice(0, 5).map(d => `• User ${d.userId}: ${d.stored} → ${d.actual}`).join("\n") +
                (discrepancies.length > 5 ? `\n...and ${discrepancies.length - 5} more` : ""),
                { parse_mode: "Markdown", ...backKeyboard }
            );
        }
    });

    // Logout
    bot.action("ADMIN_LOGOUT", async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (!ctx.from) return;
        await updateUser(ctx.from.id, { isAdminAuthenticated: false });
        await safeEditMessageText(ctx,
            "🔐 *Admin Panel*\n\nYou have been logged out.",
            { parse_mode: "Markdown" }
        );
    });

    // Pagination actions
    bot.action(/ADMIN_USERS_PAGE_(\d+)/, async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (!ctx.from) return;
        const page = parseInt(ctx.match[1]);
        userPages.set(ctx.from.id, page);
        await showUsersPage(ctx, page);
    });

    // View user details
    bot.action(/ADMIN_USER_(\d+)/, async (ctx) => {
        await safeAnswerCbQuery(ctx);
        const userId = parseInt(ctx.match[1]);
        await showUserDetails(ctx, userId);
    });

    // Ban user from details
    bot.action(/ADMIN_BAN_USER_(\d+)/, async (ctx) => {
        await safeAnswerCbQuery(ctx);
        const userId = parseInt(ctx.match[1]);
        const reason = "Banned by admin";
        await banUser(userId);
        await showUserDetails(ctx, userId);
    });

    // Unban user from details
    bot.action(/ADMIN_UNBAN_USER_(\d+)/, async (ctx) => {
        await safeAnswerCbQuery(ctx);
        const userId = parseInt(ctx.match[1]);
        await unbanUser(userId);
        await showUserDetails(ctx, userId);
    });

    // Grant premium access
    bot.action(/ADMIN_GRANT_PREMIUM_(\d+)/, async (ctx) => {
        await safeAnswerCbQuery(ctx, "Premium granted ✅");
        const userId = parseInt(ctx.match[1]);
        await updateUser(userId, { premium: true });
        await showUserDetails(ctx, userId);
    });

    // Revoke premium access
    bot.action(/ADMIN_REVOKE_PREMIUM_(\d+)/, async (ctx) => {
        await safeAnswerCbQuery(ctx, "Premium revoked ❌");
        const userId = parseInt(ctx.match[1]);
        await updateUser(userId, { premium: false });
        await showUserDetails(ctx, userId);
    });

    // Delete user
    bot.action(/ADMIN_DELETE_USER_(\d+)/, async (ctx) => {
        await safeAnswerCbQuery(ctx, "User deleted ❌");
        const userId = parseInt(ctx.match[1]);
        await deleteUser(userId, "admin_action");
        
        // Return to users list
        await showUsersPage(ctx, 0);
    });

    // Edit user name
    bot.action(/ADMIN_EDIT_NAME_(\d+)/, async (ctx) => {
        await safeAnswerCbQuery(ctx);
        const userId = parseInt(ctx.match[1]);
        
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback("🔙 Back", `ADMIN_USER_${userId}`)]
        ]);
        
        await ctx.editMessageText(
            `<b>📝 Edit Name</b>\n\nUser ID: <code>${userId}</code>\n\n` +
            `To change the user's name, use:\n` +
            `/setname ${userId} NewName\n\n` +
            `Use the button below to go back.`,
            { parse_mode: "HTML", ...keyboard }
        );
    });

    // Reset user chats
    bot.action(/ADMIN_RESET_CHATS_(\d+)/, async (ctx) => {
        await safeAnswerCbQuery(ctx, "Chats reset ✅");
        const userId = parseInt(ctx.match[1]);
        await updateUser(userId, { daily: 0 });
        await showUserDetails(ctx, userId);
    });

    // Reset user reports
    bot.action(/ADMIN_RESET_REPORTS_(\d+)/, async (ctx) => {
        await safeAnswerCbQuery(ctx, "Reports reset ✅");
        const userId = parseInt(ctx.match[1]);
        await updateUser(userId, { reportCount: 0, reportingPartner: null, reportReason: null });
        await showUserDetails(ctx, userId);
    });
}

async function showUsersPage(ctx: any, page: number) {
    const allUsers = await getAllUsers();
    const usersPerPage = 10;
    const totalPages = Math.ceil(allUsers.length / usersPerPage);
    const start = page * usersPerPage;
    const end = Math.min(start + usersPerPage, allUsers.length);
    const pageUsers = allUsers.slice(start, end);
    
    const userButtons = await Promise.all(pageUsers.map(async (id: string) => {
        const userId = parseInt(id);
        const user = await getUser(userId);
        
        // Use saved name or try to get from Telegram
        let name = user.name;
        if (!name || name === "Unknown") {
            try {
                const chat = await ctx.telegram.getChat(userId);
                name = chat.username || chat.first_name || "Unknown";
            } catch {
                name = "Unknown";
            }
        }
        
        const status = (await isBanned(userId)) ? "🚫" : "✅";
        return [Markup.button.callback(`${status} ${name} (${id})`, `ADMIN_USER_${id}`)];
    }));
    
    const navButtons = [];
    if (page > 0) {
        navButtons.push(Markup.button.callback("◀️ Prev", `ADMIN_USERS_PAGE_${page - 1}`));
    }
    if (page < totalPages - 1) {
        navButtons.push(Markup.button.callback("Next ▶️", `ADMIN_USERS_PAGE_${page + 1}`));
    }
    
    const keyboard = Markup.inlineKeyboard([
        ...userButtons,
        ...(navButtons.length > 0 ? [navButtons] : []),
        [Markup.button.callback("🔙 Back to Menu", "ADMIN_BACK")]
    ]);
    
    const text = `👥 *All Users* (${allUsers.length})\n\nPage ${page + 1}/${totalPages}\n\nClick on a user to view details.`;
    try {
        await ctx.editMessageText(text, { parse_mode: "Markdown", ...keyboard });
    } catch (e: any) {
        // Ignore "message is not modified" error
        if (!e.message?.includes("not modified")) {
            console.error("[ADMIN ERROR] -", e.message || e);
        }
    }
}

async function showUserDetails(ctx: any, userId: number) {
    const user = await getUser(userId);
    if (!user) {
        await ctx.editMessageText(
            "User not found.",
            { parse_mode: "Markdown", ...backKeyboard }
        );
        return;
    }

    // Use saved name or try to get from Telegram
    let name = user.name;
    if (!name || name === "Not set" || name === "Unknown") {
        try {
            const chat = await ctx.telegram.getChat(userId);
            name = chat.username || chat.first_name || "Not set";
        } catch {
            name = "Not set";
        }
    }

    const gender = user.gender || "Not set";
    const age = user.age || "Not set";
    const state = user.state || "Not set";
    const totalChats = user.totalChats || 0;
    const reports = await getReportCount(userId);
    const banReason = await getBanReason(userId);
    const isUserBanned = await isBanned(userId);
    const referralCount = await getReferralCount(userId);
    
    // Format preference safely
    const preference = user.premium 
      ? (user.preference === "any" ? "Any" : user.preference === "male" ? "Male" : user.preference === "female" ? "Female" : "Any")
      : "🔒 Premium Only";
    
    // Format last active time
    const lastActiveText = user.lastActive 
      ? new Date(user.lastActive).toLocaleString()
      : "Never";

    let details = `<b>👤 User Details</b>\n\n` +
        `🆔 User ID: <code>${userId}</code>\n` +
        `📛 Name: ${name}\n` +
        `⚧️ Gender: ${gender}\n` +
        `🎂 Age: ${age}\n` +
        `📍 State: ${state}\n` +
        `💕 Preference: ${preference}\n` +
        `💬 Total Chats: ${totalChats}\n` +
        `👥 Referrals: ${referralCount}\n` +
        `⚠️ Reports: ${reports}\n` +
        `💎 Premium: ${user.premium ? "Yes ✅" : "No ❌"}\n` +
        `🕐 Last Active: ${lastActiveText}`;

    if (isUserBanned) {
        details += `\n🚫 <b>Banned</b>: Yes\n` +
            `📝 Ban Reason: ${banReason || "Not specified"}`;
    } else {
        details += `\n🚫 <b>Banned</b>: No`;
    }

    // Add ban/unban button
    const actionButtons = [];
    if (isUserBanned) {
        actionButtons.push(Markup.button.callback("🔓 Unban User", `ADMIN_UNBAN_USER_${userId}`));
    } else {
        actionButtons.push(Markup.button.callback("🚫 Ban User", `ADMIN_BAN_USER_${userId}`));
    }

    // Add premium button
    const premiumButtons = [];
    if (user.premium) {
        premiumButtons.push(Markup.button.callback("❌ Revoke Premium", `ADMIN_REVOKE_PREMIUM_${userId}`));
    } else {
        premiumButtons.push(Markup.button.callback("💎 Grant Premium", `ADMIN_GRANT_PREMIUM_${userId}`));
    }

    const keyboard = Markup.inlineKeyboard([
        actionButtons,
        premiumButtons,
        [Markup.button.callback("✏️ Edit Name", `ADMIN_EDIT_NAME_${userId}`)],
        [Markup.button.callback("🔄 Reset Chats", `ADMIN_RESET_CHATS_${userId}`)],
        [Markup.button.callback("🔄 Reset Reports", `ADMIN_RESET_REPORTS_${userId}`)],
        [Markup.button.callback("🗑️ Delete User", `ADMIN_DELETE_USER_${userId}`)],
        [Markup.button.callback("🔙 Back to Users", "ADMIN_USERS")]
    ]);

    try {
        await ctx.editMessageText(details, { parse_mode: "Markdown", ...keyboard });
    } catch (e) {
        // Ignore "message is not modified" error
    }
}
