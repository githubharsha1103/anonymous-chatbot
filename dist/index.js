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
    // Send broadcast with rate limiting
    const userIds = users.map(id => Number(id)).filter(id => !isNaN(id));
    const { success, failed } = yield (0, telegramErrorHandler_1.broadcastWithRateLimit)(exports.bot, userIds, msg);
    ctx.reply(`Broadcast completed!\n✅ Sent: ${success}\n❌ Failed: ${failed}`);
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
            console.error("[ERROR] - Failed to handle update:", err.message);
            res.sendStatus(500);
        });
    });
    // Health check endpoint
    app.get("/health", (req, res) => {
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
process.once("SIGINT", () => exports.bot.stop("SIGINT"));
process.once("SIGTERM", () => exports.bot.stop("SIGTERM"));
