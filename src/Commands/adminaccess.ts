import { Context } from "telegraf";
import { ExtraTelegraf, bot } from "..";
import { Command } from "../Utils/commandHandler";
import { Markup } from "telegraf";
import { getUser, updateUser, getAllUsers, readBans, isBanned, banUser, unbanUser, getReportCount, getBanReason, deleteUser, getReferralCount, verifyReferralCounts, fixReferralCounts, getGroupedReports, getAllReferralStats } from "../storage/db";

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
    [Markup.button.callback("🔍 Search by ID", "ADMIN_SEARCH_BY_ID")],
    [Markup.button.callback("🚫 View Bans", "ADMIN_BANS")],
    [Markup.button.callback("📊 Bot Statistics", "ADMIN_STATS")],
    [Markup.button.callback("💬 Active Chats", "ADMIN_ACTIVE_CHATS")],
    [Markup.button.callback("📢 Broadcast Message", "ADMIN_BROADCAST")],
    [Markup.button.callback("📣 Re-engagement", "ADMIN_REENGAGE")],
    [Markup.button.callback("📋 View Reports", "ADMIN_VIEW_REPORTS")],
    [Markup.button.callback("🔗 Referral Stats", "ADMIN_REFERRALS")],
    [Markup.button.callback("🔒 Logout", "ADMIN_LOGOUT")]
]);

const backKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🔙 Back to Menu", "ADMIN_BACK")]
]);

// Cancel keyboard for search by ID
const searchCancelKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("⬅️ Cancel", "ADMIN_SEARCH_BY_ID_CANCEL")]
]);

const userPages: Map<number, number> = new Map();

// Track admins waiting for broadcast input
export const waitingForBroadcast: Set<number> = new Set();

// Track admins waiting for user ID search input
export const waitingForUserId: Set<number> = new Set();

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
    // Helper function to validate admin permissions
    function validateAdmin(ctx: any): boolean {
        const adminId = ctx.from?.id;
        if (!adminId) return false;
        return isAdmin(adminId) || isAdminByUsername(ctx.from?.username);
    }

    // Safe editMessageText that handles all errors with fallback to reply
    // This prevents UI freeze when message can't be edited (too old, deleted, etc.)
    async function safeEditMessageText(ctx: any, text: string, extra?: any) {
        try {
            await ctx.editMessageText(text, extra);
        } catch (error: any) {
            // Check for "message not modified" - this is not an error
            if (error.description && error.description.includes("message is not modified")) {
                return; // Message already has same content
            }
            
            // For all other errors (message too old, not found, etc.), try to reply instead
            console.log("[adminaccess safeEditMessageText] Falling back to reply:", error.description || error.message);
            try {
                await ctx.reply(text, extra);
                return; // Exit after successful fallback
            } catch (replyError: any) {
                console.error("[adminaccess safeEditMessageText] Failed to reply:", replyError.message);
            }
        }
    }

    // Back to main menu
    bot.action("ADMIN_BACK", async (ctx) => {
        // Re-validate admin permissions
        const adminId = ctx.from?.id;
        if (!adminId || (!isAdmin(adminId) && !isAdminByUsername(ctx.from?.username))) {
            await safeAnswerCbQuery(ctx, "Unauthorized");
            return;
        }
        
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
        // Re-validate admin permissions
        if (!validateAdmin(ctx)) {
            await safeAnswerCbQuery(ctx, "Unauthorized");
            return;
        }
        await safeAnswerCbQuery(ctx);
        if (!ctx.from) return;
        userPages.set(ctx.from.id, 0);
        await showUsersPage(ctx, 0);
    });

    // Search user by ID
    bot.action("ADMIN_SEARCH_BY_ID", async (ctx) => {
        // Re-validate admin permissions
        if (!validateAdmin(ctx)) {
            await safeAnswerCbQuery(ctx, "Unauthorized");
            return;
        }
        await safeAnswerCbQuery(ctx);
        
        const adminId = ctx.from?.id;
        if (!adminId) return;
        
        // Set waiting flag
        waitingForUserId.add(adminId);
        console.log(`[ADMIN] - Admin ${adminId} started search by ID, waitingForUserId.size = ${waitingForUserId.size}`);
        
        await safeEditMessageText(ctx,
            "🔍 *Search User by ID*\n\n" +
            "✍️ Enter the User ID you want to search for.\n\n" +
            "Example: `123456789`\n\n" +
            "Use the button below to cancel.",
            { parse_mode: "Markdown", ...searchCancelKeyboard }
        );
    });

    // View bans
    bot.action("ADMIN_BANS", async (ctx) => {
        // Re-validate admin permissions
        if (!validateAdmin(ctx)) {
            await safeAnswerCbQuery(ctx, "Unauthorized");
            return;
        }
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
        // Re-validate admin permissions
        if (!validateAdmin(ctx)) {
            await safeAnswerCbQuery(ctx, "Unauthorized");
            return;
        }
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
        // Re-validate admin permissions
        if (!validateAdmin(ctx)) {
            await safeAnswerCbQuery(ctx, "Unauthorized");
            return;
        }
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
        // Re-validate admin permissions
        if (!validateAdmin(ctx)) {
            await safeAnswerCbQuery(ctx, "Unauthorized");
            return;
        }
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
        
        // Report keyboard - same as when partner leaves normally
        const reportKeyboard = Markup.inlineKeyboard([
            [Markup.button.callback("🚨 Report User", "OPEN_REPORT")]
        ]);
        
        // Notify both users that chat was terminated (show as partner left)
        try {
            await ctx.telegram.sendMessage(
                user1,
                `🚫 Partner left the chat\n\n/next - Find new partner\n\n━━━━━━━━━━━━━━━━━\nTo report this chat:`,
                { parse_mode: "Markdown", ...reportKeyboard }
            );
        } catch (e) {
            // User might have blocked the bot
        }
        
        try {
            await ctx.telegram.sendMessage(
                user2,
                `🚫 Partner left the chat\n\n/next - Find new partner\n\n━━━━━━━━━━━━━━━━━\nTo report this chat:`,
                { parse_mode: "Markdown", ...reportKeyboard }
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
        // Re-validate admin permissions
        if (!validateAdmin(ctx)) {
            await safeAnswerCbQuery(ctx, "Unauthorized");
            return;
        }
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

    // Cancel search by ID
    bot.action("ADMIN_SEARCH_BY_ID_CANCEL", async (ctx) => {
        await safeAnswerCbQuery(ctx);
        
        const adminId = ctx.from?.id;
        if (adminId) {
            waitingForUserId.delete(adminId);
        }
        
        await safeEditMessageText(ctx,
            "🔍 *Search User by ID*\n\n" +
            "Search cancelled.\n\n" +
            "Use the button below to return to menu.",
            { parse_mode: "Markdown", ...backKeyboard }
        );
    });

    // View Reports (SCALABLE - uses new Report collection)
    bot.action("ADMIN_VIEW_REPORTS", async (ctx) => {
        // Re-validate admin permissions
        if (!validateAdmin(ctx)) {
            await safeAnswerCbQuery(ctx, "Unauthorized");
            return;
        }

        await safeAnswerCbQuery(ctx);

        // Use new scalable getGroupedReports instead of looping through all users
        const reportedUsers = await getGroupedReports(10);

        if (reportedUsers.length === 0) {
            await safeEditMessageText(
                ctx,
                "📋 *Reported Users*\n\nNo users have been reported.\n\nUse the button below to return to menu.",
                { parse_mode: "Markdown", ...backKeyboard }
            );
            return;
        }

        // Build list with report reasons
        let reportList = "📋 Reported Users (Top 10)\n\n";
        reportList += `Total Reported Users: ${reportedUsers.length}\n\n`;
        
        const reportButtons = [];
        
        for (const { userId, count, latestReason, reporters } of reportedUsers) {
            const reporterList = reporters.slice(0, 3).join(", ") || "Various";
            
            reportList += `👤 \`${userId}\`\n`;
            reportList += `   📊 Reports: ${count}\n`;
            reportList += `   📝 Reason: ${latestReason || "No reason"}\n`;
            reportList += `   👁️ Reported by: ${reporterList}\n\n`;
            
            // Check if user is already banned
            const userBanned = await isBanned(userId);
            if (!userBanned) {
                reportButtons.push([
                    Markup.button.callback(
                        `🚫 Ban ${userId}`,
                        `ADMIN_BAN_USER_${userId}`
                    ),
                    Markup.button.callback(
                        `👁️ View ${userId}`,
                        `ADMIN_USER_${userId}`
                    )
                ]);
            } else {
                reportButtons.push([
                    Markup.button.callback(
                        `✅ Already Banned ${userId}`,
                        `ADMIN_USER_${userId}`
                    )
                ]);
            }
        }

        const keyboard = Markup.inlineKeyboard([
            ...reportButtons,
            [Markup.button.callback("🔙 Back to Menu", "ADMIN_BACK")]
        ]);

        await safeEditMessageText(
            ctx,
            reportList + "Select an action:",
            { parse_mode: "Markdown", ...keyboard }
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
        
        // Use optimized single-query function instead of looping
        const { totalReferrals, usersWithReferrals } = await getAllReferralStats();
        
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

    // Ban user from details - Also terminates active chats
    bot.action(/ADMIN_BAN_USER_(\d+)/, async (ctx) => {
        await safeAnswerCbQuery(ctx);
        const userId = parseInt(ctx.match[1]);
        const adminId = ctx.from?.id || 0;
        const reason = "Banned by admin";
        
        // Check if user is in an active chat and terminate it
        const partnerId = await terminateUserChat(ctx, bot, userId);
        
        // Ban the user with reason and admin ID
        await banUser(userId, reason, adminId);
        
        // Show feedback about chat termination if applicable
        if (partnerId) {
            await safeAnswerCbQuery(ctx, `User banned. Partner ${partnerId} removed from chat. ✅`);
        }
        
        await showUserDetails(ctx, userId);
    });

    // Helper function to terminate user's active chat
    async function terminateUserChat(ctx: any, botInstance: ExtraTelegraf, userId: number): Promise<number | null> {
        const runningChats = botInstance.runningChats;
        
        // Check if user is in active chat
        const userIndex = runningChats.indexOf(userId);
        if (userIndex === -1) {
            return null; // User is not in an active chat
        }
        
        // Find partner (if user is at even index, partner is at odd index, and vice versa)
        const partnerId = userIndex % 2 === 0 ? runningChats[userIndex + 1] : runningChats[userIndex - 1];
        
        if (!partnerId) {
            return null;
        }
        
        console.log(`[BAN] - Terminating chat between ${userId} and ${partnerId}`);
        
        // Remove both users from runningChats
        botInstance.runningChats = runningChats.filter(id => id !== userId && id !== partnerId);
        
        // Clear message maps
        botInstance.messageMap.delete(userId);
        botInstance.messageMap.delete(partnerId);
        botInstance.messageCountMap.delete(userId);
        botInstance.messageCountMap.delete(partnerId);
        
        // Reset chat start times for both users
        await updateUser(userId, { chatStartTime: null });
        await updateUser(partnerId, { chatStartTime: null });
        
        // Notify partner that chat ended
        try {
            await ctx.telegram.sendMessage(
                partnerId,
                "🚫 Your chat partner has been removed from the platform.\n\n/next - Find new partner"
            );
        } catch (error) {
            console.log(`[BAN] - Could not notify partner ${partnerId}:`, error);
        }
        
        return partnerId;
    }

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

    // Edit user gender
    bot.action(/ADMIN_EDIT_GENDER_(\d+)/, async (ctx) => {
        await safeAnswerCbQuery(ctx);
        const userId = parseInt(ctx.match[1]);
        
        const user = await getUser(userId);
        const currentGender = user?.gender || "Not set";
        
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback("👨 Male", `ADMIN_SET_GENDER_MALE_${userId}`)],
            [Markup.button.callback("👩 Female", `ADMIN_SET_GENDER_FEMALE_${userId}`)],
            [Markup.button.callback("🔙 Back", `ADMIN_USER_${userId}`)]
        ]);
        
        await safeEditMessageText(
            ctx,
            `<b>👫 Edit Gender</b>\n\nUser ID: <code>${userId}</code>\nCurrent Gender: <b>${currentGender}</b>\n\nSelect new gender:`,
            { parse_mode: "HTML", ...keyboard }
        );
    });

    // Set user gender to male
    bot.action(/ADMIN_SET_GENDER_MALE_(\d+)/, async (ctx) => {
        await safeAnswerCbQuery(ctx, "Gender updated to Male ✅");
        const userId = parseInt(ctx.match[1]);
        await updateUser(userId, { gender: "male" });
        await showUserDetails(ctx, userId);
    });

    // Set user gender to female
    bot.action(/ADMIN_SET_GENDER_FEMALE_(\d+)/, async (ctx) => {
        await safeAnswerCbQuery(ctx, "Gender updated to Female ✅");
        const userId = parseInt(ctx.match[1]);
        await updateUser(userId, { gender: "female" });
        await showUserDetails(ctx, userId);
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
    // Use try-catch with fallback to prevent UI freeze
    try {
        await ctx.editMessageText(text, { parse_mode: "Markdown", ...keyboard });
    } catch (error: any) {
        // Check for "message not modified" - ignore it
        if (error.description && error.description.includes("message is not modified")) {
            return;
        }
        // Fallback to reply for other errors
        try {
            await ctx.reply(text, { parse_mode: "Markdown", ...keyboard });
            return; // Exit after successful fallback
        } catch (replyError: any) {
            console.error("[showUsersPage] Failed to reply:", replyError.message);
        }
    }
}

export async function showUserDetails(ctx: any, userId: number) {
    const user = await getUser(userId);
    if (!user) {
        // Use try-catch with fallback to prevent UI freeze
        try {
            await ctx.editMessageText(
                "User not found.",
                { parse_mode: "HTML", ...backKeyboard }
            );
        } catch (error: any) {
            // Check for "message not modified" - ignore it
            if (error.description && error.description.includes("message is not modified")) {
                return;
            }
            // Fallback to reply for other errors
            try {
                await ctx.reply(
                    "User not found.",
                    { parse_mode: "HTML", ...backKeyboard }
                );
                return; // Exit after successful fallback
            } catch (replyError: any) {
                console.error("[showUserDetails] Failed to reply:", replyError.message);
            }
        }
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
        [Markup.button.callback("👫 Edit Gender", `ADMIN_EDIT_GENDER_${userId}`)],
        [Markup.button.callback("🔄 Reset Chats", `ADMIN_RESET_CHATS_${userId}`)],
        [Markup.button.callback("🔄 Reset Reports", `ADMIN_RESET_REPORTS_${userId}`)],
        [Markup.button.callback("🗑️ Delete User", `ADMIN_DELETE_USER_${userId}`)],
        [Markup.button.callback("🔙 Back to Users", "ADMIN_USERS")]
    ]);

    try {
        await ctx.editMessageText(details, { parse_mode: "HTML", ...keyboard });
    } catch (error: any) {
        // Check for "message not modified" - ignore it
        if (error.description && error.description.includes("message is not modified")) {
            return;
        }
        // Fallback to reply for other errors
        try {
            await ctx.reply(details, { parse_mode: "HTML", ...keyboard });
            return; // Exit after successful fallback
        } catch (replyError: any) {
            console.error("[showUserDetails] Failed to reply:", replyError.message);
        }
    }
}
