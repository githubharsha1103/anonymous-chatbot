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
import { isBotBlockedError, cleanupBlockedUser } from "./Utils/telegramErrorHandler";

/* ---------------- BOT CLASS ---------------- */

// Idle timeout in milliseconds (1 hour)
const IDLE_TIMEOUT = 60 * 60 * 1000; // 1 hour

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

  // Chat activity tracking - userId -> last message timestamp
  chatActivity: Map<number, number> = new Map();

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

  // Update chat activity timestamp
  updateChatActivity(userId: number) {
    this.chatActivity.set(userId, Date.now());
  }

  // Get chat activity timestamp
  getChatActivity(userId: number): number | undefined {
    return this.chatActivity.get(userId);
  }

  // Remove chat activity
  removeChatActivity(userId: number) {
    this.chatActivity.delete(userId);
  }
}


export const bot = new ExtraTelegraf(process.env.BOT_TOKEN!);

/* ---------------- IDLE CHAT CHECK ---------------- */

async function checkIdleChats() {
  const now = Date.now();
  const chatsToEnd: number[] = [];

  // Check each running chat
  for (let i = 0; i < bot.runningChats.length; i += 2) {
    const user1 = bot.runningChats[i];
    const user2 = bot.runningChats[i + 1];

    // Get last activity for both users
    const activity1 = bot.getChatActivity(user1);
    const activity2 = bot.getChatActivity(user2);

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
    } else if (!activity1 && activity2) {
      // If user1 has no activity but user2 does, check user2's activity
      if (now - activity2 > IDLE_TIMEOUT) {
        chatsToEnd.push(user1, user2);
        console.log(`[IDLE CHECK] - Ending idle chat (user1 no activity, user2 idle for ${Math.round((now - activity2) / 60000)} minutes)`);
      }
    } else if (activity1 && !activity2) {
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
      await bot.telegram.sendMessage(
        userId,
        "⏰ *Chat Ended Due to Inactivity*\n\nYour chat has been ended because there was no activity for 1 hour.\n\nUse /next to find a new partner.",
        { parse_mode: "Markdown" }
      );
    } catch (error) {
      // User might have blocked the bot
    }

    // Clean up chat state
    const partner = bot.getPartner(userId);
    bot.runningChats = bot.runningChats.filter(u => u !== userId && u !== partner);
    bot.messageMap.delete(userId);
    bot.messageMap.delete(partner);
    bot.removeChatActivity(userId);
    bot.removeChatActivity(partner);
  }

  // Also check waiting queue users (remove after 1 hour of waiting)
  const waitingToRemove: number[] = [];

  for (const waiting of bot.waitingQueue) {
    // Check if user has been waiting for too long
    const activity = bot.getChatActivity(waiting.id);
    if (activity && now - activity > IDLE_TIMEOUT) {
      waitingToRemove.push(waiting.id);
      console.log(`[IDLE CHECK] - Removing user ${waiting.id} from waiting queue (waited ${Math.round((now - activity) / 60000)} minutes)`);
    }
  }

  for (const userId of waitingToRemove) {
    // Remove from waiting queue
    bot.waitingQueue = bot.waitingQueue.filter(w => w.id !== userId);
    bot.removeChatActivity(userId);

    // Clear waiting if it was this user
    if (bot.waiting === userId) {
      bot.waiting = null;
    }

    // Notify user
    try {
      await bot.telegram.sendMessage(
        userId,
        "⏰ *Search Timeout*\n\nYour search has been cancelled due to inactivity.\n\nUse /next to try again.",
        { parse_mode: "Markdown" }
      );
    } catch (error) {
      // User might have blocked the bot
    }
  }
}

// Start idle check every 5 minutes
setInterval(checkIdleChats, 5 * 60 * 1000);

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
      await ctx.telegram.sendMessage(userId, msg);
      successCount++;
    } catch (error: any) {
      // Check if user blocked the bot
      if (isBotBlockedError(error)) {
        cleanupBlockedUser(bot, userId);
        console.log(`[BROADCAST] - User ${userId} blocked the bot, cleaned up`);
      } else {
        console.log(`[BROADCAST] - Failed to send to ${userId}: ${error.message || error}`);
      }
      failCount++;
    }
  }

  ctx.reply(`Broadcast completed!\n✅ Sent: ${successCount}\n❌ Failed: ${failCount}`);
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
