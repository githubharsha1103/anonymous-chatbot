import 'dotenv/config';
import express, { Request, Response } from 'express';
import { Context, Telegraf } from "telegraf";
import http from 'http';

import { 
  setGender,
  getGender,
  banUser,
  isBanned,
  getAllUsers,
  updateUser,
  closeDatabase,
  getTotalChats,
  incrementTotalChats,
  deleteUser
} from "./storage/db";
import { isBotBlockedError, cleanupBlockedUser, broadcastWithRateLimit } from "./Utils/telegramErrorHandler";

/* ---------------- BOT CLASS ---------------- */

// Simple mutex for race condition prevention
class Mutex {
  private locked = false;
  private queue: (() => void)[] = [];

  async acquire(): Promise<void> {
    return new Promise(resolve => {
      if (!this.locked) {
        this.locked = true;
        resolve();
      } else {
        this.queue.push(resolve);
      }
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) next();
    } else {
      this.locked = false;
    }
  }
}

export class ExtraTelegraf extends Telegraf<Context> {
  waiting: number | null = null;
  waitingQueue: { id: number; preference: string; gender: string; isPremium: boolean }[] = [];
  runningChats: number[] = [];

  // Message mapping for replies
  messageMap: Map<number, { [key: number]: number }> = new Map();

  // Message count tracking for chat statistics
  messageCountMap: Map<number, number> = new Map();

  // Statistics
  totalChats: number = 0;
  totalUsers: number = 0;

  // Spectator mode - admin ID -> { user1, user2 }
  spectatingChats: Map<number, { user1: number; user2: number }> = new Map();

  // Rate limiting - userId -> last command time
  rateLimitMap: Map<number, number> = new Map();
  
  // Action cooldown - userId -> { action -> last execution time }
  actionCooldownMap: Map<number, Map<string, number>> = new Map();
  
  // Cooldown duration in milliseconds (1 second)
  ACTION_COOLDOWN = 1000;
  
  // Mutexes for race condition prevention
  chatMutex = new Mutex();
  queueMutex = new Mutex();

  // Maximum queue size
  MAX_QUEUE_SIZE = 10000;

  // Rate limit window in milliseconds (1 second - faster for real-time chat)
  RATE_LIMIT_WINDOW = 1000;

  // Check if user is in cooldown for a specific action
  isActionOnCooldown(userId: number, action: string): boolean {
    const userCooldowns = this.actionCooldownMap.get(userId);
    if (!userCooldowns) return false;
    
    const lastActionTime = userCooldowns.get(action);
    if (!lastActionTime) return false;
    
    return (Date.now() - lastActionTime) < this.ACTION_COOLDOWN;
  }
  
  // Set action cooldown for user
  setActionCooldown(userId: number, action: string): void {
    let userCooldowns = this.actionCooldownMap.get(userId);
    if (!userCooldowns) {
      userCooldowns = new Map();
      this.actionCooldownMap.set(userId, userCooldowns);
    }
    userCooldowns.set(action, Date.now());
    
    // Clean up old entries to prevent memory leaks
    if (this.actionCooldownMap.size > 1000) {
      const now = Date.now();
      for (const [uid, cooldowns] of this.actionCooldownMap) {
        let hasRecent = false;
        for (const [act, time] of cooldowns) {
          if (now - time < 60000) { // Keep entries from last minute
            hasRecent = true;
          } else {
            cooldowns.delete(act);
          }
        }
        if (!hasRecent) {
          this.actionCooldownMap.delete(uid);
        }
      }
    }
  }

  getPartner(id: number): number | null {
    const index = this.runningChats.indexOf(id);
    if (index === -1) return null; // User not in any chat
    
    // Validate that we have an even-indexed user (users should be stored in pairs)
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
    incrementTotalChats().catch(err => console.error("[ERROR] - Failed to persist chat count:", err));
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

  // Check if user is rate limited
  isRateLimited(userId: number): boolean {
    const now = Date.now();
    const lastCommand = this.rateLimitMap.get(userId);
    if (lastCommand && (now - lastCommand) < this.RATE_LIMIT_WINDOW) {
      return true;
    }
    this.rateLimitMap.set(userId, now);
    return false;
  }

  // Check if queue is full
  isQueueFull(): boolean {
    return this.waitingQueue.length >= this.MAX_QUEUE_SIZE;
  }
}

export const bot = new ExtraTelegraf(process.env.BOT_TOKEN!);

// Global catch handler for callback query errors
bot.catch((err, ctx) => {
    console.error("[Global bot error]:", err);
    
    // Always try to answer callback query to prevent UI freeze
    if (ctx.callbackQuery) {
        ctx.answerCbQuery().catch(() => {});
    }
});

// Add global error handling middleware for Telegraf BEFORE loading handlers
bot.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    const userId = ctx.from?.id;
    console.error("[MIDDLEWARE ERROR] -", err);
    // Don't let errors propagate - log and continue
  }
});

/* ---------------- LOADERS ---------------- */

import { loadCommands } from "./Utils/commandHandler";
import { loadEvents } from "./Utils/eventHandler";
import { loadActions } from "./Utils/actionHandler";

// Initialize handlers
loadCommands();
loadEvents();
loadActions();

/* ---------------- ADMIN PANEL ---------------- */

import { initAdminActions } from "./Commands/adminaccess";
initAdminActions(bot);

/* ---------------- RE-ENGAGEMENT ---------------- */

import { initReengagementActions } from "./Commands/reengagement";
initReengagementActions(bot);

/* ---------------- REFERRAL SYSTEM ---------------- */

import referral from "./Commands/referral";
referral.initActions(bot);

/* ---------------- ADMIN ---------------- */

const ADMINS = process.env.ADMIN_IDS?.split(",") || [];

function isAdmin(id: number) {
  return ADMINS.includes(id.toString());
}

/* ---------------- GLOBAL BAN CHECK ---------------- */

bot.use(async (ctx, next) => {
  if (ctx.from && await isBanned(ctx.from.id)) {
    await ctx.reply("🚫 You are banned.");
    return;
  }
  return next();
});

/* ---------------- GENDER COMMAND ---------------- */

bot.command("setgender", async (ctx) => {
  const g = ctx.message.text.split(" ")[1]?.toLowerCase();
  if (!g || !["male", "female"].includes(g)) {
    return ctx.reply("Use: /setgender male OR /setgender female");
  }
  await setGender(ctx.from.id, g);
  ctx.reply(`Gender set to ${g}`);
});

/* ---------------- ADMIN BAN ---------------- */

bot.command("ban", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;

  const id = Number(ctx.message.text.split(" ")[1]);
  if (!id) return ctx.reply("Usage: /ban USERID");

  await banUser(id);
  ctx.reply(`User ${id} banned`);
});

/* ---------------- ADMIN BROADCAST ---------------- */

bot.command("broadcast", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;

  const msg = ctx.message.text.replace("/broadcast", "").trim();
  if (!msg) return ctx.reply("Usage: /broadcast message");

  const users = await getAllUsers();
  
  if (users.length === 0) {
    return ctx.reply("No users to broadcast to.");
  }

  // Send broadcast with rate limiting
  const userIds = users.map(id => Number(id)).filter(id => !isNaN(id));
  const { success, failed, failedUserIds } = await broadcastWithRateLimit(bot, userIds, msg);
  
  // Delete users who failed to receive broadcast (blocked or deactivated)
  let deletedCount = 0;
  for (const userId of failedUserIds) {
    await deleteUser(userId, "Broadcast failed - blocked or deactivated");
    deletedCount++;
  }

  ctx.reply(`Broadcast completed!\n✅ Sent: ${success}\n❌ Failed: ${failed}\n🗑️ Deleted: ${deletedCount}`);
});

/* ---------------- ADMIN ACTIVE CHATS ---------------- */

bot.command("active", (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  ctx.reply(`Active chats: ${bot.runningChats.length / 2}`);
});

/* ---------------- ADMIN STATS ---------------- */

bot.command("stats", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  
  const allUsers = await getAllUsers();
  const totalChats = await getTotalChats();
  
  const stats = `
📊 <b>Bot Statistics</b>

👥 <b>Total Users:</b> ${allUsers.length}
💬 <b>Total Chats:</b> ${totalChats}
💭 <b>Active Chats:</b> ${bot.runningChats.length / 2}
⏳ <b>Users Waiting:</b> ${bot.waitingQueue.length}
`;
  
  ctx.reply(stats, { parse_mode: "HTML" });
});

/* ---------------- ADMIN SET NAME ---------------- */

bot.command("setname", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  
  const args = ctx.message.text.split(" ");
  const id = Number(args[1]);
  const name = args.slice(2).join(" ").trim();
  
  if (!id || !name) return ctx.reply("Usage: /setname USERID NewName");
  
  await updateUser(id, { name });
  ctx.reply(`User ${id} name updated to: ${name}`);
});

/* ---------------- START ---------------- */

console.log("[INFO] - Bot is online");

// Load statistics from database
getTotalChats().then(chats => {
  bot.totalChats = chats;
  console.log(`[INFO] - Loaded ${chats} total chats from database`);
}).catch(err => {
  console.error("[ERROR] - Failed to load statistics:", err);
});

// Get the port from environment (Render.com sets PORT)
const PORT = parseInt(process.env.PORT || "3000", 10);
const WEBHOOK_PATH = process.env.WEBHOOK_PATH || "/webhook";

// For production (Render.com), use webhooks
if (process.env.NODE_ENV === "production") {
  // Build webhook URL - prefer explicit WEBHOOK_URL, fallback to RENDER_EXTERNAL_HOSTNAME
  const domain = process.env.WEBHOOK_URL || 
    (process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : null);
  
  if (!domain) {
    console.error("[ERROR] - Cannot determine domain for webhook. Set WEBHOOK_URL or RENDER_EXTERNAL_HOSTNAME");
    process.exit(1);
  }
  
  const webhookUrl = `${domain}${WEBHOOK_PATH}`;
  console.log(`[INFO] - Setting webhook to: ${webhookUrl}`);

  const app = express();

  // Attach Telegraf webhook middleware
  app.use(bot.webhookCallback(WEBHOOK_PATH));

  // Health endpoints
  app.get("/", (_, res) => res.status(200).send("OK"));
  app.get("/healthz", (_, res) => res.status(200).send("OK"));
  app.get("/ready", (_, res) => res.status(200).send("READY"));
  app.get("/health", (_, res) => res.json({ status: "OK", uptime: process.uptime() }));

  app.listen(PORT, "0.0.0.0", async () => {
    console.log(`[INFO] - Server listening on port ${PORT}`);

    try {
      await bot.telegram.setWebhook(webhookUrl, {
        drop_pending_updates: true
      });
      console.log("[INFO] - Webhook set successfully");
    } catch (err: any) {
      console.error("[ERROR] - Failed to set webhook:", err.message);
    }
  });
} else {
  // For local development, use long polling
  console.log("[INFO] - Using long polling (local development)");
  bot.launch();
}

/* ---------------- GLOBAL ERROR HANDLING ---------------- */
// Use Telegraf's built-in error handling via middleware

/* ---------------- PERIODIC CLEANUP ---------------- */
// Clean up stale data from Maps to prevent memory leaks
function cleanupStaleData() {
  try {
    // Clean up rate limit map (remove entries older than 1 minute)
    const now = Date.now();
    const RATE_LIMIT_CLEANUP_THRESHOLD = 60000; // 1 minute
    
    for (const [userId, timestamp] of bot.rateLimitMap) {
      if (now - timestamp > RATE_LIMIT_CLEANUP_THRESHOLD) {
        bot.rateLimitMap.delete(userId);
      }
    }
    
    // Log cleanup stats
    console.log(`[CLEANUP] - Rate limit map size: ${bot.rateLimitMap.size}, Running chats: ${bot.runningChats.length}, Waiting queue: ${bot.waitingQueue.length}`);
  } catch (error) {
    console.error("[CLEANUP] - Error during cleanup:", error);
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupStaleData, 300000);

process.on("unhandledRejection", (reason, promise) => {
  console.error("[UNHANDLED REJECTION] -", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[UNCAUGHT EXCEPTION] -", error.message);
  // Don't exit - let the process continue handling requests
});

process.once("SIGINT", async () => {
  console.log("[INFO] - Stopping bot (SIGINT)...");
  try {
    // In webhook mode, delete the webhook; in polling mode, stop the bot
    if (process.env.NODE_ENV === "production") {
      await bot.telegram.deleteWebhook();
      console.log("[INFO] - Webhook deleted");
    } else if (bot.botInfo) {
      await bot.stop("SIGINT");
    }
  } catch (error) {
    console.log("[INFO] - Bot stop skipped:", (error as Error).message);
  }
  // Close database connection
  try {
    await closeDatabase();
  } catch (error) {
    // Ignore close errors
  }
  process.exit(0);
});

process.once("SIGTERM", async () => {
  console.log("[INFO] - Stopping bot (SIGTERM)...");
  try {
    // In webhook mode, delete the webhook; in polling mode, stop the bot
    if (process.env.NODE_ENV === "production") {
      await bot.telegram.deleteWebhook();
      console.log("[INFO] - Webhook deleted");
    } else if (bot.botInfo) {
      await bot.stop("SIGTERM");
    }
  } catch (error) {
    console.log("[INFO] - Bot stop skipped:", (error as Error).message);
  }
  // Close database connection
  try {
    await closeDatabase();
  } catch (error) {
    // Ignore close errors
  }
  process.exit(0);
});
