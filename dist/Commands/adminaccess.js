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
// Admin main menu with clear options
const mainKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("👥 View All Users", "ADMIN_USERS")],
    [telegraf_1.Markup.button.callback("🚫 View Bans", "ADMIN_BANS")],
    [telegraf_1.Markup.button.callback("📊 Bot Statistics", "ADMIN_STATS")],
    [telegraf_1.Markup.button.callback("💬 Active Chats", "ADMIN_ACTIVE_CHATS")],
    [telegraf_1.Markup.button.callback("📢 Broadcast Message", "ADMIN_BROADCAST")],
    [telegraf_1.Markup.button.callback("👤 Ban User", "ADMIN_BAN_USER")],
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
        (0, db_1.updateUser)(userId, { isAdminAuthenticated: true });
        return ctx.reply("🔐 *Admin Panel*\n\nWelcome, Admin!\n\nSelect an option below:", Object.assign({ parse_mode: "Markdown" }, mainKeyboard));
    })
};
function initAdminActions(bot) {
    // Back to main menu
    bot.action("ADMIN_BACK", (ctx) => __awaiter(this, void 0, void 0, function* () {
        yield safeAnswerCbQuery(ctx);
        yield ctx.editMessageText("🔐 *Admin Panel*\n\nWelcome, Admin!\n\nSelect an option below:", Object.assign({ parse_mode: "Markdown" }, mainKeyboard));
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
        const bans = (0, db_1.readBans)();
        if (bans.length === 0) {
            yield ctx.editMessageText("🚫 *Banned Users*\n\nNo users are currently banned.\n\nUse the button below to return to menu.", Object.assign({ parse_mode: "Markdown" }, backKeyboard));
        }
        else {
            const banList = bans.map((id) => `• ${id}`).join("\n");
            yield ctx.editMessageText(`🚫 *Banned Users*\n\nTotal: ${bans.length}\n\n${banList}\n\nUse the button below to return to menu.`, Object.assign({ parse_mode: "Markdown" }, backKeyboard));
        }
    }));
    // View stats
    bot.action("ADMIN_STATS", (ctx) => __awaiter(this, void 0, void 0, function* () {
        yield safeAnswerCbQuery(ctx);
        const allUsers = (0, db_1.getAllUsers)();
        const bans = (0, db_1.readBans)();
        // Get total chats from bot instance
        const totalChats = bot.totalChats || 0;
        const stats = `📊 *Bot Statistics*\n\n` +
            `👥 Total Users: ${allUsers.length}\n` +
            `🚫 Banned Users: ${bans.length}\n` +
            `💬 Total Chats: ${totalChats}\n\n` +
            `Use the button below to return to menu.`;
        yield ctx.editMessageText(stats, Object.assign({ parse_mode: "Markdown" }, backKeyboard));
    }));
    // View active chats
    bot.action("ADMIN_ACTIVE_CHATS", (ctx) => __awaiter(this, void 0, void 0, function* () {
        yield safeAnswerCbQuery(ctx);
        const runningChats = bot.runningChats;
        const activeChatsCount = runningChats.length / 2;
        if (activeChatsCount === 0) {
            yield ctx.editMessageText("💬 *Active Chats*\n\nNo active chats at the moment.\n\nUse the button below to return to menu.", Object.assign({ parse_mode: "Markdown" }, backKeyboard));
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
        yield ctx.editMessageText(`💬 *Active Chats*\n\nTotal: ${activeChatsCount}\n\nSelect a chat to spectate:`, Object.assign({ parse_mode: "Markdown" }, keyboard));
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
        const keyboard = telegraf_1.Markup.inlineKeyboard([
            [telegraf_1.Markup.button.callback("🔙 Exit Spectator Mode", `ADMIN_EXIT_SPECTATE`)]
        ]);
        yield ctx.editMessageText(`👁️ *Spectating Chat*\n\n` +
            `👤 User 1: \`${user1}\`\n` +
            `👤 User 2: \`${user2}\`\n\n` +
            `Messages from this chat will be forwarded here in real-time.\n\n` +
            `Use the button below to exit spectator mode.`, Object.assign({ parse_mode: "Markdown" }, keyboard));
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
        yield ctx.editMessageText("👁️ Spectator Mode Exited.\n\nUse the button below to return to menu.", Object.assign({ parse_mode: "Markdown" }, backKeyboard));
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
        yield ctx.editMessageText("📢 *Broadcast Message*\n\n" +
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
        yield ctx.editMessageText("📢 *Broadcast Message*\n\n" +
            "Broadcast cancelled.\n\n" +
            "Use the button below to return to menu.", Object.assign({ parse_mode: "Markdown" }, backKeyboard));
    }));
    // Ban user
    bot.action("ADMIN_BAN_USER", (ctx) => __awaiter(this, void 0, void 0, function* () {
        yield safeAnswerCbQuery(ctx);
        yield ctx.editMessageText("👤 *Ban User*\n\n" +
            "To ban a user, use the /ban command with their User ID.\n\n" +
            "Example: /ban 1130645873\n\n" +
            "Use the button below to return to menu.", Object.assign({ parse_mode: "Markdown" }, backKeyboard));
    }));
    // Logout
    bot.action("ADMIN_LOGOUT", (ctx) => __awaiter(this, void 0, void 0, function* () {
        yield safeAnswerCbQuery(ctx);
        if (!ctx.from)
            return;
        (0, db_1.updateUser)(ctx.from.id, { isAdminAuthenticated: false });
        yield ctx.editMessageText("🔐 *Admin Panel*\n\nYou have been logged out.", { parse_mode: "Markdown" });
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
        (0, db_1.banUser)(userId);
        yield showUserDetails(ctx, userId);
    }));
    // Unban user from details
    bot.action(/ADMIN_UNBAN_USER_(\d+)/, (ctx) => __awaiter(this, void 0, void 0, function* () {
        yield safeAnswerCbQuery(ctx);
        const userId = parseInt(ctx.match[1]);
        (0, db_1.unbanUser)(userId);
        yield showUserDetails(ctx, userId);
    }));
    // Grant premium access
    bot.action(/ADMIN_GRANT_PREMIUM_(\d+)/, (ctx) => __awaiter(this, void 0, void 0, function* () {
        yield safeAnswerCbQuery(ctx, "Premium granted ✅");
        const userId = parseInt(ctx.match[1]);
        (0, db_1.updateUser)(userId, { premium: true });
        yield showUserDetails(ctx, userId);
    }));
    // Revoke premium access
    bot.action(/ADMIN_REVOKE_PREMIUM_(\d+)/, (ctx) => __awaiter(this, void 0, void 0, function* () {
        yield safeAnswerCbQuery(ctx, "Premium revoked ❌");
        const userId = parseInt(ctx.match[1]);
        (0, db_1.updateUser)(userId, { premium: false });
        yield showUserDetails(ctx, userId);
    }));
    // Delete user
    bot.action(/ADMIN_DELETE_USER_(\d+)/, (ctx) => __awaiter(this, void 0, void 0, function* () {
        yield safeAnswerCbQuery(ctx, "User deleted ❌");
        const userId = parseInt(ctx.match[1]);
        (0, db_1.deleteUser)(userId);
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
        yield ctx.editMessageText(`📝 *Edit Name*\n\nUser ID: \`${userId}\`\n\n` +
            `To change the user's name, use:\n` +
            `/setname ${userId} NewName\n\n` +
            `Use the button below to go back.`, Object.assign({ parse_mode: "Markdown" }, keyboard));
    }));
    // Reset user chats
    bot.action(/ADMIN_RESET_CHATS_(\d+)/, (ctx) => __awaiter(this, void 0, void 0, function* () {
        yield safeAnswerCbQuery(ctx, "Chats reset ✅");
        const userId = parseInt(ctx.match[1]);
        (0, db_1.updateUser)(userId, { daily: 0 });
        yield showUserDetails(ctx, userId);
    }));
    // Reset user reports
    bot.action(/ADMIN_RESET_REPORTS_(\d+)/, (ctx) => __awaiter(this, void 0, void 0, function* () {
        yield safeAnswerCbQuery(ctx, "Reports reset ✅");
        const userId = parseInt(ctx.match[1]);
        (0, db_1.updateUser)(userId, { reportCount: 0, reportingPartner: null, reportReason: null });
        yield showUserDetails(ctx, userId);
    }));
}
function showUsersPage(ctx, page) {
    return __awaiter(this, void 0, void 0, function* () {
        const allUsers = (0, db_1.getAllUsers)();
        const usersPerPage = 10;
        const totalPages = Math.ceil(allUsers.length / usersPerPage);
        const start = page * usersPerPage;
        const end = Math.min(start + usersPerPage, allUsers.length);
        const pageUsers = allUsers.slice(start, end);
        const userButtons = yield Promise.all(pageUsers.map((id) => __awaiter(this, void 0, void 0, function* () {
            const userId = parseInt(id);
            const user = (0, db_1.getUser)(userId);
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
            const status = (0, db_1.isBanned)(userId) ? "🚫" : "✅";
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
        }
    });
}
function showUserDetails(ctx, userId) {
    return __awaiter(this, void 0, void 0, function* () {
        const user = (0, db_1.getUser)(userId);
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
        const reports = (0, db_1.getReportCount)(userId);
        const banReason = (0, db_1.getBanReason)(userId);
        const isUserBanned = (0, db_1.isBanned)(userId);
        let details = `👤 *User Details*\n\n` +
            `🆔 User ID: \`${userId}\`\n` +
            `📛 Name: ${name}\n` +
            `⚧️ Gender: ${gender}\n` +
            `🎂 Age: ${age}\n` +
            `📍 State: ${state}\n` +
            `💬 Total Chats: ${totalChats}\n` +
            `⚠️ Reports: ${reports}\n` +
            `💎 Premium: ${user.premium ? "Yes ✅" : "No ❌"}`;
        if (isUserBanned) {
            details += `\n🚫 *Banned*: Yes\n` +
                `📝 Ban Reason: ${banReason || "Not specified"}`;
        }
        else {
            details += `\n🚫 *Banned*: No`;
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
