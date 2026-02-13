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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.bot = exports.ExtraTelegraf = void 0;
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const telegraf_1 = require("telegraf");
const db_1 = require("./storage/db");
const telegramErrorHandler_1 = require("./Utils/telegramErrorHandler");
/* ---------------- BOT CLASS ---------------- */
// Simple mutex for race condition prevention
class Mutex {
    constructor() {
        this.locked = false;
        this.queue = [];
    }
    acquire() {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise(resolve => {
                if (!this.locked) {
                    this.locked = true;
                    resolve();
                }
                else {
                    this.queue.push(resolve);
                }
            });
        });
    }
    release() {
        if (this.queue.length > 0) {
            const next = this.queue.shift();
            if (next)
                next();
        }
        else {
            this.locked = false;
        }
    }
}
class ExtraTelegraf extends telegraf_1.Telegraf {
    constructor() {
        super(...arguments);
        this.waiting = null;
        this.waitingQueue = [];
        this.runningChats = [];
        // Message mapping for replies
        this.messageMap = new Map();
        // Message count tracking for chat statistics
        this.messageCountMap = new Map();
        // Statistics
        this.totalChats = 0;
        this.totalUsers = 0;
        // Spectator mode - admin ID -> { user1, user2 }
        this.spectatingChats = new Map();
        // Rate limiting - userId -> last command time
        this.rateLimitMap = new Map();
        // Mutexes for race condition prevention
        this.chatMutex = new Mutex();
        this.queueMutex = new Mutex();
        // Maximum queue size
        this.MAX_QUEUE_SIZE = 10000;
        // Rate limit window in milliseconds (1 second - faster for real-time chat)
        this.RATE_LIMIT_WINDOW = 1000;
    }
    getPartner(id) {
        const index = this.runningChats.indexOf(id);
        if (index === -1)
            return null; // User not in any chat
        // Even index (0, 2, 4...) - partner is at index + 1
        if (index % 2 === 0) {
            // Check if partner exists at index + 1
            if (index + 1 < this.runningChats.length) {
                return this.runningChats[index + 1];
            }
            return null; // No partner found
        }
        // Odd index (1, 3, 5...) - partner is at index - 1
        if (index - 1 >= 0) {
            return this.runningChats[index - 1];
        }
        return null; // No partner found
    }
    incrementChatCount() {
        this.totalChats++;
        // Persist to database (fire and forget, don't await)
        (0, db_1.incrementTotalChats)().catch(err => console.error("[ERROR] - Failed to persist chat count:", err));
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
    // Check if user is rate limited
    isRateLimited(userId) {
        const now = Date.now();
        const lastCommand = this.rateLimitMap.get(userId);
        if (lastCommand && (now - lastCommand) < this.RATE_LIMIT_WINDOW) {
            return true;
        }
        this.rateLimitMap.set(userId, now);
        return false;
    }
    // Check if queue is full
    isQueueFull() {
        return this.waitingQueue.length >= this.MAX_QUEUE_SIZE;
    }
}
exports.ExtraTelegraf = ExtraTelegraf;
exports.bot = new ExtraTelegraf(process.env.BOT_TOKEN);
/* ---------------- LOADERS ---------------- */
const commandHandler_1 = require("./Utils/commandHandler");
const eventHandler_1 = require("./Utils/eventHandler");
const actionHandler_1 = require("./Utils/actionHandler");
// Initialize handlers
(0, commandHandler_1.loadCommands)();
(0, eventHandler_1.loadEvents)();
(0, actionHandler_1.loadActions)();
/* ---------------- ADMIN PANEL ---------------- */
const adminaccess_1 = require("./Commands/adminaccess");
(0, adminaccess_1.initAdminActions)(exports.bot);
/* ---------------- RE-ENGAGEMENT ---------------- */
const reengagement_1 = require("./Commands/reengagement");
(0, reengagement_1.initReengagementActions)(exports.bot);
/* ---------------- REFERRAL SYSTEM ---------------- */
const referral_1 = require("./Commands/referral");
(0, referral_1.initReferralActions)(exports.bot);
/* ---------------- ADMIN ---------------- */
const ADMINS = ((_a = process.env.ADMIN_IDS) === null || _a === void 0 ? void 0 : _a.split(",")) || [];
function isAdmin(id) {
    return ADMINS.includes(id.toString());
}
/* ---------------- GLOBAL BAN CHECK ---------------- */
exports.bot.use((ctx, next) => __awaiter(void 0, void 0, void 0, function* () {
    if (ctx.from && (yield (0, db_1.isBanned)(ctx.from.id))) {
        yield ctx.reply("🚫 You are banned.");
        return;
    }
    return next();
}));
/* ---------------- GENDER COMMAND ---------------- */
exports.bot.command("setgender", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const g = (_a = ctx.message.text.split(" ")[1]) === null || _a === void 0 ? void 0 : _a.toLowerCase();
    if (!g || !["male", "female"].includes(g)) {
        return ctx.reply("Use: /setgender male OR /setgender female");
    }
    yield (0, db_1.setGender)(ctx.from.id, g);
    ctx.reply(`Gender set to ${g}`);
}));
/* ---------------- ADMIN BAN ---------------- */
exports.bot.command("ban", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    if (!isAdmin(ctx.from.id))
        return;
    const id = Number(ctx.message.text.split(" ")[1]);
    if (!id)
        return ctx.reply("Usage: /ban USERID");
    yield (0, db_1.banUser)(id);
    ctx.reply(`User ${id} banned`);
}));
/* ---------------- ADMIN BROADCAST ---------------- */
exports.bot.command("broadcast", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    if (!isAdmin(ctx.from.id))
        return;
    const msg = ctx.message.text.replace("/broadcast", "").trim();
    if (!msg)
        return ctx.reply("Usage: /broadcast message");
    const users = yield (0, db_1.getAllUsers)();
    if (users.length === 0) {
        return ctx.reply("No users to broadcast to.");
    }
    // Send broadcast with rate limiting
    const userIds = users.map(id => Number(id)).filter(id => !isNaN(id));
    const { success, failed, failedUserIds } = yield (0, telegramErrorHandler_1.broadcastWithRateLimit)(exports.bot, userIds, msg);
    // Delete users who failed to receive broadcast (blocked or deactivated)
    let deletedCount = 0;
    for (const userId of failedUserIds) {
        yield (0, db_1.deleteUser)(userId, "Broadcast failed - blocked or deactivated");
        deletedCount++;
    }
    ctx.reply(`Broadcast completed!\n✅ Sent: ${success}\n❌ Failed: ${failed}\n🗑️ Deleted: ${deletedCount}`);
}));
/* ---------------- ADMIN ACTIVE CHATS ---------------- */
exports.bot.command("active", (ctx) => {
    if (!isAdmin(ctx.from.id))
        return;
    ctx.reply(`Active chats: ${exports.bot.runningChats.length / 2}`);
});
/* ---------------- ADMIN STATS ---------------- */
exports.bot.command("stats", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    if (!isAdmin(ctx.from.id))
        return;
    const allUsers = yield (0, db_1.getAllUsers)();
    const totalChats = yield (0, db_1.getTotalChats)();
    const stats = `
📊 <b>Bot Statistics</b>

👥 <b>Total Users:</b> ${allUsers.length}
💬 <b>Total Chats:</b> ${totalChats}
💭 <b>Active Chats:</b> ${exports.bot.runningChats.length / 2}
⏳ <b>Users Waiting:</b> ${exports.bot.waitingQueue.length}
`;
    ctx.reply(stats, { parse_mode: "HTML" });
}));
/* ---------------- ADMIN SET NAME ---------------- */
exports.bot.command("setname", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    if (!isAdmin(ctx.from.id))
        return;
    const args = ctx.message.text.split(" ");
    const id = Number(args[1]);
    const name = args.slice(2).join(" ").trim();
    if (!id || !name)
        return ctx.reply("Usage: /setname USERID NewName");
    yield (0, db_1.updateUser)(id, { name });
    ctx.reply(`User ${id} name updated to: ${name}`);
}));
/* ---------------- START ---------------- */
console.log("[INFO] - Bot is online");
// Load statistics from database
(0, db_1.getTotalChats)().then(chats => {
    exports.bot.totalChats = chats;
    console.log(`[INFO] - Loaded ${chats} total chats from database`);
}).catch(err => {
    console.error("[ERROR] - Failed to load statistics:", err);
});
// Get the port from environment (Render.com sets PORT)
const PORT = parseInt(process.env.PORT || "3000", 10);
const WEBHOOK_PATH = process.env.WEBHOOK_PATH || "/webhook";
// For production (Render.com), use webhooks
if (process.env.RENDER_EXTERNAL_HOSTNAME || process.env.WEBHOOK_URL) {
    const domain = process.env.WEBHOOK_URL || `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`;
    const webhookUrl = `${domain}${WEBHOOK_PATH}`;
    console.log(`[INFO] - Setting webhook to: ${webhookUrl}`);
    // Set webhook
    exports.bot.telegram.setWebhook(webhookUrl).then(() => {
        console.log("[INFO] - Webhook set successfully");
    }).catch((err) => {
        console.error("[ERROR] - Failed to set webhook:", err.message);
    });
    // Start HTTP server for webhooks
    const app = (0, express_1.default)();
    // Use express.json() middleware for parsing Telegram updates
    app.use(express_1.default.json());
    // Webhook endpoint
    app.post(WEBHOOK_PATH, (req, res) => {
        // Handle Telegram update
        exports.bot.handleUpdate(req.body).then(() => {
            res.sendStatus(200);
        }).catch((err) => {
            // Log but don't crash on network errors to Telegram API
            const errMsg = (err === null || err === void 0 ? void 0 : err.message) || 'Unknown error';
            if (errMsg.includes('failed') || errMsg.includes('ECONNRESET') || errMsg.includes('ETIMEDOUT')) {
                console.log(`[WEBHOOK] - Network error during update handling: ${errMsg}`);
            }
            else {
                console.error("[ERROR] - Failed to handle update:", errMsg);
            }
            res.sendStatus(200); // Always return 200 to Telegram to prevent retries
        });
    });
    // Health check endpoint
    app.get("/health", (req, res) => {
        res.send("OK");
    });
    // Root endpoint for Render health checks
    app.get("/", (req, res) => {
        res.send("OK");
    });
    // Start the server
    app.listen(PORT, "0.0.0.0", () => {
        console.log(`[INFO] - Server listening on port ${PORT}`);
    });
}
else {
    // For local development, use long polling
    console.log("[INFO] - Using long polling (local development)");
    exports.bot.launch();
}
// Keep-alive mechanism to prevent bot from stopping due to inactivity
// This periodically sends a request to Telegram to keep the connection alive
const KEEPALIVE_INTERVAL = parseInt(process.env.KEEPALIVE_INTERVAL || "300000", 10); // 5 minutes default
if (KEEPALIVE_INTERVAL > 0) {
    console.log(`[INFO] - Starting keep-alive ping every ${KEEPALIVE_INTERVAL / 1000} seconds`);
    setInterval(() => __awaiter(void 0, void 0, void 0, function* () {
        try {
            // Send a getMe request to keep the connection alive
            yield exports.bot.telegram.getMe();
            console.log("[KEEPALIVE] - Bot connection is active");
        }
        catch (error) {
            console.error("[KEEPALIVE] - Error:", error);
        }
    }), KEEPALIVE_INTERVAL);
}
process.on("unhandledRejection", (reason, promise) => {
    console.error("[UNHANDLED REJECTION] -", reason);
});
process.on("uncaughtException", (error) => {
    console.error("[UNCAUGHT EXCEPTION] -", error.message);
    // Don't exit - let the process continue handling requests
});
process.once("SIGINT", () => __awaiter(void 0, void 0, void 0, function* () {
    console.log("[INFO] - Stopping bot (SIGINT)...");
    try {
        // In webhook mode, delete the webhook; in polling mode, stop the bot
        if (process.env.RENDER_EXTERNAL_HOSTNAME || process.env.WEBHOOK_URL) {
            yield exports.bot.telegram.deleteWebhook();
            console.log("[INFO] - Webhook deleted");
        }
        else if (exports.bot.botInfo) {
            yield exports.bot.stop("SIGINT");
        }
    }
    catch (error) {
        console.log("[INFO] - Bot stop skipped:", error.message);
    }
    // Close database connection
    try {
        yield (0, db_1.closeDatabase)();
    }
    catch (error) {
        // Ignore close errors
    }
    process.exit(0);
}));
process.once("SIGTERM", () => __awaiter(void 0, void 0, void 0, function* () {
    console.log("[INFO] - Stopping bot (SIGTERM)...");
    try {
        // In webhook mode, delete the webhook; in polling mode, stop the bot
        if (process.env.RENDER_EXTERNAL_HOSTNAME || process.env.WEBHOOK_URL) {
            yield exports.bot.telegram.deleteWebhook();
            console.log("[INFO] - Webhook deleted");
        }
        else if (exports.bot.botInfo) {
            yield exports.bot.stop("SIGTERM");
        }
    }
    catch (error) {
        console.log("[INFO] - Bot stop skipped:", error.message);
    }
    // Close database connection
    try {
        yield (0, db_1.closeDatabase)();
    }
    catch (error) {
        // Ignore close errors
    }
    process.exit(0);
}));
