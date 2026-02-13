"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.waitingForBroadcast = void 0;
exports.initAdminActions = initAdminActions;
const telegraf_1 = require("telegraf");
const db_1 = require("../storage/db");
const ADMINS = ((_a = process.env.ADMIN_IDS) === null || _a === void 0 ? void 0 : _a.split(",")) || [];
function isAdmin(id) {
    return ADMINS.some(admin => {
        if (/^\d+$/.test(admin)) {
            return admin === id.toString();
        }
        return false;
    });
}
function isAdminByUsername(username) {
    if (!username)
        return false;
    return ADMINS.some(admin => admin.startsWith("@") && admin.toLowerCase() === `@${username.toLowerCase()}`);
}
// Helper function to format duration
function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    }
    else if (minutes > 0) {
        return `${minutes} min${minutes > 1 ? 's' : ''}`;
    }
    else {
        return `${seconds}s`;
    }
}
// Admin main menu with clear options
const mainKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("👥 View All Users", "ADMIN_USERS")],
    [telegraf_1.Markup.button.callback("🚫 View Bans", "ADMIN_BANS")],
    [telegraf_1.Markup.button.callback("📊 Bot Statistics", "ADMIN_STATS")],
    [telegraf_1.Markup.button.callback("💬 Active Chats", "ADMIN_ACTIVE_CHATS")],
    [telegraf_1.Markup.button.callback("📢 Broadcast Message", "ADMIN_BROADCAST")],
    [telegraf_1.Markup.button.callback("📣 Re-engagement", "ADMIN_REENGAGE")],
    [telegraf_1.Markup.button.callback("👤 Ban User", "ADMIN_BAN_USER")],
    [telegraf_1.Markup.button.callback("🔗 Referral Stats", "ADMIN_REFERRALS")],
    [telegraf_1.Markup.button.callback("🔒 Logout", "ADMIN_LOGOUT")]
]);
const backKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("🔙 Back to Menu", "ADMIN_BACK")]
]);
const userPages = new Map();
// Track admins waiting for broadcast input
exports.waitingForBroadcast = new Set();
function safeAnswerCbQuery(ctx, text) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            if ((_a = ctx.callbackQuery) === null || _a === void 0 ? void 0 : _a.id) {
                yield ctx.answerCbQuery(text);
            }
        }
        catch (_b) {
            // Ignore errors
        }
    });
}
exports.default = {
    name: "adminaccess",
    description: "Admin panel access",
    execute: (ctx, bot) => __awaiter(void 0, void 0, void 0, function* () {
        if (!ctx.from)
            return;
        const userId = ctx.from.id;
        if (!isAdmin(userId) && !isAdminByUsername(ctx.from.username)) {
            return ctx.reply("🚫 You are not authorized to access the admin panel.");
        }
        yield (0, db_1.updateUser)(userId, { isAdminAuthenticated: true });
        return ctx.reply("🔐 *Admin Panel*\n\nWelcome, Admin!\n\nSelect an option below:", Object.assign({ parse_mode: "Markdown" }, mainKeyboard));
    })
};
function initAdminActions(bot) {
    // Safe editMessageText that ignores "not modified" error
    function safeEditMessageText(ctx, text, extra) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            try {
                yield ctx.editMessageText(text, extra);
            }
            catch (error) {
                // Ignore "message is not modified" error
                if (!((_a = error.message) === null || _a === void 0 ? void 0 : _a.includes("not modified"))) {
                    console.error("[ADMIN ERROR] -", error.message || error);
                }
            }
        });
    }
    // Back to main menu
    bot.action("ADMIN_BACK", (ctx) => __awaiter(this, void 0, void 0, function* () {
        yield safeAnswerCbQuery(ctx);
        yield safeEditMessageText(ctx, "🔐 *Admin Panel*\n\nWelcome, Admin!\n\nSelect an option below:", Object.assign({ parse_mode: "Markdown" }, mainKeyboard));
    }));
    // View all users
    bot.action("ADMIN_USERS", (ctx) => __awaiter(this, void 0, void 0, function* () {
        yield safeAnswerCbQuery(ctx);
        if (!ctx.from)
            return;
        userPages.set(ctx.from.id, 0);
        yield showUsersPage(ctx, 0);
    }));
    // View bans
    bot.action("ADMIN_BANS", (ctx) => __awaiter(this, void 0, void 0, function* () {
        yield safeAnswerCbQuery(ctx);
        const bans = yield (0, db_1.readBans)();
        if (bans.length === 0) {
            yield safeEditMessageText(ctx, "🚫 *Banned Users*\n\nNo users are currently banned.\n\nUse the button below to return to menu.", Object.assign({ parse_mode: "Markdown" }, backKeyboard));
        }
        else {
            const banList = bans.map((id) => `• ${id}`).join("\n");
            yield safeEditMessageText(ctx, `🚫 *Banned Users*\n\nTotal: ${bans.length}\n\n${banList}\n\nUse the button below to return to menu.`, Object.assign({ parse_mode: "Markdown" }, backKeyboard));
        }
    }));
    // View stats
    bot.action("ADMIN_STATS", (ctx) => __awaiter(this, void 0, void 0, function* () {
        yield safeAnswerCbQuery(ctx);
        const allUsers = yield (0, db_1.getAllUsers)();
        const bans = yield (0, db_1.readBans)();
        // Get total chats from bot instance
        const totalChats = bot.totalChats || 0;
        const stats = `📊 *Bot Statistics*\n\n` +
            `👥 Total Users: ${allUsers.length}\n` +
            `🚫 Banned Users: ${bans.length}\n` +
            `💬 Total Chats: ${totalChats}\n\n` +
            `Use the button below to return to menu.`;
        yield safeEditMessageText(ctx, stats, Object.assign({ parse_mode: "Markdown" }, backKeyboard));
    }));
    // View active chats
    bot.action("ADMIN_ACTIVE_CHATS", (ctx) => __awaiter(this, void 0, void 0, function* () {
        yield safeAnswerCbQuery(ctx);
        const runningChats = bot.runningChats;
        const activeChatsCount = runningChats.length / 2;
        if (activeChatsCount === 0) {
            yield safeEditMessageText(ctx, "💬 *Active Chats*\n\nNo active chats at the moment.\n\nUse the button below to return to menu.", Object.assign({ parse_mode: "Markdown" }, backKeyboard));
            return;
        }
        // Build list of active chats
        const chatButtons = [];
        for (let i = 0; i < runningChats.length; i += 2) {
            const user1 = runningChats[i];
            const user2 = runningChats[i + 1];
            chatButtons.push([
                telegraf_1.Markup.button.callback(`👥 Chat #${(i / 2) + 1}`, `ADMIN_SPECTATE_${user1}_${user2}`)
            ]);
        }
        const keyboard = telegraf_1.Markup.inlineKeyboard([
            ...chatButtons,
            [telegraf_1.Markup.button.callback("🔙 Back to Menu", "ADMIN_BACK")]
        ]);
        yield safeEditMessageText(ctx, `💬 *Active Chats*\n\nTotal: ${activeChatsCount}\n\nSelect a chat to spectate:`, Object.assign({ parse_mode: "Markdown" }, keyboard));
    }));
    // Spectate a specific chat
    bot.action(/ADMIN_SPECTATE_(\d+)_(\d+)/, (ctx) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        yield safeAnswerCbQuery(ctx);
        const user1 = parseInt(ctx.match[1]);
        const user2 = parseInt(ctx.match[2]);
        const adminId = (_a = ctx.from) === null || _a === void 0 ? void 0 : _a.id;
        if (!adminId)
            return;
        // Store spectator session
        bot.spectatingChats.set(adminId, { user1, user2 });
        // Get chat statistics
        const user1Data = yield (0, db_1.getUser)(user1);
        const user2Data = yield (0, db_1.getUser)(user2);
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
        const formatUserInfo = (userData, userId) => {
            const name = userData.name || "Unknown";
            const gender = userData.gender ? (userData.gender.charAt(0).toUpperCase() + userData.gender.slice(1)) : "Not set";
            const age = userData.age || "Not set";
            const state = userData.state || "Not set";
            return `<b>${name}</b> (${userId})\n` +
                `👤 Gender: ${gender} | Age: ${age} | 📍 ${state}`;
        };
        const keyboard = telegraf_1.Markup.inlineKeyboard([
            [telegraf_1.Markup.button.callback("🛑 Terminate Chat", `ADMIN_TERMINATE_${user1}_${user2}`)],
            [telegraf_1.Markup.button.callback("🔙 Exit Spectator Mode", `ADMIN_EXIT_SPECTATE`)]
        ]);
        yield safeEditMessageText(ctx, `<b>👁️ Spectating Chat</b>\n\n` +
            `<b>User 1:</b>\n${formatUserInfo(user1Data, user1)}\n\n` +
            `<b>User 2:</b>\n${formatUserInfo(user2Data, user2)}\n\n` +
            `<b>⏱️ Duration:</b> ${durationText}\n` +
            `<b>💬 Messages:</b> ${totalMessages} (U1: ${user1Messages}, U2: ${user2Messages})\n\n` +
            `Messages from this chat will be forwarded here in real-time.\n\n` +
            `Use the buttons below to manage the chat.`, Object.assign({ parse_mode: "HTML" }, keyboard));
    }));
    // Terminate a chat (admin action)
    bot.action(/ADMIN_TERMINATE_(\d+)_(\d+)/, (ctx) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        yield safeAnswerCbQuery(ctx);
        const user1 = parseInt(ctx.match[1]);
        const user2 = parseInt(ctx.match[2]);
        const adminId = (_a = ctx.from) === null || _a === void 0 ? void 0 : _a.id;
        if (!adminId)
            return;
        // Remove from spectating chats
        bot.spectatingChats.delete(adminId);
        // Clean up chat state for both users
        bot.runningChats = bot.runningChats.filter(u => u !== user1 && u !== user2);
        bot.messageMap.delete(user1);
        bot.messageMap.delete(user2);
        bot.messageCountMap.delete(user1);
        bot.messageCountMap.delete(user2);
        // Clear chat start time
        yield (0, db_1.updateUser)(user1, { chatStartTime: null });
        yield (0, db_1.updateUser)(user2, { chatStartTime: null });
        // Notify both users that chat was terminated by admin
        try {
            yield ctx.telegram.sendMessage(user1, `🚫 *Chat Terminated by Admin*\n\n` +
                `Your chat has been ended by an administrator.\n\n` +
                `Use /search to find a new partner.`, { parse_mode: "Markdown" });
        }
        catch (e) {
            // User might have blocked the bot
        }
        try {
            yield ctx.telegram.sendMessage(user2, `🚫 *Chat Terminated by Admin*\n\n` +
                `Your chat has been ended by an administrator.\n\n` +
                `Use /search to find a new partner.`, { parse_mode: "Markdown" });
        }
        catch (e) {
            // User might have blocked the bot
        }
        yield safeEditMessageText(ctx, `<b>✅ Chat Terminated</b>\n\n` +
            `Chat between <code>${user1}</code> and <code>${user2}</code> has been ended.\n\n` +
            `Both users have been notified.\n\n` +
            `Use the button below to return to menu.`, Object.assign({ parse_mode: "HTML" }, backKeyboard));
    }));
    // Exit spectator mode
    bot.action("ADMIN_EXIT_SPECTATE", (ctx) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        yield safeAnswerCbQuery(ctx);
        const adminId = (_a = ctx.from) === null || _a === void 0 ? void 0 : _a.id;
        if (adminId) {
            bot.spectatingChats.delete(adminId);
        }
        // Redirect to active chats view
        yield safeEditMessageText(ctx, "👁️ Spectator Mode Exited.\n\nUse the button below to return to menu.", Object.assign({ parse_mode: "Markdown" }, backKeyboard));
    }));
    // Broadcast message - ask for input
    bot.action("ADMIN_BROADCAST", (ctx) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        yield safeAnswerCbQuery(ctx);
        const adminId = (_a = ctx.from) === null || _a === void 0 ? void 0 : _a.id;
        if (!adminId)
            return;
        // Set waiting flag
        exports.waitingForBroadcast.add(adminId);
        console.log(`[ADMIN] - Admin ${adminId} started broadcast, waitingForBroadcast.size = ${exports.waitingForBroadcast.size}`);
        yield safeEditMessageText(ctx, "📢 *Broadcast Message*\n\n" +
            "✍️ Type and send the message you want to broadcast to all users.\n\n" +
            "Use the button below to cancel.", Object.assign({ parse_mode: "Markdown" }, backKeyboard));
    }));
    // Cancel broadcast
    bot.action("ADMIN_BROADCAST_CANCEL", (ctx) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        yield safeAnswerCbQuery(ctx);
        const adminId = (_a = ctx.from) === null || _a === void 0 ? void 0 : _a.id;
        if (adminId) {
            exports.waitingForBroadcast.delete(adminId);
        }
        yield safeEditMessageText(ctx, "📢 *Broadcast Message*\n\n" +
            "Broadcast cancelled.\n\n" +
            "Use the button below to return to menu.", Object.assign({ parse_mode: "Markdown" }, backKeyboard));
    }));
    // Ban user
    bot.action("ADMIN_BAN_USER", (ctx) => __awaiter(this, void 0, void 0, function* () {
        yield safeAnswerCbQuery(ctx);
        yield safeEditMessageText(ctx, "👤 *Ban User*\n\n" +
            "To ban a user, use the /ban command with their User ID.\n\n" +
            "Example: /ban 1130645873\n\n" +
            "Use the button below to return to menu.", Object.assign({ parse_mode: "Markdown" }, backKeyboard));
    }));
    // Re-engagement campaign
    bot.action("ADMIN_REENGAGE", (ctx) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        yield safeAnswerCbQuery(ctx);
        // Check admin authentication
        const adminId = (_a = ctx.from) === null || _a === void 0 ? void 0 : _a.id;
        if (!adminId)
            return;
        const user = yield (0, db_1.getUser)(adminId);
        if (!user.isAdminAuthenticated) {
            return ctx.reply("🚫 You are not authorized to access this command.");
        }
        // Import and execute reengagement command
        const reengagementCommand = require("./reengagement").default;
        yield reengagementCommand.execute(ctx, bot);
    }));
    // Referral management
    bot.action("ADMIN_REFERRALS", (ctx) => __awaiter(this, void 0, void 0, function* () {
        yield safeAnswerCbQuery(ctx);
        const allUsers = yield (0, db_1.getAllUsers)();
        let totalReferrals = 0;
        let usersWithReferrals = 0;
        for (const id of allUsers) {
            const count = yield (0, db_1.getReferralCount)(parseInt(id));
            totalReferrals += count;
            if (count > 0)
                usersWithReferrals++;
        }
        const keyboard = telegraf_1.Markup.inlineKeyboard([
            [telegraf_1.Markup.button.callback("🔄 Verify & Fix Counts", "ADMIN_VERIFY_REFERRALS")],
            [telegraf_1.Markup.button.callback("🔙 Back to Menu", "ADMIN_BACK")]
        ]);
        yield safeEditMessageText(ctx, `🔗 *Referral Statistics*\n\n` +
            `👥 Users with Referrals: ${usersWithReferrals}\n` +
            `📊 Total Referrals: ${totalReferrals}\n\n` +
            `Use the button below to verify and fix any referral count discrepancies.`, Object.assign({ parse_mode: "Markdown" }, keyboard));
    }));
    // Verify and fix referral counts
    bot.action("ADMIN_VERIFY_REFERRALS", (ctx) => __awaiter(this, void 0, void 0, function* () {
        yield safeAnswerCbQuery(ctx, "Verifying referral counts...");
        const { accurate, discrepancies } = yield (0, db_1.verifyReferralCounts)();
        if (accurate) {
            yield safeEditMessageText(ctx, `✅ *Referral Verification Complete*\n\n` +
                `All referral counts are accurate!\n` +
                `No discrepancies found.`, Object.assign({ parse_mode: "Markdown" }, backKeyboard));
        }
        else {
            // Auto-fix the discrepancies
            const fixed = yield (0, db_1.fixReferralCounts)();
            yield safeEditMessageText(ctx, `⚠️ *Referral Verification Complete*\n\n` +
                `Found ${discrepancies.length} discrepancies.\n` +
                `Fixed ${fixed} referral counts.\n\n` +
                `Details:\n` +
                discrepancies.slice(0, 5).map(d => `• User ${d.userId}: ${d.stored} → ${d.actual}`).join("\n") +
                (discrepancies.length > 5 ? `\n...and ${discrepancies.length - 5} more` : ""), Object.assign({ parse_mode: "Markdown" }, backKeyboard));
        }
    }));
    // Logout
    bot.action("ADMIN_LOGOUT", (ctx) => __awaiter(this, void 0, void 0, function* () {
        yield safeAnswerCbQuery(ctx);
        if (!ctx.from)
            return;
        yield (0, db_1.updateUser)(ctx.from.id, { isAdminAuthenticated: false });
        yield safeEditMessageText(ctx, "🔐 *Admin Panel*\n\nYou have been logged out.", { parse_mode: "Markdown" });
    }));
    // Pagination actions
    bot.action(/ADMIN_USERS_PAGE_(\d+)/, (ctx) => __awaiter(this, void 0, void 0, function* () {
        yield safeAnswerCbQuery(ctx);
        if (!ctx.from)
            return;
        const page = parseInt(ctx.match[1]);
        userPages.set(ctx.from.id, page);
        yield showUsersPage(ctx, page);
    }));
    // View user details
    bot.action(/ADMIN_USER_(\d+)/, (ctx) => __awaiter(this, void 0, void 0, function* () {
        yield safeAnswerCbQuery(ctx);
        const userId = parseInt(ctx.match[1]);
        yield showUserDetails(ctx, userId);
    }));
    // Ban user from details
    bot.action(/ADMIN_BAN_USER_(\d+)/, (ctx) => __awaiter(this, void 0, void 0, function* () {
        yield safeAnswerCbQuery(ctx);
        const userId = parseInt(ctx.match[1]);
        const reason = "Banned by admin";
        yield (0, db_1.banUser)(userId);
        yield showUserDetails(ctx, userId);
    }));
    // Unban user from details
    bot.action(/ADMIN_UNBAN_USER_(\d+)/, (ctx) => __awaiter(this, void 0, void 0, function* () {
        yield safeAnswerCbQuery(ctx);
        const userId = parseInt(ctx.match[1]);
        yield (0, db_1.unbanUser)(userId);
        yield showUserDetails(ctx, userId);
    }));
    // Grant premium access
    bot.action(/ADMIN_GRANT_PREMIUM_(\d+)/, (ctx) => __awaiter(this, void 0, void 0, function* () {
        yield safeAnswerCbQuery(ctx, "Premium granted ✅");
        const userId = parseInt(ctx.match[1]);
        yield (0, db_1.updateUser)(userId, { premium: true });
        yield showUserDetails(ctx, userId);
    }));
    // Revoke premium access
    bot.action(/ADMIN_REVOKE_PREMIUM_(\d+)/, (ctx) => __awaiter(this, void 0, void 0, function* () {
        yield safeAnswerCbQuery(ctx, "Premium revoked ❌");
        const userId = parseInt(ctx.match[1]);
        yield (0, db_1.updateUser)(userId, { premium: false });
        yield showUserDetails(ctx, userId);
    }));
    // Delete user
    bot.action(/ADMIN_DELETE_USER_(\d+)/, (ctx) => __awaiter(this, void 0, void 0, function* () {
        yield safeAnswerCbQuery(ctx, "User deleted ❌");
        const userId = parseInt(ctx.match[1]);
        yield (0, db_1.deleteUser)(userId, "admin_action");
        // Return to users list
        yield showUsersPage(ctx, 0);
    }));
    // Edit user name
    bot.action(/ADMIN_EDIT_NAME_(\d+)/, (ctx) => __awaiter(this, void 0, void 0, function* () {
        yield safeAnswerCbQuery(ctx);
        const userId = parseInt(ctx.match[1]);
        const keyboard = telegraf_1.Markup.inlineKeyboard([
            [telegraf_1.Markup.button.callback("🔙 Back", `ADMIN_USER_${userId}`)]
        ]);
        yield ctx.editMessageText(`<b>📝 Edit Name</b>\n\nUser ID: <code>${userId}</code>\n\n` +
            `To change the user's name, use:\n` +
            `/setname ${userId} NewName\n\n` +
            `Use the button below to go back.`, Object.assign({ parse_mode: "HTML" }, keyboard));
    }));
    // Reset user chats
    bot.action(/ADMIN_RESET_CHATS_(\d+)/, (ctx) => __awaiter(this, void 0, void 0, function* () {
        yield safeAnswerCbQuery(ctx, "Chats reset ✅");
        const userId = parseInt(ctx.match[1]);
        yield (0, db_1.updateUser)(userId, { daily: 0 });
        yield showUserDetails(ctx, userId);
    }));
    // Reset user reports
    bot.action(/ADMIN_RESET_REPORTS_(\d+)/, (ctx) => __awaiter(this, void 0, void 0, function* () {
        yield safeAnswerCbQuery(ctx, "Reports reset ✅");
        const userId = parseInt(ctx.match[1]);
        yield (0, db_1.updateUser)(userId, { reportCount: 0, reportingPartner: null, reportReason: null });
        yield showUserDetails(ctx, userId);
    }));
}
function showUsersPage(ctx, page) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const allUsers = yield (0, db_1.getAllUsers)();
        const usersPerPage = 10;
        const totalPages = Math.ceil(allUsers.length / usersPerPage);
        const start = page * usersPerPage;
        const end = Math.min(start + usersPerPage, allUsers.length);
        const pageUsers = allUsers.slice(start, end);
        const userButtons = yield Promise.all(pageUsers.map((id) => __awaiter(this, void 0, void 0, function* () {
            const userId = parseInt(id);
            const user = yield (0, db_1.getUser)(userId);
            // Use saved name or try to get from Telegram
            let name = user.name;
            if (!name || name === "Unknown") {
                try {
                    const chat = yield ctx.telegram.getChat(userId);
                    name = chat.username || chat.first_name || "Unknown";
                }
                catch (_a) {
                    name = "Unknown";
                }
            }
            const status = (yield (0, db_1.isBanned)(userId)) ? "🚫" : "✅";
            return [telegraf_1.Markup.button.callback(`${status} ${name} (${id})`, `ADMIN_USER_${id}`)];
        })));
        const navButtons = [];
        if (page > 0) {
            navButtons.push(telegraf_1.Markup.button.callback("◀️ Prev", `ADMIN_USERS_PAGE_${page - 1}`));
        }
        if (page < totalPages - 1) {
            navButtons.push(telegraf_1.Markup.button.callback("Next ▶️", `ADMIN_USERS_PAGE_${page + 1}`));
        }
        const keyboard = telegraf_1.Markup.inlineKeyboard([
            ...userButtons,
            ...(navButtons.length > 0 ? [navButtons] : []),
            [telegraf_1.Markup.button.callback("🔙 Back to Menu", "ADMIN_BACK")]
        ]);
        const text = `👥 *All Users* (${allUsers.length})\n\nPage ${page + 1}/${totalPages}\n\nClick on a user to view details.`;
        try {
            yield ctx.editMessageText(text, Object.assign({ parse_mode: "Markdown" }, keyboard));
        }
        catch (e) {
            // Ignore "message is not modified" error
            if (!((_a = e.message) === null || _a === void 0 ? void 0 : _a.includes("not modified"))) {
                console.error("[ADMIN ERROR] -", e.message || e);
            }
        }
    });
}
function showUserDetails(ctx, userId) {
    return __awaiter(this, void 0, void 0, function* () {
        const user = yield (0, db_1.getUser)(userId);
        if (!user) {
            yield ctx.editMessageText("User not found.", Object.assign({ parse_mode: "Markdown" }, backKeyboard));
            return;
        }
        // Use saved name or try to get from Telegram
        let name = user.name;
        if (!name || name === "Not set" || name === "Unknown") {
            try {
                const chat = yield ctx.telegram.getChat(userId);
                name = chat.username || chat.first_name || "Not set";
            }
            catch (_a) {
                name = "Not set";
            }
        }
        const gender = user.gender || "Not set";
        const age = user.age || "Not set";
        const state = user.state || "Not set";
        const totalChats = user.totalChats || 0;
        const reports = yield (0, db_1.getReportCount)(userId);
        const banReason = yield (0, db_1.getBanReason)(userId);
        const isUserBanned = yield (0, db_1.isBanned)(userId);
        const referralCount = yield (0, db_1.getReferralCount)(userId);
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
        }
        else {
            details += `\n🚫 <b>Banned</b>: No`;
        }
        // Add ban/unban button
        const actionButtons = [];
        if (isUserBanned) {
            actionButtons.push(telegraf_1.Markup.button.callback("🔓 Unban User", `ADMIN_UNBAN_USER_${userId}`));
        }
        else {
            actionButtons.push(telegraf_1.Markup.button.callback("🚫 Ban User", `ADMIN_BAN_USER_${userId}`));
        }
        // Add premium button
        const premiumButtons = [];
        if (user.premium) {
            premiumButtons.push(telegraf_1.Markup.button.callback("❌ Revoke Premium", `ADMIN_REVOKE_PREMIUM_${userId}`));
        }
        else {
            premiumButtons.push(telegraf_1.Markup.button.callback("💎 Grant Premium", `ADMIN_GRANT_PREMIUM_${userId}`));
        }
        const keyboard = telegraf_1.Markup.inlineKeyboard([
            actionButtons,
            premiumButtons,
            [telegraf_1.Markup.button.callback("✏️ Edit Name", `ADMIN_EDIT_NAME_${userId}`)],
            [telegraf_1.Markup.button.callback("🔄 Reset Chats", `ADMIN_RESET_CHATS_${userId}`)],
            [telegraf_1.Markup.button.callback("🔄 Reset Reports", `ADMIN_RESET_REPORTS_${userId}`)],
            [telegraf_1.Markup.button.callback("🗑️ Delete User", `ADMIN_DELETE_USER_${userId}`)],
            [telegraf_1.Markup.button.callback("🔙 Back to Users", "ADMIN_USERS")]
        ]);
        try {
            yield ctx.editMessageText(details, Object.assign({ parse_mode: "Markdown" }, keyboard));
        }
        catch (e) {
            // Ignore "message is not modified" error
        }
    });
}
