import 'dotenv/config';
import express, { Request, Response } from 'express';
import { Context, Telegraf } from "telegraf";

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
  
  // Mutexes for race condition prevention
  chatMutex = new Mutex();
  queueMutex = new Mutex();

  // Maximum queue size
  MAX_QUEUE_SIZE = 10000;

  // Rate limit window in milliseconds (1 second - faster for real-time chat)
  RATE_LIMIT_WINDOW = 1000;

  getPartner(id: number): number | null {
    const index = this.runningChats.indexOf(id);
    if (index === -1) return null; // User not in any chat
    
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

import { initReferralActions } from "./Commands/referral";
initReferralActions(bot);

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
if (process.env.RENDER_EXTERNAL_HOSTNAME || process.env.WEBHOOK_URL) {
  const domain = process.env.WEBHOOK_URL || `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`;
  const webhookUrl = `${domain}${WEBHOOK_PATH}`;
  
  console.log(`[INFO] - Setting webhook to: ${webhookUrl}`);
  
  // Set webhook
  bot.telegram.setWebhook(webhookUrl).then(() => {
    console.log("[INFO] - Webhook set successfully");
  }).catch((err: Error) => {
    console.error("[ERROR] - Failed to set webhook:", err.message);
  });
  
  // Start HTTP server for webhooks
  const app = express();
  
  // Use express.json() middleware for parsing Telegram updates
  app.use(express.json());
  
  // Webhook endpoint
  app.post(WEBHOOK_PATH, (req: Request, res: Response) => {
    // Log that we received an update
    const updateType = req.body.callback_query ? "callback_query" : req.body.message ? "message" : req.body.inline_query ? "inline_query" : "other";
    console.log("[WEBHOOK] - Received update:", updateType, "from user:", req.body.callback_query?.from?.id || req.body.message?.from?.id);
    
    // Handle Telegram update
    bot.handleUpdate(req.body).then(() => {
      console.log("[WEBHOOK] - Update processed successfully");
      res.sendStatus(200);
    }).catch((err: Error) => {
      // Log but don't crash on network errors to Telegram API
      const errMsg = err?.message || 'Unknown error';
      console.error("[ERROR] - Failed to handle update:", errMsg, err);
      res.sendStatus(200); // Always return 200 to Telegram to prevent retries
    });
  });
  
  // Health check endpoint
  app.get("/health", (req: Request, res: Response) => {
    // Check if bot is responding
    bot.telegram.getMe().then(botInfo => {
      res.json({ 
        status: "OK", 
        bot: botInfo.username,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      });
    }).catch(err => {
      res.status(503).json({ 
        status: "ERROR", 
        error: err.message,
        timestamp: new Date().toISOString()
      });
    });
  });
  
  // Enhanced health check for Render/hosting platforms
  app.get("/healthz", (req: Request, res: Response) => {
    res.send("OK");
  });
  
  // Ready endpoint - returns 200 when ready
  app.get("/ready", (req: Request, res: Response) => {
    res.send("READY");
  });
  
  // Root endpoint for Render health checks
  app.get("/", (req: Request, res: Response) => {
    res.send("OK");
  });
  
  // Start the server
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[INFO] - Server listening on port ${PORT}`);
  });
} else {
  // For local development, use long polling
  console.log("[INFO] - Using long polling (local development)");
  bot.launch();
}

// Keep-alive mechanism to prevent bot from stopping due to inactivity
// This periodically sends a message to admin to keep the bot active
const KEEPALIVE_INTERVAL = parseInt(process.env.KEEPALIVE_INTERVAL || "720000", 10); // 12 minutes default
const ADMIN_ID = process.env.ADMIN_IDS?.split(",")[0]?.replace("@", "") || "";

if (KEEPALIVE_INTERVAL > 0 && ADMIN_ID) {
  console.log(`[INFO] - Starting keep-alive ping every ${KEEPALIVE_INTERVAL / 1000 / 60} minutes to admin`);
  
  setInterval(async () => {
    try {
      // Send a message to admin to keep the bot active
      const adminId = parseInt(ADMIN_ID.replace(/\D/g, ""), 10);
      if (!isNaN(adminId)) {
        await bot.telegram.sendMessage(adminId, `✅ Bot is alive!\n⏰ Keepalive ping at: ${new Date().toLocaleTimeString()}`);
        console.log("[KEEPALIVE] - Sent keepalive message to admin");
      }
    } catch (error) {
      console.error("[KEEPALIVE] - Error:", error);
    }
  }, KEEPALIVE_INTERVAL);
} else {
  console.log("[WARN] - Keepalive disabled: ADMIN_IDS not set");
}

/* ---------------- SELF-PING KEEPALIVE FOR RENDER/HOSTING PLATFORMS ---------------- */
// This endpoint allows external services (like Render's health check or a cron job) to keep the bot alive
const SELF_PING_PORT = parseInt(process.env.SELF_PING_PORT || "3001", 10);

// Only start self-ping server if explicitly enabled
if (process.env.ENABLE_SELF_PING === "true") {
  import('express').then(({ default: express }) => {
    const pingApp = express();
    
    pingApp.get("/ping", (req: Request, res: Response) => {
      res.send("OK");
    });
    
    pingApp.listen(SELF_PING_PORT, "0.0.0.0", () => {
      console.log(`[INFO] - Self-ping server listening on port ${SELF_PING_PORT}`);
      console.log(`[INFO] - Add this URL to your external cron/ping service: http://your-app:${SELF_PING_PORT}/ping`);
    });
  }).catch(err => {
    console.error("[ERROR] - Failed to start self-ping server:", err);
  });
}

/* ---------------- AUTO-RESTART MECHANISM ---------------- */
// Monitors bot health and attempts to restart if stopped
let isBotRunning = false;
let restartAttempts = 0;
const MAX_RESTART_ATTEMPTS = 5;
const RESTART_DELAY = 10000; // 10 seconds between restart attempts

function checkBotHealth() {
  // Check if bot is supposed to be running but isn't
  const shouldBeRunning = !(process.env.RENDER_EXTERNAL_HOSTNAME || process.env.WEBHOOK_URL);
  
  if (shouldBeRunning && !isBotRunning && bot.botInfo) {
    console.log("[WARN] - Bot appears to have stopped, attempting restart...");
    if (restartAttempts < MAX_RESTART_ATTEMPTS) {
      restartAttempts++;
      try {
        bot.launch();
        isBotRunning = true;
        console.log(`[INFO] - Bot restarted successfully (attempt ${restartAttempts})`);
        restartAttempts = 0; // Reset on successful restart
      } catch (error) {
        console.error("[ERROR] - Failed to restart bot:", error);
        setTimeout(checkBotHealth, RESTART_DELAY);
      }
    } else {
      console.error("[ERROR] - Max restart attempts reached, giving up");
    }
  }
}

// Check bot health every minute
setInterval(checkBotHealth, 60000);

// Track when bot actually launches
bot.launch().then(() => {
  isBotRunning = true;
  console.log("[INFO] - Bot launched successfully");
}).catch((err: Error) => {
  console.error("[ERROR] - Failed to launch bot:", err.message);
});

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
