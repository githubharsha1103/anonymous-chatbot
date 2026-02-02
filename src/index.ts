import 'dotenv/config';
import { Context, Telegraf } from "telegraf";

import { 
  setGender,
  getGender,
  banUser,
  isBanned,
  getAllUsers,
  updateUser
} from "./storage/db";
import { isBotBlockedError, cleanupBlockedUser, broadcastWithRateLimit } from "./Utils/telegramErrorHandler";

/* ---------------- BOT CLASS ---------------- */

export class ExtraTelegraf extends Telegraf<Context> {
  waiting: number | null = null;
  waitingQueue: { id: number; preference: string; gender: string }[] = [];
  runningChats: number[] = [];

  // Message mapping for replies
  messageMap: Map<number, { [key: number]: number }> = new Map();

  // Statistics
  totalChats: number = 0;
  totalUsers: number = 0;

  // Spectator mode - admin ID -> { user1, user2 }
  spectatingChats: Map<number, { user1: number; user2: number }> = new Map();

  getPartner(id: number) {
    const index = this.runningChats.indexOf(id);
    if (index % 2 === 0) return this.runningChats[index + 1];
    return this.runningChats[index - 1];
  }

  incrementChatCount() {
    this.totalChats++;
  }

  incrementUserCount() {
    this.totalUsers++;
  }

  // Check if a user is being spectated
  isUserInSpectatorChat(userId: number): boolean {
    for (const [, chat] of this.spectatingChats) {
      if (chat.user1 === userId || chat.user2 === userId) {
        return true;
      }
    }
    return false;
  }

  // Get spectator chat for a user
  getSpectatorChatForUser(userId: number): { adminId: number; chat: { user1: number; user2: number } } | null {
    for (const [adminId, chat] of this.spectatingChats) {
      if (chat.user1 === userId || chat.user2 === userId) {
        return { adminId, chat };
      }
    }
    return null;
  }
}

export const bot = new ExtraTelegraf(process.env.BOT_TOKEN!);

/* ---------------- LOADERS ---------------- */

import { loadCommands } from "./Utils/commandHandler";
import { loadEvents } from "./Utils/eventHandler";
import { loadActions } from "./Utils/actionHandler";

// Initialize handlers
loadCommands();
loadEvents();
loadActions();

/* ---------------- ADMIN PANEL ---------------- */

import { initAdminActions } from "./Commands/adminaccess.js";
initAdminActions(bot);

/* ---------------- ADMIN ---------------- */

const ADMINS = process.env.ADMIN_IDS?.split(",") || [];

function isAdmin(id: number) {
  return ADMINS.includes(id.toString());
}

/* ---------------- GLOBAL BAN CHECK ---------------- */

bot.use(async (ctx, next) => {
  if (ctx.from && isBanned(ctx.from.id)) {
    await ctx.reply("🚫 You are banned.");
    return;
  }
  return next();
});

/* ---------------- GENDER COMMAND ---------------- */

bot.command("setgender", (ctx) => {
  const g = ctx.message.text.split(" ")[1]?.toLowerCase();
  if (!g || !["male", "female"].includes(g)) {
    return ctx.reply("Use: /setgender male OR /setgender female");
  }
  setGender(ctx.from.id, g);
  ctx.reply(`Gender set to ${g}`);
});

/* ---------------- ADMIN BAN ---------------- */

bot.command("ban", (ctx) => {
  if (!isAdmin(ctx.from.id)) return;

  const id = Number(ctx.message.text.split(" ")[1]);
  if (!id) return ctx.reply("Usage: /ban USERID");

  banUser(id);
  ctx.reply(`User ${id} banned`);
});

/* ---------------- ADMIN BROADCAST ---------------- */

bot.command("broadcast", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;

  const msg = ctx.message.text.replace("/broadcast", "").trim();
  if (!msg) return ctx.reply("Usage: /broadcast message");

  const users = getAllUsers();
  
  if (users.length === 0) {
    return ctx.reply("No users to broadcast to.");
  }

  // Send broadcast with rate limiting
  const userIds = users.map(id => Number(id)).filter(id => !isNaN(id));
  const { success, failed } = await broadcastWithRateLimit(bot, userIds, msg);

  ctx.reply(`Broadcast completed!\n✅ Sent: ${success}\n❌ Failed: ${failed}`);
});

/* ---------------- ADMIN ACTIVE CHATS ---------------- */

bot.command("active", (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  ctx.reply(`Active chats: ${bot.runningChats.length / 2}`);
});

/* ---------------- ADMIN STATS ---------------- */

bot.command("stats", (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  
  const stats = `
📊 *Bot Statistics*

👥 *Total Users:* ${bot.totalUsers}
💬 *Total Chats:* ${bot.totalChats}
💭 *Active Chats:* ${bot.runningChats.length / 2}
⏳ *Users Waiting:* ${bot.waitingQueue.length}
`;
  
  ctx.reply(stats, { parse_mode: "Markdown" });
});

/* ---------------- ADMIN SET NAME ---------------- */

bot.command("setname", (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  
  const args = ctx.message.text.split(" ");
  const id = Number(args[1]);
  const name = args.slice(2).join(" ").trim();
  
  if (!id || !name) return ctx.reply("Usage: /setname USERID NewName");
  
  updateUser(id, { name });
  ctx.reply(`User ${id} name updated to: ${name}`);
});

/* ---------------- START ---------------- */

console.log("[INFO] - Bot is online");
bot.launch();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
