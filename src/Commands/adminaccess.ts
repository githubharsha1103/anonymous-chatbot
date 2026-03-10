import { Context } from "telegraf";
import { ExtraTelegraf } from "..";
import { Command } from "../Utils/commandHandler";
import { Markup } from "telegraf";
import { getUser, updateUser, getAllUsers, readBans, isBanned, banUser, unbanUser, getReportCount, getBanReason, deleteUser, getReferralCount, verifyReferralCounts, fixReferralCounts, getGroupedReports, getGroupedReportsCount, getAllReferralStats, tempBanUser, getUserLatestReportReason, resetUserReports, getDatabaseStatus } from "../storage/db";
import { isAdmin, isAdminContext, unauthorizedResponse } from "../Utils/adminAuth";
import { getErrorMessage } from "../Utils/telegramUi";
import { buildPartnerLeftMessage, clearChatRuntime, exitChatKeyboard } from "../Utils/chatFlow";

// Removed local isAdmin/isAdminByUsername - now using shared utility from adminAuth.ts

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
const reportPages: Map<number, number> = new Map();

// Track admins waiting for broadcast input
export const waitingForBroadcast: Set<number> = new Set();

// Track admins waiting for user ID search input
export const waitingForUserId: Set<number> = new Set();

function clearAdminInputState(adminId: number) {
    waitingForBroadcast.delete(adminId);
    waitingForUserId.delete(adminId);
}

type CallbackContext = Context & {
    callbackQuery?: { id?: string };
    answerCbQuery?: (text?: string) => Promise<unknown>;
};

async function safeAnswerCbQuery(ctx: CallbackContext, text?: string) {
    try {
        if (ctx.callbackQuery?.id) {
            await ctx.answerCbQuery?.(text);
        }
    } catch (error: unknown) {
        console.error("[ADMIN ERROR] - answerCbQuery failed:", getErrorMessage(error));
    }
}

export default {
    name: "adminaccess",
    description: "Admin panel access",
    execute: async (ctx: Context, bot: ExtraTelegraf) => {
        if (!ctx.from) return;

        const userId = ctx.from.id;
        
        if (!isAdmin(userId)) {
            return ctx.reply("🚫 You are not authorized to access the admin panel.");
        }

        await updateUser(userId, { isAdminAuthenticated: true });
        
        // Check if this is a private chat
        const isPrivateChat = ctx.from.id === ctx.chat?.id;
        
        // Get bot username safely
        const botUsername = bot.botInfo?.username || "the bot";
        
        if (!isPrivateChat) {
            // Tell user to check their private chat with the bot
            try {
                await ctx.reply(
                    `🔐 I've sent the admin panel to my private chat with you.\n` +
                    `Please check @${botUsername} in a private conversation.`,
                    { parse_mode: "Markdown" }
                );
            } catch (error) {
                console.error("[ADMIN] Failed to send instruction to group:", error);
            }
        }
        
        // Always send admin panel to private chat with error handling
        try {
            return await ctx.telegram.sendMessage(
                userId,
                "🔐 *Admin Panel*\n\nWelcome, Admin!\n\nSelect an option below:",
                { parse_mode: "Markdown", ...mainKeyboard }
            );
        } catch (error: unknown) {
            const errorMessage = getErrorMessage(error);
            // Handle case where admin hasn't started a conversation with bot
            if (errorMessage.includes("chat not found") || errorMessage.includes("bot was blocked by the user")) {
                console.log("[ADMIN] Admin hasn't started conversation with bot yet");
                return ctx.reply(
                    "⚠️ Please start a private chat with me first before using admin panel.\n" +
                    `Click here: t.me/${botUsername}`,
                    { parse_mode: "Markdown" }
                );
            }
            console.error("[ADMIN] Failed to send admin panel:", error);
            return ctx.reply("⚠️ Failed to open admin panel. Please try again.", { parse_mode: "Markdown" });
        }
    }
} as Command;

export function initAdminActions(bot: ExtraTelegraf) {
    // Helper function to validate admin permissions (using shared utility)
    function validateAdmin(ctx: Context): boolean {
        return isAdminContext(ctx);
    }

    // Safe editMessageText that handles all errors with fallback to reply
    // This prevents UI freeze when message can't be edited (too old, deleted, etc.)
    async function safeEditMessageText(ctx: Context, text: string, extra?: unknown) {
        try {
            await ctx.editMessageText(text, extra as Parameters<Context["editMessageText"]>[1]);
        } catch (error: unknown) {
            // Check for "message not modified" - this is not an error
            const errorMessage = getErrorMessage(error);
            if (errorMessage.includes("message is not modified")) {
                return; // Message already has same content
            }
            
            // For all other errors (message too old, not found, etc.), try to reply instead
            console.log("[adminaccess safeEditMessageText] Falling back to reply:", errorMessage);
            try {
                await ctx.reply(text, extra as Parameters<Context["reply"]>[1]);
                return; // Exit after successful fallback
            } catch (replyError: unknown) {
                console.error("[adminaccess safeEditMessageText] Failed to reply:", getErrorMessage(replyError));
            }
        }
    }

    async function showReportsList(ctx: Context, page: number = 0) {
        const pageSize = 10;
        const totalReportedUsers = await getGroupedReportsCount();

        if (totalReportedUsers === 0) {
            await safeEditMessageText(
                ctx,
                "📋 *Reported Users*\n\nNo users have been reported.\n\nUse the button below to return to menu.",
                { parse_mode: "Markdown", ...backKeyboard }
            );
            return;
        }

        const totalPages = Math.max(1, Math.ceil(totalReportedUsers / pageSize));
        const safePage = Math.min(Math.max(0, page), totalPages - 1);
        const pageUsers = await getGroupedReports(pageSize, safePage * pageSize);

        if (ctx.from?.id) {
            reportPages.set(ctx.from.id, safePage);
        }

        const reportButtons = pageUsers.map(({ userId, count, latestReason }) => ([
            Markup.button.callback(
                `👤 ${userId} • ${count} report${count === 1 ? "" : "s"} • ${latestReason || "No reason"}`,
                `ADMIN_REPORT_USER_${userId}`
            )
        ]));

        const navButtons = [];
        if (safePage > 0) {
            navButtons.push(Markup.button.callback("◀️ Prev", `ADMIN_VIEW_REPORTS_PAGE_${safePage - 1}`));
        }
        if (safePage < totalPages - 1) {
            navButtons.push(Markup.button.callback("Next ▶️", `ADMIN_VIEW_REPORTS_PAGE_${safePage + 1}`));
        }

        await safeEditMessageText(
            ctx,
            `📋 *Reports Inbox*\n\n` +
            `Reported users: ${totalReportedUsers}\n` +
            `Page ${safePage + 1}/${totalPages}\n\n` +
            `Tap a user below to review reports and moderation options.`,
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    ...reportButtons,
                    ...(navButtons.length > 0 ? [navButtons] : []),
                    [Markup.button.callback("🔄 Refresh", `ADMIN_VIEW_REPORTS_PAGE_${safePage}`)],
                    [Markup.button.callback("🔙 Back to Menu", "ADMIN_BACK")]
                ])
            }
        );
    }

    async function showReportUserActions(ctx: Context, userId: number) {
        const reportCount = await getReportCount(userId);
        const reportReason = await getUserLatestReportReason(userId);
        const userBanned = await isBanned(userId);

        if (reportCount === 0) {
            await safeEditMessageText(
                ctx,
                `📋 *Report Review*\n\nUser \`${userId}\` has no active reports.`,
                {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback("🔙 Back to Reports", `ADMIN_VIEW_REPORTS_PAGE_${reportPages.get(ctx.from?.id || 0) || 0}`)]
                    ])
                }
            );
            return;
        }

        const keyboardRows = [];

        if (!userBanned) {
            keyboardRows.push([
                Markup.button.callback("⚠️ Warn User", `ADMIN_REPORT_WARN_${userId}`),
                Markup.button.callback("🚫 Ban User", `ADMIN_REPORT_BAN_${userId}`)
            ]);
            keyboardRows.push([
                Markup.button.callback("⏱️ Temp Ban", `ADMIN_REPORT_TEMP_BAN_SELECT_${userId}`),
                Markup.button.callback("🧹 Clear Reports", `ADMIN_REPORT_CLEAR_${userId}`)
            ]);
        } else {
            keyboardRows.push([
                Markup.button.callback("✅ Already Banned", `ADMIN_USER_${userId}`)
            ]);
            keyboardRows.push([
                Markup.button.callback("🧹 Clear Reports", `ADMIN_REPORT_CLEAR_${userId}`)
            ]);
        }

        keyboardRows.push([
            Markup.button.callback("👁️ View Full User", `ADMIN_USER_${userId}`)
        ]);
        keyboardRows.push([
            Markup.button.callback("🔙 Back to Reports", `ADMIN_VIEW_REPORTS_PAGE_${reportPages.get(ctx.from?.id || 0) || 0}`)
        ]);

        await safeEditMessageText(
            ctx,
            `📋 *Report Review*\n\n` +
            `👤 User ID: \`${userId}\`\n` +
            `📊 Total Reports: ${reportCount}\n` +
            `📝 Latest Reason: ${reportReason || "No reason"}\n` +
            `🚫 Status: ${userBanned ? "Banned" : "Active"}\n\n` +
            `Choose an action below.`,
            { parse_mode: "Markdown", ...Markup.inlineKeyboard(keyboardRows) }
        );
    }

    // Back to main menu
    bot.action("ADMIN_BACK", async (ctx) => {
        // Re-validate admin permissions
        const adminId = ctx.from?.id;
        if (!adminId || !isAdmin(adminId)) {
            await safeAnswerCbQuery(ctx, "Unauthorized");
            return;
        }
        
        console.log("[ADMIN] - ADMIN_BACK action triggered for user:", ctx.from?.id);
        try {
            clearAdminInputState(adminId);
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
        
        try {
            await showUsersPage(ctx, 0);
        } catch (error) {
            console.error("[ADMIN_USERS] Error loading users:", error);
            const errorMessage = getErrorMessage(error);
            await ctx.reply(
                `❌ Error loading users: ${errorMessage}\n\nThe bot may be using JSON storage instead of MongoDB.`,
                { parse_mode: "Markdown" }
            );
        }
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
        waitingForBroadcast.delete(adminId);
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
        
        // Get database status
        const dbStatus = getDatabaseStatus();
        
        // Get total chats from bot instance
        const totalChats = bot.totalChats || 0;
        
        const stats = `📊 *Bot Statistics*\n\n` +
            `🗄️ Database: ${dbStatus.mode} (${dbStatus.healthy ? "✅ Healthy" : "❌ Unhealthy"})\n` +
            `📝 Status: ${dbStatus.message}\n\n` +
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
        const activeChatsCount = runningChats.size / 2;
        
        if (activeChatsCount === 0) {
            await safeEditMessageText(ctx,
                "💬 *Active Chats*\n\nNo active chats at the moment.\n\nUse the button below to return to menu.",
                { parse_mode: "Markdown", ...backKeyboard }
            );
            return;
        }
        
        // Build list of active chats using Map iterator
        // Use Set to avoid duplicate pairs reliably
        const chatButtons = [];
        let chatIndex = 1;
        const visited = new Set<number>();
        
        for (const [user, partner] of runningChats) {
            // Skip if we've already processed either user
            if (visited.has(user) || visited.has(partner)) continue;
            
            visited.add(user);
            visited.add(partner);
            
            // Valid chat pair - show button
            chatButtons.push([
                Markup.button.callback(`👥 Chat #${chatIndex}`, `ADMIN_SPECTATE_${user}_${partner}`)
            ]);
            chatIndex++;
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
        const formatUserInfo = (userData: { name?: string | null; gender?: string | null; age?: string | null; state?: string | null }, userId: number) => {
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
        if (!validateAdmin(ctx)) {
            await unauthorizedResponse(ctx, "Unauthorized");
            return;
        }
        await safeAnswerCbQuery(ctx);
        
        const user1 = parseInt(ctx.match[1]);
        const user2 = parseInt(ctx.match[2]);
        const adminId = ctx.from?.id;
        
        if (!adminId) return;
        
        // Remove from spectating chats
        bot.spectatingChats.delete(adminId);
        clearChatRuntime(bot, user1, user2);
        
        await updateUser(user1, { chatStartTime: null, reportingPartner: user2 });
        await updateUser(user2, { chatStartTime: null, reportingPartner: user1 });
        
        // Notify both users that chat was terminated (show as partner left)
        try {
            await ctx.telegram.sendMessage(
                user1,
                buildPartnerLeftMessage(),
                { parse_mode: "Markdown", ...exitChatKeyboard }
            );
        } catch {
            // User might have blocked the bot
        }
        
        try {
            await ctx.telegram.sendMessage(
                user2,
                buildPartnerLeftMessage(),
                { parse_mode: "Markdown", ...exitChatKeyboard }
            );
        } catch {
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
        if (!validateAdmin(ctx)) {
            await unauthorizedResponse(ctx, "Unauthorized");
            return;
        }
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
        waitingForUserId.delete(adminId);
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
        // Validate admin permissions
        if (!validateAdmin(ctx)) {
            await unauthorizedResponse(ctx, "Unauthorized");
            return;
        }
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
        // Validate admin permissions
        if (!validateAdmin(ctx)) {
            await unauthorizedResponse(ctx, "Unauthorized");
            return;
        }
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

    // View Reports (inbox style)
    bot.action("ADMIN_VIEW_REPORTS", async (ctx) => {
        if (!validateAdmin(ctx)) {
            await safeAnswerCbQuery(ctx, "Unauthorized");
            return;
        }

        await safeAnswerCbQuery(ctx);
        await showReportsList(ctx, 0);
    });

    bot.action(/ADMIN_REPORT_USER_(\d+)/, async (ctx) => {
        if (!validateAdmin(ctx)) {
            await unauthorizedResponse(ctx, "Unauthorized");
            return;
        }
        await safeAnswerCbQuery(ctx);
        const userId = parseInt(ctx.match[1]);
        await showReportUserActions(ctx, userId);
    });

    bot.action(/ADMIN_VIEW_REPORTS_PAGE_(\d+)/, async (ctx) => {
        if (!validateAdmin(ctx)) {
            await unauthorizedResponse(ctx, "Unauthorized");
            return;
        }
        await safeAnswerCbQuery(ctx);
        const page = parseInt(ctx.match[1]);
        await showReportsList(ctx, Number.isNaN(page) ? 0 : page);
    });

    // Re-engagement campaign
    bot.action("ADMIN_REENGAGE", async (ctx) => {
        // Re-validate admin permissions
        if (!validateAdmin(ctx)) {
            await unauthorizedResponse(ctx, "Unauthorized");
            return;
        }
        await safeAnswerCbQuery(ctx);
        
        // Check admin authentication
        const adminId = ctx.from?.id;
        if (!adminId) return;
        
        const user = await getUser(adminId);
        if (!user.isAdminAuthenticated) {
            return ctx.reply("🚫 You are not authorized to access this command.");
        }
        
        // Import and execute reengagement command with useEdit=true for transition effect
        const reengagementCommand = require("./reengagement").default;
        await reengagementCommand.execute(ctx, bot, true);
    });

    // Referral management
    bot.action("ADMIN_REFERRALS", async (ctx) => {
        if (!validateAdmin(ctx)) {
            await unauthorizedResponse(ctx, "Unauthorized");
            return;
        }
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
        if (!validateAdmin(ctx)) {
            await unauthorizedResponse(ctx, "Unauthorized");
            return;
        }
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
        if (!validateAdmin(ctx)) {
            await unauthorizedResponse(ctx, "Unauthorized");
            return;
        }
        await safeAnswerCbQuery(ctx);
        if (!ctx.from) return;
        clearAdminInputState(ctx.from.id);
        await updateUser(ctx.from.id, { isAdminAuthenticated: false });
        await safeEditMessageText(ctx,
            "🔐 *Admin Panel*\n\nYou have been logged out.",
            { parse_mode: "Markdown" }
        );
    });

    // Pagination actions
    bot.action(/ADMIN_USERS_PAGE_(\d+)/, async (ctx) => {
        if (!validateAdmin(ctx)) {
            await unauthorizedResponse(ctx, "Unauthorized");
            return;
        }
        await safeAnswerCbQuery(ctx);
        if (!ctx.from) return;
        const page = parseInt(ctx.match[1]);
        if (isNaN(page)) {
            await safeEditMessageText(
                ctx,
                "⚠️ Invalid page number.",
                { parse_mode: "Markdown", ...backKeyboard }
            );
            return;
        }
        userPages.set(ctx.from.id, page);
        await showUsersPage(ctx, page);
    });

    // View user details
    bot.action(/ADMIN_USER_(\d+)/, async (ctx) => {
        if (!validateAdmin(ctx)) {
            await unauthorizedResponse(ctx, "Unauthorized");
            return;
        }
        await safeAnswerCbQuery(ctx);
        const userId = parseInt(ctx.match[1]);
        await showUserDetails(ctx, userId);
    });

    // Ban user from details - Also terminates active chats
    bot.action(/ADMIN_BAN_USER_(\d+)/, async (ctx) => {
        // Validate admin permissions
        if (!validateAdmin(ctx)) {
            await unauthorizedResponse(ctx, "Unauthorized");
            return;
        }
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

    bot.action(/ADMIN_REPORT_BAN_(\d+)/, async (ctx) => {
        if (!validateAdmin(ctx)) {
            await unauthorizedResponse(ctx, "Unauthorized");
            return;
        }
        await safeAnswerCbQuery(ctx);
        const userId = parseInt(ctx.match[1]);
        const adminId = ctx.from?.id || 0;

        const partnerId = await terminateUserChat(ctx, bot, userId);
        await banUser(userId, "Banned by admin", adminId);

        if (partnerId) {
            await safeAnswerCbQuery(ctx, `User banned. Partner ${partnerId} removed from chat.`);
        }

        await showReportUserActions(ctx, userId);
    });

    // Show temporary ban duration selection
    bot.action(/ADMIN_TEMP_BAN_SELECT_(\d+)/, async (ctx) => {
        // Validate admin permissions
        if (!validateAdmin(ctx)) {
            await unauthorizedResponse(ctx, "Unauthorized");
            return;
        }
        await safeAnswerCbQuery(ctx);
        const userId = parseInt(ctx.match[1]);
        
        // Create keyboard with dynamic userId in callback data
        const tempBanDurations = Markup.inlineKeyboard([
            [Markup.button.callback("⏱️ 1 Hour", `ADMIN_TEMP_BAN_1_${userId}`)],
            [Markup.button.callback("⏱️ 6 Hours", `ADMIN_TEMP_BAN_6_${userId}`)],
            [Markup.button.callback("⏱️ 24 Hours", `ADMIN_TEMP_BAN_24_${userId}`)],
            [Markup.button.callback("⏱️ 7 Days", `ADMIN_TEMP_BAN_168_${userId}`)],
            [Markup.button.callback("🔙 Back", "ADMIN_VIEW_REPORTS")]
        ]);
        
        await safeEditMessageText(
            ctx,
            `⏱️ *Select Temporary Ban Duration*\n\n` +
            `User ID: \`${userId}\`\n\n` +
            `Choose how long to ban this user:`,
            { parse_mode: "Markdown", ...tempBanDurations }
        );
    });

    bot.action(/ADMIN_REPORT_TEMP_BAN_SELECT_(\d+)/, async (ctx) => {
        if (!validateAdmin(ctx)) {
            await unauthorizedResponse(ctx, "Unauthorized");
            return;
        }
        await safeAnswerCbQuery(ctx);
        const userId = parseInt(ctx.match[1]);

        const tempBanDurations = Markup.inlineKeyboard([
            [Markup.button.callback("⏱️ 1 Hour", `ADMIN_REPORT_TEMP_BAN_1_${userId}`)],
            [Markup.button.callback("⏱️ 6 Hours", `ADMIN_REPORT_TEMP_BAN_6_${userId}`)],
            [Markup.button.callback("⏱️ 24 Hours", `ADMIN_REPORT_TEMP_BAN_24_${userId}`)],
            [Markup.button.callback("⏱️ 7 Days", `ADMIN_REPORT_TEMP_BAN_168_${userId}`)],
            [Markup.button.callback("🔙 Back", `ADMIN_REPORT_USER_${userId}`)]
        ]);

        await safeEditMessageText(
            ctx,
            `⏱️ *Select Temporary Ban Duration*\n\n` +
            `User ID: \`${userId}\`\n\n` +
            `Choose how long to ban this user:`,
            { parse_mode: "Markdown", ...tempBanDurations }
        );
    });

    // Helper function to execute temporary ban with duration
    async function executeTempBan(ctx: Context, userId: number, durationHours: number, backAction: string = "ADMIN_VIEW_REPORTS") {
        const adminId = ctx.from?.id || 0;
        const durationMs = durationHours * 60 * 60 * 1000;
        const reason = `Temporarily banned for ${durationHours} hour(s)`;
        
        // Check if user is in an active chat and terminate it
        const partnerId = await terminateUserChat(ctx, bot, userId);
        
        // Temporarily ban the user
        await tempBanUser(userId, durationMs, reason, adminId);
        
        // Calculate unban time
        const unbanTime = new Date(Date.now() + durationMs);
        const unbanTimeStr = unbanTime.toLocaleString();
        
        const message = `⏱️ *Temporary Ban Applied*\n\n` +
            `User \`${userId}\` has been temporarily banned.\n\n` +
            `📅 Unban date: ${unbanTimeStr}\n` +
            `⏰ Duration: ${durationHours} hour(s)\n\n` +
            `${partnerId ? `✅ Chat with partner ${partnerId} terminated.` : ""}\n\n` +
            `Use the button below to return to reports.`;
        
        await safeEditMessageText(
            ctx,
            message,
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("🔙 Back", backAction)]
                ])
            }
        );
    }

    // Temporary ban action handlers (1 hour)
    bot.action(/ADMIN_TEMP_BAN_1_(\d+)/, async (ctx) => {
        if (!validateAdmin(ctx)) {
            await unauthorizedResponse(ctx, "Unauthorized");
            return;
        }
        await safeAnswerCbQuery(ctx);
        const userId = parseInt(ctx.match[1]);
        await executeTempBan(ctx, userId, 1);
    });

    bot.action(/ADMIN_REPORT_TEMP_BAN_1_(\d+)/, async (ctx) => {
        if (!validateAdmin(ctx)) {
            await unauthorizedResponse(ctx, "Unauthorized");
            return;
        }
        await safeAnswerCbQuery(ctx);
        const userId = parseInt(ctx.match[1]);
        await executeTempBan(ctx, userId, 1, `ADMIN_REPORT_USER_${userId}`);
    });

    // Temporary ban action handlers (6 hours)
    bot.action(/ADMIN_TEMP_BAN_6_(\d+)/, async (ctx) => {
        if (!validateAdmin(ctx)) {
            await unauthorizedResponse(ctx, "Unauthorized");
            return;
        }
        await safeAnswerCbQuery(ctx);
        const userId = parseInt(ctx.match[1]);
        await executeTempBan(ctx, userId, 6);
    });

    bot.action(/ADMIN_REPORT_TEMP_BAN_6_(\d+)/, async (ctx) => {
        if (!validateAdmin(ctx)) {
            await unauthorizedResponse(ctx, "Unauthorized");
            return;
        }
        await safeAnswerCbQuery(ctx);
        const userId = parseInt(ctx.match[1]);
        await executeTempBan(ctx, userId, 6, `ADMIN_REPORT_USER_${userId}`);
    });

    // Temporary ban action handlers (24 hours)
    bot.action(/ADMIN_TEMP_BAN_24_(\d+)/, async (ctx) => {
        if (!validateAdmin(ctx)) {
            await unauthorizedResponse(ctx, "Unauthorized");
            return;
        }
        await safeAnswerCbQuery(ctx);
        const userId = parseInt(ctx.match[1]);
        await executeTempBan(ctx, userId, 24);
    });

    bot.action(/ADMIN_REPORT_TEMP_BAN_24_(\d+)/, async (ctx) => {
        if (!validateAdmin(ctx)) {
            await unauthorizedResponse(ctx, "Unauthorized");
            return;
        }
        await safeAnswerCbQuery(ctx);
        const userId = parseInt(ctx.match[1]);
        await executeTempBan(ctx, userId, 24, `ADMIN_REPORT_USER_${userId}`);
    });

    // Temporary ban action handlers (7 days = 168 hours)
    bot.action(/ADMIN_TEMP_BAN_168_(\d+)/, async (ctx) => {
        if (!validateAdmin(ctx)) {
            await unauthorizedResponse(ctx, "Unauthorized");
            return;
        }
        await safeAnswerCbQuery(ctx);
        const userId = parseInt(ctx.match[1]);
        await executeTempBan(ctx, userId, 168);
    });

    bot.action(/ADMIN_REPORT_TEMP_BAN_168_(\d+)/, async (ctx) => {
        if (!validateAdmin(ctx)) {
            await unauthorizedResponse(ctx, "Unauthorized");
            return;
        }
        await safeAnswerCbQuery(ctx);
        const userId = parseInt(ctx.match[1]);
        await executeTempBan(ctx, userId, 168, `ADMIN_REPORT_USER_${userId}`);
    });

    // Map report reason codes to human-readable warning messages
    function getWarningMessage(reason: string | null): string {
        const reasonMap: Record<string, string> = {
            "REPORT_IMPERSONATING": "You are impersonating someone else. This behavior is not allowed on our platform.",
            "REPORT_SEXUAL": "You have been reported for sharing inappropriate/sexual content. This is a violation of our community guidelines.",
            "REPORT_FRAUD": "You have been reported for fraud or suspicious activity. This is a serious violation that may result in permanent ban.",
            "REPORT_INSULTING": "You have been reported for insulting or harassing other users. Please treat others with respect.",
            "REPORT_IMPERSONATING_report": "You are impersonating someone else. This behavior is not allowed on our platform.",
            "REPORT_SEXUAL_report": "You have been reported for sharing inappropriate/sexual content. This is a violation of our community guidelines.",
            "REPORT_FRAUD_report": "You have been reported for fraud or suspicious activity. This is a serious violation that may result in permanent ban.",
            "REPORT_INSULTING_report": "You have been reported for insulting or harassing other users. Please treat others with respect.",
            "Impersonating": "You are impersonating someone else. This behavior is not allowed on our platform.",
            "Sexual content": "You have been reported for sharing inappropriate/sexual content. This is a violation of our community guidelines.",
            "Fraud": "You have been reported for fraud or suspicious activity. This is a serious violation that may result in permanent ban.",
            "Insulting": "You have been reported for insulting or harassing other users. Please treat others with respect."
        };
        
        return reasonMap[reason || ""] || "You have been reported for violating our community guidelines. Please review and follow our rules to avoid further action.";
    }

    // Send warning message to reported user
    bot.action(/ADMIN_WARN_USER_(\d+)/, async (ctx) => {
        // Validate admin permissions
        if (!validateAdmin(ctx)) {
            await unauthorizedResponse(ctx, "Unauthorized");
            return;
        }
        await safeAnswerCbQuery(ctx);
        const userId = parseInt(ctx.match[1]);
        
        // Get user's latest report reason
        const reportReason = await getUserLatestReportReason(userId);
        
        // Get the appropriate warning message based on reason
        const warningMessage = getWarningMessage(reportReason);
        
        const fullMessage = `⚠️ *Warning*\n\n` +
            `You were reported for: *${reportReason || "General violation"}*\n\n` +
            `${warningMessage}\n\n` +
            `This is an automated warning based on reports received about your behavior.\n\n` +
            `If you continue to violate our guidelines, further action may be taken including a temporary or permanent ban.`;
        
        // Try to send the warning message to the user
        try {
            await ctx.telegram.sendMessage(
                userId,
                fullMessage,
                { parse_mode: "Markdown" }
            );
            
            await safeEditMessageText(
                ctx,
                `✅ *Warning Sent*\n\n` +
                `Warning message has been sent to user \`${userId}\`.\n\n` +
                `📝 Reason: ${reportReason || "General violation"}\n\n` +
                `Use the button below to return to reports.`,
                { parse_mode: "Markdown", ...backKeyboard }
            );
        } catch {
            // User might have blocked the bot
            await safeEditMessageText(
                ctx,
                `⚠️ *Warning Could Not Be Sent*\n\n` +
                `Could not send warning to user \`${userId}\`. \n` +
                `The user may have blocked the bot.\n\n` +
                `📝 Reason that would have been sent: ${reportReason || "General violation"}\n\n` +
                `Use the button below to return to reports.`,
                { parse_mode: "Markdown", ...backKeyboard }
            );
        }
    });

    bot.action(/ADMIN_REPORT_WARN_(\d+)/, async (ctx) => {
        if (!validateAdmin(ctx)) {
            await unauthorizedResponse(ctx, "Unauthorized");
            return;
        }
        await safeAnswerCbQuery(ctx);
        const userId = parseInt(ctx.match[1]);

        const reportReason = await getUserLatestReportReason(userId);
        const warningMessage = getWarningMessage(reportReason);
        const fullMessage = `⚠️ *Warning*\n\n` +
            `You were reported for: *${reportReason || "General violation"}*\n\n` +
            `${warningMessage}\n\n` +
            `This is an automated warning based on reports received about your behavior.\n\n` +
            `If you continue to violate our guidelines, further action may be taken including a temporary or permanent ban.`;

        try {
            await ctx.telegram.sendMessage(
                userId,
                fullMessage,
                { parse_mode: "Markdown" }
            );
            await safeEditMessageText(
                ctx,
                `✅ *Warning Sent*\n\n` +
                `Warning message sent to user \`${userId}\`.\n\n` +
                `📝 Reason: ${reportReason || "General violation"}`,
                {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback("🔙 Back", `ADMIN_REPORT_USER_${userId}`)],
                        [Markup.button.callback("📋 Reports", `ADMIN_VIEW_REPORTS_PAGE_${reportPages.get(ctx.from?.id || 0) || 0}`)]
                    ])
                }
            );
        } catch {
            await safeEditMessageText(
                ctx,
                `⚠️ *Warning Could Not Be Sent*\n\n` +
                `Could not send warning to user \`${userId}\`.\n` +
                `The user may have blocked the bot.\n\n` +
                `📝 Reason: ${reportReason || "General violation"}`,
                {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback("🔙 Back", `ADMIN_REPORT_USER_${userId}`)],
                        [Markup.button.callback("📋 Reports", `ADMIN_VIEW_REPORTS_PAGE_${reportPages.get(ctx.from?.id || 0) || 0}`)]
                    ])
                }
            );
        }
    });

    // Helper function to terminate user's active chat
    async function terminateUserChat(ctx: Context, botInstance: ExtraTelegraf, userId: number): Promise<number | null> {
        const runningChats = botInstance.runningChats;

        if (!runningChats.has(userId)) {
            return null;
        }

        const partnerId = runningChats.get(userId);
        if (!partnerId) {
            return null;
        }

        console.log(`[BAN] - Terminating chat between ${userId} and ${partnerId}`);

        clearChatRuntime(botInstance, userId, partnerId);

        await updateUser(userId, {
            chatStartTime: null,
            reportingPartner: partnerId,
        });
        await updateUser(partnerId, {
            chatStartTime: null,
            reportingPartner: userId,
        });

        try {
            await ctx.telegram.sendMessage(
                partnerId,
                buildPartnerLeftMessage(),
                exitChatKeyboard
            );
        } catch (error) {
            console.log(`[BAN] - Could not notify partner ${partnerId}:`, error);
        }

        return partnerId;
    }

    // Unban user from details
    bot.action(/ADMIN_UNBAN_USER_(\d+)/, async (ctx) => {
        // Validate admin permissions
        if (!validateAdmin(ctx)) {
            await unauthorizedResponse(ctx, "Unauthorized");
            return;
        }
        await safeAnswerCbQuery(ctx);
        const userId = parseInt(ctx.match[1]);
        await unbanUser(userId);
        await showUserDetails(ctx, userId);
    });

    // Grant premium access
    bot.action(/ADMIN_GRANT_PREMIUM_(\d+)/, async (ctx) => {
        // Validate admin permissions
        if (!validateAdmin(ctx)) {
            await unauthorizedResponse(ctx, "Unauthorized");
            return;
        }
        await safeAnswerCbQuery(ctx, "Premium granted ✅");
        const userId = parseInt(ctx.match[1]);
        await updateUser(userId, { premium: true });
        await showUserDetails(ctx, userId);
    });

    // Revoke premium access
    bot.action(/ADMIN_REVOKE_PREMIUM_(\d+)/, async (ctx) => {
        // Validate admin permissions
        if (!validateAdmin(ctx)) {
            await unauthorizedResponse(ctx, "Unauthorized");
            return;
        }
        await safeAnswerCbQuery(ctx, "Premium revoked ❌");
        const userId = parseInt(ctx.match[1]);
        await updateUser(userId, { premium: false });
        await showUserDetails(ctx, userId);
    });

    // Delete user
    bot.action(/ADMIN_DELETE_USER_(\d+)/, async (ctx) => {
        // Validate admin permissions
        if (!validateAdmin(ctx)) {
            await unauthorizedResponse(ctx, "Unauthorized");
            return;
        }
        await safeAnswerCbQuery(ctx, "User deleted ❌");
        const userId = parseInt(ctx.match[1]);
        await deleteUser(userId, "admin_action");
        
        // Return to users list
        await showUsersPage(ctx, 0);
    });

    // Edit user gender
    bot.action(/ADMIN_EDIT_GENDER_(\d+)/, async (ctx) => {
        // Validate admin permissions
        if (!validateAdmin(ctx)) {
            await unauthorizedResponse(ctx, "Unauthorized");
            return;
        }
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
        // Validate admin permissions
        if (!validateAdmin(ctx)) {
            await unauthorizedResponse(ctx, "Unauthorized");
            return;
        }
        await safeAnswerCbQuery(ctx, "Gender updated to Male ✅");
        const userId = parseInt(ctx.match[1]);
        await updateUser(userId, { gender: "male" });
        await showUserDetails(ctx, userId);
    });

    // Set user gender to female
    bot.action(/ADMIN_SET_GENDER_FEMALE_(\d+)/, async (ctx) => {
        // Validate admin permissions
        if (!validateAdmin(ctx)) {
            await unauthorizedResponse(ctx, "Unauthorized");
            return;
        }
        await safeAnswerCbQuery(ctx, "Gender updated to Female ✅");
        const userId = parseInt(ctx.match[1]);
        await updateUser(userId, { gender: "female" });
        await showUserDetails(ctx, userId);
    });

    // Reset user chats
    bot.action(/ADMIN_RESET_CHATS_(\d+)/, async (ctx) => {
        // Validate admin permissions
        if (!validateAdmin(ctx)) {
            await unauthorizedResponse(ctx, "Unauthorized");
            return;
        }
        await safeAnswerCbQuery(ctx, "Chats reset ✅");
        const userId = parseInt(ctx.match[1]);
        await updateUser(userId, { daily: 0 });
        await showUserDetails(ctx, userId);
    });

    // Reset user reports
    bot.action(/ADMIN_RESET_REPORTS_(\d+)/, async (ctx) => {
        // Validate admin permissions
        if (!validateAdmin(ctx)) {
            await unauthorizedResponse(ctx, "Unauthorized");
            return;
        }
        await safeAnswerCbQuery(ctx, "Reports reset ✅");
        const userId = parseInt(ctx.match[1]);
        await resetUserReports(userId);
        await showUserDetails(ctx, userId);
    });

    bot.action(/ADMIN_REPORT_CLEAR_(\d+)/, async (ctx) => {
        if (!validateAdmin(ctx)) {
            await unauthorizedResponse(ctx, "Unauthorized");
            return;
        }
        await safeAnswerCbQuery(ctx, "Reports cleared");
        const userId = parseInt(ctx.match[1]);
        await resetUserReports(userId);
        await showReportsList(ctx, reportPages.get(ctx.from?.id || 0) || 0);
    });
}

async function showUsersPage(ctx: Context, page: number) {
    const allUsers = await getAllUsers();
    const usersPerPage = 10;
    const totalPages = Math.max(1, Math.ceil(allUsers.length / usersPerPage));
    const safePage = Math.min(Math.max(0, page), totalPages - 1);
    page = safePage;
    const start = page * usersPerPage;
    const end = Math.min(start + usersPerPage, allUsers.length);
    const pageUsers = allUsers.slice(start, end);
    
    const userButtons = await Promise.all(pageUsers.map(async (id: string) => {
        const userId = parseInt(id, 10);

        try {
            const user = await getUser(userId);
            const name = user.name && user.name !== "Unknown" ? user.name : "User";
            const status = (await isBanned(userId)) ? "🚫" : "✅";
            return [Markup.button.callback(`${status} ${name} (${id})`, `ADMIN_USER_${id}`)];
        } catch (error) {
            console.error(`[showUsersPage] Failed loading user ${id}:`, error);
            return [Markup.button.callback(`[ERR] User (${id})`, `ADMIN_USER_${id}`)];
        }
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
    
    const text = allUsers.length === 0
        ? "*All Users* (0)\n\nNo users found.\n\nUse the button below to return to menu."
        : `*All Users* (${allUsers.length})\n\nPage ${page + 1}/${totalPages}\n\nClick on a user to view details.`;
    // Use try-catch with fallback to prevent UI freeze
    try {
        await ctx.editMessageText(text, { parse_mode: "Markdown", ...keyboard });
    } catch (error: unknown) {
        const errorMessage = getErrorMessage(error);
        // Check for "message not modified" - ignore it
        if (errorMessage.includes("message is not modified")) {
            return;
        }
        // Fallback to reply for other errors
        try {
            await ctx.reply(text, { parse_mode: "Markdown", ...keyboard });
            return; // Exit after successful fallback
        } catch (replyError: unknown) {
            console.error("[showUsersPage] Failed to reply:", getErrorMessage(replyError));
        }
    }
}

export async function showUserDetails(ctx: Context, userId: number) {
    const user = await getUser(userId);
    if (!user) {
        // Use try-catch with fallback to prevent UI freeze
        try {
            await ctx.editMessageText(
                "User not found.",
                { parse_mode: "HTML", ...backKeyboard }
            );
        } catch (error: unknown) {
            const errorMessage = getErrorMessage(error);
            // Check for "message not modified" - ignore it
            if (errorMessage.includes("message is not modified")) {
                return;
            }
            // Fallback to reply for other errors
            try {
                await ctx.reply(
                    "User not found.",
                    { parse_mode: "HTML", ...backKeyboard }
                );
                return; // Exit after successful fallback
            } catch (replyError: unknown) {
                console.error("[showUserDetails] Failed to reply:", getErrorMessage(replyError));
            }
        }
        return;
    }

    // Use saved name or try to get from Telegram
    let name = user.name;
    if (!name || name === "Not set" || name === "Unknown") {
        try {
            const chat = await ctx.telegram.getChat(userId);
            const username = "username" in chat ? chat.username : undefined;
            const firstName = "first_name" in chat ? chat.first_name : undefined;
            name = username || firstName || "Not set";
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
    } catch (error: unknown) {
        const errorMessage = getErrorMessage(error);
        // Check for "message not modified" - ignore it
        if (errorMessage.includes("message is not modified")) {
            return;
        }
        // Fallback to reply for other errors
        try {
            await ctx.reply(details, { parse_mode: "HTML", ...keyboard });
            return; // Exit after successful fallback
        } catch (replyError: unknown) {
            console.error("[showUserDetails] Failed to reply:", getErrorMessage(replyError));
        }
    }
}




