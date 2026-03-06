import 'dotenv/config';
import express, { Request, Response } from 'express';
import { Context, Telegraf } from "telegraf";
import http from 'http';

// validate required environment settings early to fail fast
const requiredEnv = ["BOT_TOKEN", "ADMIN_IDS", "GROUP_CHAT_ID"];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`[FATAL] Missing environment variable ${key}`);
    process.exit(1);
  }
}

// Optional MongoDB URI
if (!process.env.MONGODB_URI) {
  console.warn("[WARN] MONGODB_URI not set; running in JSON fallback mode only. This may degrade performance and reliability.");
}


import { 
  setGender,
  getGender,
  getUser,
  banUser,
  isBanned,
  getAllUsers,
  updateUser,
  closeDatabase,
  getTotalChats,
  incrementTotalChats,
  deleteUser,
  resetDailyCounts
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
  waitingQueue: { id: number; preference: string; gender: string; isPremium: boolean }[] = [];
  
  // Running chats: Map<userId, partnerId> - much more efficient than array
  runningChats: Map<number, number> = new Map();

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
  matchMutex = new Mutex(); // Dedicated mutex for matchmaking operations

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
    // O(1) lookup using Map - much faster than array indexOf
    return this.runningChats.get(id) || null;
  }

  // Add a user to running chats
  addToChat(userId: number, partnerId: number): void {
    this.runningChats.set(userId, partnerId);
    this.runningChats.set(partnerId, userId);
  }

  // Remove a user from running chats (and their partner)
  removeFromChat(userId: number): number | null {
    const partnerId = this.runningChats.get(userId) || null;
    if (partnerId) {
      this.runningChats.delete(userId);
      this.runningChats.delete(partnerId);
    }
    return partnerId;
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

// Global catch handler for callback query errors and timeouts
bot.catch((err: any, ctx) => {
    const errorMessage = err?.message || String(err);
    
    // Check if it's a timeout error
    if (errorMessage.includes("timeout") || errorMessage.includes("Timeout")) {
        console.error("[Global bot error] - TimeoutError:", errorMessage);
    } else {
        console.error("[Global bot error]:", err);
    }
    
    // Always try to answer callback query to prevent UI freeze
    if (ctx.callbackQuery) {
        ctx.answerCbQuery().catch(() => {});
    }
});

// process-wide error handlers to avoid silent crashes
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', err => {
  console.error('[FATAL] Uncaught Exception:', err);
  // optionally exit or restart
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

/* ---------------- GENDER COMMAND (Premium Only) ---------------- */

bot.command("setgender", async (ctx) => {
  const user = await getUser(ctx.from.id);
  
  // Only allow premium users to change their gender
  if (!user.premium) {
    return ctx.reply("🔒 This feature is only available for Premium users.\n\nUpgrade to Premium to set your gender preference!");
  }
  
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
  ctx.reply(`Active chats: ${bot.runningChats.size / 2}`);
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
💭 <b>Active Chats:</b> ${bot.runningChats.size / 2}
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
if (process.env.RENDER_EXTERNAL_HOSTNAME || process.env.WEBHOOK_URL) {
  const domain = process.env.WEBHOOK_URL || `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`;
  const webhookUrl = `${domain}${WEBHOOK_PATH}`;
  
  console.log(`[INFO] - Setting webhook to: ${webhookUrl}`);
  
  // Start HTTP server for webhooks
  const app = express();
  
  // Use Telegraf's built-in webhook callback (handles parsing correctly)
  app.use(bot.webhookCallback(WEBHOOK_PATH));
  
  // Health check endpoint - simplified version that doesn't make API calls
  app.get("/health", (req: Request, res: Response) => {
    res.json({ 
      status: "OK", 
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
  });

  // Health check endpoints for Render - MUST return status 200
  app.get("/healthz", (req: Request, res: Response) => {
    res.status(200).send("OK");
  });

  app.get("/ready", (req: Request, res: Response) => {
    res.status(200).send("READY");
  });

  // ROOT endpoint - Render's health check hits this
  app.get("/", (req: Request, res: Response) => {
    res.status(200).send("OK");
  });

  // Start the server
  const server = app.listen(PORT, "0.0.0.0", async () => {
    console.log(`[INFO] - Server listening on port ${PORT}`);
    console.log(`[INFO] - Health check endpoints active`);
    
    // Set webhook AFTER server is listening
    try {
      await bot.telegram.setWebhook(webhookUrl);
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
    console.log(`[CLEANUP] - Rate limit map size: ${bot.rateLimitMap.size}, Running chats: ${bot.runningChats.size}, Waiting queue: ${bot.waitingQueue.length}`);
  } catch (error) {
    console.error("[CLEANUP] - Error during cleanup:", error);
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupStaleData, 300000);

/* ---------------- HOURLY RATE LIMIT & COOLDOWN MAP CLEANUP ---------------- */
// Prevent memory growth in rate limit and action cooldown maps by clearing them hourly
setInterval(() => {
  const sizeBefore = bot.rateLimitMap.size;
  bot.rateLimitMap.clear();
  const actionSize = bot.actionCooldownMap.size;
  bot.actionCooldownMap.clear();
  console.log(`[CLEANUP] - Rate limit map cleared (was ${sizeBefore} entries); action cooldown map cleared (was ${actionSize} entries)`);
}, 3600000); // every hour

/* ---------------- QUEUE SIZE PROTECTION ---------------- */
// Ensure queue doesn't grow indefinitely - remove oldest entries if too large
function enforceQueueSizeLimit(): void {
  const MAX_QUEUE_SIZE = 10000;
  
  if (bot.waitingQueue.length > MAX_QUEUE_SIZE) {
    // keep only the last MAX_QUEUE_SIZE entries
    bot.waitingQueue = bot.waitingQueue.slice(-MAX_QUEUE_SIZE);
  }
  
  if (bot.waitingQueue.length > MAX_QUEUE_SIZE * 0.8) {
    console.log(`[WARN] - Queue size is at ${bot.waitingQueue.length}/${MAX_QUEUE_SIZE}`);
  }
}

// Run queue size check every minute
setInterval(enforceQueueSizeLimit, 60000);

/* ---------------- QUEUE MATCHING SAFETY ---------------- */
// Ensure users in active chats are not in the waiting queue
function filterQueueUsersInChats(): void {
  const initialLength = bot.waitingQueue.length;
  
  bot.waitingQueue = bot.waitingQueue.filter(user => {
    // Remove users who are already in an active chat
    return !bot.runningChats.has(user.id);
  });
  
  const removed = initialLength - bot.waitingQueue.length;
  if (removed > 0) {
    console.log(`[CLEANUP] - Removed ${removed} users from queue who were in active chats`);
  }
  
  // Also clear waiting if that user is in an active chat
}

// Run queue safety filter every 30 seconds
setInterval(filterQueueUsersInChats, 30000);

/* ---------------- DAILY RESET ---------------- */
// Reset daily chat counts at midnight
function scheduleDailyReset() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  
  const msUntilMidnight = tomorrow.getTime() - now.getTime();
  
  console.log(`[DAILY] - Daily reset scheduled in ${Math.round(msUntilMidnight / 1000 / 60)} minutes`);
  
  setTimeout(async () => {
    try {
      const count = await resetDailyCounts();
      console.log(`[DAILY] - Daily chat counts reset for ${count} users`);
    } catch (error) {
      console.error("[DAILY] - Error resetting daily counts:", error);
    }
    
    // Schedule next reset (every 24 hours)
    setInterval(async () => {
      try {
        const count = await resetDailyCounts();
        console.log(`[DAILY] - Daily chat counts reset for ${count} users`);
      } catch (error) {
        console.error("[DAILY] - Error resetting daily counts:", error);
      }
    }, 24 * 60 * 60 * 1000); // 24 hours
  }, msUntilMidnight);
}

// Start the daily reset scheduler
scheduleDailyReset();

/* ---------------- BOT RESTART RECOVERY ---------------- */
console.log("Bot restarted. Active chats cleared.");

// Clear any stale data on startup
bot.runningChats.clear();
bot.waitingQueue = [];
bot.messageMap.clear();
bot.messageCountMap.clear();

console.log("[INFO] - Bot startup complete. All state cleared.");

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
    if (process.env.RENDER_EXTERNAL_HOSTNAME || process.env.WEBHOOK_URL) {
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
    if (process.env.RENDER_EXTERNAL_HOSTNAME || process.env.WEBHOOK_URL) {
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
