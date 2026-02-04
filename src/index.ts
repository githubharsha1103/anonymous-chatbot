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
  incrementTotalChats
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

  // Rate limit window in milliseconds (5 seconds)
  RATE_LIMIT_WINDOW = 5000;

  getPartner(id: number) {
    const index = this.runningChats.indexOf(id);
    if (index % 2 === 0) return this.runningChats[index + 1];
    return this.runningChats[index - 1];
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

import { initAdminActions } from "./Commands/adminaccess.js";
initAdminActions(bot);

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
  const { success, failed } = await broadcastWithRateLimit(bot, userIds, msg);

  ctx.reply(`Broadcast completed!\n✅ Sent: ${success}\n❌ Failed: ${failed}`);
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
📊 *Bot Statistics*

👥 *Total Users:* ${allUsers.length}
💬 *Total Chats:* ${totalChats}
💭 *Active Chats:* ${bot.runningChats.length / 2}
⏳ *Users Waiting:* ${bot.waitingQueue.length}
`;
  
  ctx.reply(stats, { parse_mode: "Markdown" });
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
    // Handle Telegram update
    bot.handleUpdate(req.body).then(() => {
      res.sendStatus(200);
    }).catch((err: Error) => {
      console.error("[ERROR] - Failed to handle update:", err.message);
      res.sendStatus(500);
    });
  });
  
  // Health check endpoint
  app.get("/health", (req: Request, res: Response) => {
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

process.once("SIGINT", async () => {
  console.log("[INFO] - Stopping bot (SIGINT)...");
  try {
    if (bot.botInfo) {
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
    if (bot.botInfo) {
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
