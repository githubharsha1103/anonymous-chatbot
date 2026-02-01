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
exports.bot = exports.ExtraTelegraf = void 0;
require("dotenv/config");
const telegraf_1 = require("telegraf");
const db_1 = require("./storage/db");
const telegramErrorHandler_1 = require("./Utils/telegramErrorHandler");
/* ---------------- BOT CLASS ---------------- */
// Idle timeout in milliseconds (1 hour)
const IDLE_TIMEOUT = 60 * 60 * 1000; // 1 hour
class ExtraTelegraf extends telegraf_1.Telegraf {
    constructor() {
        super(...arguments);
        this.waiting = null;
        this.waitingQueue = [];
        this.runningChats = [];
        // Message mapping for replies
        this.messageMap = new Map();
        // Statistics
        this.totalChats = 0;
        this.totalUsers = 0;
        // Spectator mode - admin ID -> { user1, user2 }
        this.spectatingChats = new Map();
        // Chat activity tracking - userId -> last message timestamp
        this.chatActivity = new Map();
    }
    getPartner(id) {
        const index = this.runningChats.indexOf(id);
        if (index % 2 === 0)
            return this.runningChats[index + 1];
        return this.runningChats[index - 1];
    }
    incrementChatCount() {
        this.totalChats++;
    }
    incrementUserCount() {
        this.totalUsers++;
    }
    // Check if a user is being spectated
    isUserInSpectatorChat(userId) {
        for (const [, chat] of this.spectatingChats) {
            if (chat.user1 === userId || chat.user2 === userId) {
                return true;
            }
        }
        return false;
    }
    // Get spectator chat for a user
    getSpectatorChatForUser(userId) {
        for (const [adminId, chat] of this.spectatingChats) {
            if (chat.user1 === userId || chat.user2 === userId) {
                return { adminId, chat };
            }
        }
        return null;
    }
    // Update chat activity timestamp
    updateChatActivity(userId) {
        this.chatActivity.set(userId, Date.now());
    }
    // Get chat activity timestamp
    getChatActivity(userId) {
        return this.chatActivity.get(userId);
    }
    // Remove chat activity
    removeChatActivity(userId) {
        this.chatActivity.delete(userId);
    }
}
exports.ExtraTelegraf = ExtraTelegraf;
exports.bot = new ExtraTelegraf(process.env.BOT_TOKEN);
/* ---------------- IDLE CHAT CHECK ---------------- */
function checkIdleChats() {
    return __awaiter(this, void 0, void 0, function* () {
        const now = Date.now();
        const chatsToEnd = [];
        // Check each running chat
        for (let i = 0; i < exports.bot.runningChats.length; i += 2) {
            const user1 = exports.bot.runningChats[i];
            const user2 = exports.bot.runningChats[i + 1];
            // Get last activity for both users
            const activity1 = exports.bot.getChatActivity(user1);
            const activity2 = exports.bot.getChatActivity(user2);
            // If either user has no activity, use the time when the chat started
            // For simplicity, we check if both users have been idle for 1 hour
            if (activity1 && activity2) {
                const idleTime1 = now - activity1;
                const idleTime2 = now - activity2;
                // If both users have been idle for more than 1 hour, end the chat
                if (idleTime1 > IDLE_TIMEOUT && idleTime2 > IDLE_TIMEOUT) {
                    chatsToEnd.push(user1, user2);
                    console.log(`[IDLE CHECK] - Ending idle chat between ${user1} and ${user2} (idle for ${Math.round(idleTime1 / 60000)} minutes)`);
                }
            }
            else if (!activity1 && activity2) {
                // If user1 has no activity but user2 does, check user2's activity
                if (now - activity2 > IDLE_TIMEOUT) {
                    chatsToEnd.push(user1, user2);
                    console.log(`[IDLE CHECK] - Ending idle chat (user1 no activity, user2 idle for ${Math.round((now - activity2) / 60000)} minutes)`);
                }
            }
            else if (activity1 && !activity2) {
                if (now - activity1 > IDLE_TIMEOUT) {
                    chatsToEnd.push(user1, user2);
                    console.log(`[IDLE CHECK] - Ending idle chat (user2 no activity, user1 idle for ${Math.round((now - activity1) / 60000)} minutes)`);
                }
            }
            // If both have no activity, we don't end the chat (they might just have started)
        }
        // End the idle chats
        for (const userId of chatsToEnd) {
            try {
                yield exports.bot.telegram.sendMessage(userId, "⏰ *Chat Ended Due to Inactivity*\n\nYour chat has been ended because there was no activity for 1 hour.\n\nUse /next to find a new partner.", { parse_mode: "Markdown" });
            }
            catch (error) {
                // User might have blocked the bot
            }
            // Clean up chat state
            const partner = exports.bot.getPartner(userId);
            exports.bot.runningChats = exports.bot.runningChats.filter(u => u !== userId && u !== partner);
            exports.bot.messageMap.delete(userId);
            exports.bot.messageMap.delete(partner);
            exports.bot.removeChatActivity(userId);
            exports.bot.removeChatActivity(partner);
        }
        // Also check waiting queue users (remove after 1 hour of waiting)
        const waitingToRemove = [];
        for (const waiting of exports.bot.waitingQueue) {
            // Check if user has been waiting for too long
            const activity = exports.bot.getChatActivity(waiting.id);
            if (activity && now - activity > IDLE_TIMEOUT) {
                waitingToRemove.push(waiting.id);
                console.log(`[IDLE CHECK] - Removing user ${waiting.id} from waiting queue (waited ${Math.round((now - activity) / 60000)} minutes)`);
            }
        }
        for (const userId of waitingToRemove) {
            // Remove from waiting queue
            exports.bot.waitingQueue = exports.bot.waitingQueue.filter(w => w.id !== userId);
            exports.bot.removeChatActivity(userId);
            // Clear waiting if it was this user
            if (exports.bot.waiting === userId) {
                exports.bot.waiting = null;
            }
            // Notify user
            try {
                yield exports.bot.telegram.sendMessage(userId, "⏰ *Search Timeout*\n\nYour search has been cancelled due to inactivity.\n\nUse /next to try again.", { parse_mode: "Markdown" });
            }
            catch (error) {
                // User might have blocked the bot
            }
        }
    });
}
// Start idle check every 5 minutes
setInterval(checkIdleChats, 5 * 60 * 1000);
/* ---------------- LOADERS ---------------- */
const commandHandler_1 = require("./Utils/commandHandler");
const eventHandler_1 = require("./Utils/eventHandler");
const actionHandler_1 = require("./Utils/actionHandler");
// Initialize handlers
(0, commandHandler_1.loadCommands)();
(0, eventHandler_1.loadEvents)();
(0, actionHandler_1.loadActions)();
/* ---------------- ADMIN PANEL ---------------- */
const adminaccess_js_1 = require("./Commands/adminaccess.js");
(0, adminaccess_js_1.initAdminActions)(exports.bot);
/* ---------------- ADMIN ---------------- */
const ADMINS = ((_a = process.env.ADMIN_IDS) === null || _a === void 0 ? void 0 : _a.split(",")) || [];
function isAdmin(id) {
    return ADMINS.includes(id.toString());
}
/* ---------------- GLOBAL BAN CHECK ---------------- */
exports.bot.use((ctx, next) => __awaiter(void 0, void 0, void 0, function* () {
    if (ctx.from && (0, db_1.isBanned)(ctx.from.id)) {
        yield ctx.reply("🚫 You are banned.");
        return;
    }
    return next();
}));
/* ---------------- GENDER COMMAND ---------------- */
exports.bot.command("setgender", (ctx) => {
    var _a;
    const g = (_a = ctx.message.text.split(" ")[1]) === null || _a === void 0 ? void 0 : _a.toLowerCase();
    if (!g || !["male", "female"].includes(g)) {
        return ctx.reply("Use: /setgender male OR /setgender female");
    }
    (0, db_1.setGender)(ctx.from.id, g);
    ctx.reply(`Gender set to ${g}`);
});
/* ---------------- ADMIN BAN ---------------- */
exports.bot.command("ban", (ctx) => {
    if (!isAdmin(ctx.from.id))
        return;
    const id = Number(ctx.message.text.split(" ")[1]);
    if (!id)
        return ctx.reply("Usage: /ban USERID");
    (0, db_1.banUser)(id);
    ctx.reply(`User ${id} banned`);
});
/* ---------------- ADMIN BROADCAST ---------------- */
exports.bot.command("broadcast", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    if (!isAdmin(ctx.from.id))
        return;
    const msg = ctx.message.text.replace("/broadcast", "").trim();
    if (!msg)
        return ctx.reply("Usage: /broadcast message");
    const users = (0, db_1.getAllUsers)();
    if (users.length === 0) {
        return ctx.reply("No users to broadcast to.");
    }
    let successCount = 0;
    let failCount = 0;
    // Send messages to all users
    for (const id of users) {
        const userId = Number(id);
        if (isNaN(userId)) {
            failCount++;
            continue;
        }
        try {
            yield ctx.telegram.sendMessage(userId, msg);
            successCount++;
        }
        catch (error) {
            // Check if user blocked the bot
            if ((0, telegramErrorHandler_1.isBotBlockedError)(error)) {
                (0, telegramErrorHandler_1.cleanupBlockedUser)(exports.bot, userId);
                console.log(`[BROADCAST] - User ${userId} blocked the bot, cleaned up`);
            }
            else {
                console.log(`[BROADCAST] - Failed to send to ${userId}: ${error.message || error}`);
            }
            failCount++;
        }
    }
    ctx.reply(`Broadcast completed!\n✅ Sent: ${successCount}\n❌ Failed: ${failCount}`);
}));
/* ---------------- ADMIN ACTIVE CHATS ---------------- */
exports.bot.command("active", (ctx) => {
    if (!isAdmin(ctx.from.id))
        return;
    ctx.reply(`Active chats: ${exports.bot.runningChats.length / 2}`);
});
/* ---------------- ADMIN STATS ---------------- */
exports.bot.command("stats", (ctx) => {
    if (!isAdmin(ctx.from.id))
        return;
    const stats = `
📊 *Bot Statistics*

👥 *Total Users:* ${exports.bot.totalUsers}
💬 *Total Chats:* ${exports.bot.totalChats}
💭 *Active Chats:* ${exports.bot.runningChats.length / 2}
⏳ *Users Waiting:* ${exports.bot.waitingQueue.length}
`;
    ctx.reply(stats, { parse_mode: "Markdown" });
});
/* ---------------- ADMIN SET NAME ---------------- */
exports.bot.command("setname", (ctx) => {
    if (!isAdmin(ctx.from.id))
        return;
    const args = ctx.message.text.split(" ");
    const id = Number(args[1]);
    const name = args.slice(2).join(" ").trim();
    if (!id || !name)
        return ctx.reply("Usage: /setname USERID NewName");
    (0, db_1.updateUser)(id, { name });
    ctx.reply(`User ${id} name updated to: ${name}`);
});
/* ---------------- START ---------------- */
console.log("[INFO] - Bot is online");
exports.bot.launch();
process.once("SIGINT", () => exports.bot.stop("SIGINT"));
process.once("SIGTERM", () => exports.bot.stop("SIGTERM"));
