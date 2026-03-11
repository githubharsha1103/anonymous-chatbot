/**
 * Anonymous Chat Bot - Main Entry Point
 * 
 * This is the main entry point for the Telegram bot.
 * The code has been refactored into modular components for better maintainability.
 */

import 'dotenv/config';
import { Context, Telegraf } from "telegraf";

// ==================== ENVIRONMENT VALIDATION ====================
import { validateEnvironment, isProduction } from './Utils/envValidator';

// Validate environment on startup
validateEnvironment();

// ==================== DATABASE ====================
import { 
  setGender,
  getUser,
  isBanned,
  getTotalChats,
  incrementTotalChats
} from "./storage/db";

// ==================== PAYMENT HELPERS ====================
import { isPremium } from "./Utils/starsPayments";

// ==================== ERROR HANDLING ====================
// Error handlers are now in telegramErrorHandler module

/* ---------------- BOT CLASS ---------------- */

// Enhanced mutex with timeout support
class Mutex {
  private locked = false;
  private queue: { resolve: () => void; reject: (err: Error) => void }[] = [];
  private timeout: number;

  constructor(timeoutMs: number = 10000) {
    this.timeout = timeoutMs;
  }

  async acquire(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.locked) {
        this.locked = true;
        resolve();
      } else {
        const timeoutId = setTimeout(() => {
          const idx = this.queue.findIndex(q => q.resolve === resolve);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
          }
          reject(new Error('Mutex acquisition timeout'));
        }, this.timeout);
        
        this.queue.push({
          resolve: () => {
            clearTimeout(timeoutId);
            resolve();
          },
          reject: (err) => {
            clearTimeout(timeoutId);
            reject(err);
          }
        });
      }
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) next.resolve();
    } else {
      this.locked = false;
    }
  }

  forceRelease(): void {
    this.queue = [];
    this.locked = false;
  }

  isLocked(): boolean {
    return this.locked;
  }

  getQueueLength(): number {
    return this.queue.length;
  }
}

export class ExtraTelegraf extends Telegraf<Context> {
  waitingQueue: { id: number; preference: string; gender: string; isPremium: boolean; blockedUsers?: number[] }[] = [];
  // Premium users queue - gets priority matching
  premiumQueue: { id: number; preference: string; gender: string; isPremium: boolean; blockedUsers?: number[] }[] = [];
  // Set for O(1) queue membership checks
  queueSet: Set<number> = new Set();
  premiumQueueSet: Set<number> = new Set();
  // Premium user set for O(1) lookups
  premiumUsers: Set<number> = new Set();
  // Message queue for rate-limited sending
  private _messageQueue: Array<{ userId: number; text: string; extra?: unknown }> = [];
  private _isProcessingQueue = false;
  private readonly MESSAGE_DELAY_MS = 40; // 40ms between messages = 25 msg/sec
  
  runningChats: Map<number, number> = new Map();
  messageMap: Map<number, { [key: number]: number }> = new Map();
  messageCountMap: Map<number, number> = new Map();
  totalChats: number = 0;
  totalUsers: number = 0;
  spectatingChats: Map<number, { user1: number; user2: number }> = new Map();
  rateLimitMap: Map<number, number> = new Map();
  actionCooldownMap: Map<number, Map<string, number>> = new Map();
  
  ACTION_COOLDOWN = 1000;
  MAX_QUEUE_SIZE = 10000;
  MAX_PREMIUM_QUEUE_SIZE = 5000;
  RATE_LIMIT_WINDOW = 1000;

  chatMutex = new Mutex();
  queueMutex = new Mutex();
  matchMutex = new Mutex();
  
  async withChatStateLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.chatMutex.acquire();
    try {
      return await fn();
    } finally {
      this.chatMutex.release();
    }
  }

  // Action cooldown methods
  isActionOnCooldown(userId: number, action: string): boolean {
    const userCooldowns = this.actionCooldownMap.get(userId);
    if (!userCooldowns) return false;
    
    const lastActionTime = userCooldowns.get(action);
    if (!lastActionTime) return false;
    
    return (Date.now() - lastActionTime) < this.ACTION_COOLDOWN;
  }
  
  setActionCooldown(userId: number, action: string): void {
    let userCooldowns = this.actionCooldownMap.get(userId);
    if (!userCooldowns) {
      userCooldowns = new Map();
      this.actionCooldownMap.set(userId, userCooldowns);
    }
    userCooldowns.set(action, Date.now());
    this.cleanupActionCooldowns();
  }

  private cleanupActionCooldowns(): void {
    const now = Date.now();
    const COOLDOWN_MAX_AGE = 60000;
    const MAX_MAP_SIZE = 500;
    
    for (const [uid, cooldowns] of this.actionCooldownMap) {
      let hasRecent = false;
      for (const [act, time] of cooldowns) {
        if (now - time < COOLDOWN_MAX_AGE) {
          hasRecent = true;
        } else {
          cooldowns.delete(act);
        }
      }
      if (!hasRecent || cooldowns.size === 0) {
        this.actionCooldownMap.delete(uid);
      }
    }
    
    if (this.actionCooldownMap.size > MAX_MAP_SIZE) {
      const entries = Array.from(this.actionCooldownMap.entries());
      const toRemove = entries.slice(0, entries.length - MAX_MAP_SIZE);
      for (const [uid] of toRemove) {
        this.actionCooldownMap.delete(uid);
      }
    }
  }

  getPartner(id: number): number | null {
    return this.runningChats.get(id) || null;
  }

  addToChat(userId: number, partnerId: number): void {
    this.runningChats.set(userId, partnerId);
    this.runningChats.set(partnerId, userId);
  }

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
    incrementTotalChats().catch(err => console.error("[ERROR] - Failed to persist chat count:", err));
  }

  incrementUserCount() {
    this.totalUsers++;
  }

  isUserInSpectatorChat(userId: number): boolean {
    for (const [, chat] of this.spectatingChats) {
      if (chat.user1 === userId || chat.user2 === userId) {
        return true;
      }
    }
    return false;
  }

  getSpectatorChatForUser(userId: number): { adminId: number; chat: { user1: number; user2: number } } | null {
    for (const [adminId, chat] of this.spectatingChats) {
      if (chat.user1 === userId || chat.user2 === userId) {
        return { adminId, chat };
      }
    }
    return null;
  }

  isRateLimited(userId: number): boolean {
    const now = Date.now();
    const lastCommand = this.rateLimitMap.get(userId);
    if (lastCommand && (now - lastCommand) < this.RATE_LIMIT_WINDOW) {
      return true;
    }
    this.rateLimitMap.set(userId, now);
    return false;
  }

  isQueueFull(): boolean {
    return this.queueSet.size >= this.MAX_QUEUE_SIZE;
  }

  // Check if user is in queue (O(1) using Set)
  isInQueue(userId: number): boolean {
    return this.queueSet.has(userId);
  }

  // Atomic queue operations - all protected by queueMutex
  // These methods handle queueSet internally for O(1) lookups
  addToQueueAtomic(user: { id: number; preference: string; gender: string; isPremium: boolean; blockedUsers?: number[] }): boolean {
    // O(1) check using Set - much faster than array.some()
    if (this.runningChats.has(user.id)) return false;
    if (this.queueSet.has(user.id)) return false;
    if (this.isQueueFull()) return false;
    
    this.waitingQueue.push(user);
    this.queueSet.add(user.id); // O(1) insertion
    return true;
  }

  // Match from queue - call within mutex lock for thread safety
  matchFromQueue(userId: number, matchData: { id: number; preference: string; gender: string; isPremium: boolean; blockedUsers?: number[] }): { matched: boolean; partnerId: number | null } {
    const matchIndex = this.waitingQueue.findIndex(w => {
      // Use Set for O(1) existence check first
      if (!this.queueSet.has(w.id)) return false;
      
      const waitingGender = w.gender || "any";
      const waitingPref = w.preference || "any";
      const waitingBlocked = w.blockedUsers || [];
      const currentBlocked = matchData.blockedUsers || [];
      const matchPreference = (matchData.isPremium && matchData.preference !== "any") ? matchData.preference : null;
      
      const genderMatches = !matchPreference || waitingGender === matchPreference;
      const preferenceMatches = waitingPref === "any" || waitingPref === matchData.gender;
      
      const notBlocked = !currentBlocked.includes(w.id) && !waitingBlocked.includes(userId);
      return genderMatches && preferenceMatches && notBlocked;
    });
    
    if (matchIndex === -1) {
      return { matched: false, partnerId: null };
    }
    
    const match = this.waitingQueue.splice(matchIndex, 1)[0];
    this.queueSet.delete(match.id); // O(1) removal
    
    this.runningChats.set(match.id, userId);
    this.runningChats.set(userId, match.id);
    
    return { matched: true, partnerId: match.id };
  }

  // Remove from queue - call within mutex lock for thread safety
  removeFromQueue(userId: number): boolean {
    // O(1) check using Set first
    if (!this.queueSet.has(userId)) return false;
    
    const idx = this.waitingQueue.findIndex(w => w.id === userId);
    if (idx === -1) {
      // Fix inconsistency - user in Set but not in array
      this.queueSet.delete(userId);
      return false;
    }
    
    this.waitingQueue.splice(idx, 1);
    this.queueSet.delete(userId); // O(1) removal
    return true;
  }
  
  // Clear queue set - for cleanup purposes
  clearQueueSet(): void {
    this.queueSet.clear();
    this.premiumQueueSet.clear();
    this.premiumUsers.clear();
  }

  // Add user to premium tracking
  addPremiumUser(userId: number): void {
    this.premiumUsers.add(userId);
  }

  // Remove user from premium tracking
  removePremiumUser(userId: number): void {
    this.premiumUsers.delete(userId);
  }

  // Check if user is premium
  isPremiumUser(userId: number): boolean {
    return this.premiumUsers.has(userId);
  }

  // Add to premium queue
  addToPremiumQueue(user: { id: number; preference: string; gender: string; isPremium: boolean; blockedUsers?: number[] }): boolean {
    if (this.premiumQueueSet.has(user.id)) return false;
    if (this.premiumQueue.length >= this.MAX_PREMIUM_QUEUE_SIZE) return false;
    
    this.premiumQueue.push({ ...user, isPremium: true });
    this.premiumQueueSet.add(user.id);
    this.premiumUsers.add(user.id);
    return true;
  }

  // Remove from premium queue
  removeFromPremiumQueue(userId: number): boolean {
    const idx = this.premiumQueue.findIndex(w => w.id === userId);
    if (idx === -1) return false;
    
    this.premiumQueue.splice(idx, 1);
    this.premiumQueueSet.delete(userId);
    return true;
  }

  // ==================== Message Queue for Rate Limiting ====================
  
  // Queue a message to be sent with rate limiting
  queueMessage(userId: number, text: string, extra?: unknown): void {
    this._messageQueue.push({ userId, text, extra });
    
    // Start processing if not already
    if (!this._isProcessingQueue) {
      this._processMessageQueue();
    }
  }

  private async _processMessageQueue(): Promise<void> {
    if (this._isProcessingQueue) return;
    
    this._isProcessingQueue = true;
    
    while (this._messageQueue.length > 0) {
      const item = this._messageQueue.shift();
      if (!item) continue;
      
      try {
        await this.telegram.sendMessage(item.userId, item.text, item.extra as any);
      } catch (error) {
        console.error("[ERROR] Message queue send error:", error);
      }
      
      // Rate limiting delay
      await new Promise(resolve => setTimeout(resolve, this.MESSAGE_DELAY_MS));
    }
    
    this._isProcessingQueue = false;
  }

  // ==================== Stale Queue Cleanup ====================
  
  // Remove users from queues who have been waiting too long or have inconsistencies
  cleanupStaleQueueUsers(): number {
    let removed = 0;
    
    // Sync queue states to ensure consistency - removes users in running chats
    this.syncQueueState();
    
    // Also sync premium queue
    const seenPremium = new Set<number>();
    const normalizedPremiumQueue = this.premiumQueue.filter(u => {
      if (!u || seenPremium.has(u.id) || this.runningChats.has(u.id)) {
        removed++;
        return false;
      }
      seenPremium.add(u.id);
      return true;
    });
    
    if (removed > 0) {
      this.premiumQueue = normalizedPremiumQueue;
      this.premiumQueueSet = seenPremium;
    }
    
    return removed;
  }

  syncQueueState(): void {
    const seen = new Set<number>();
    const normalizedQueue: { id: number; preference: string; gender: string; isPremium: boolean; blockedUsers?: number[] }[] = [];

    for (const queuedUser of this.waitingQueue) {
      if (!queuedUser || seen.has(queuedUser.id) || this.runningChats.has(queuedUser.id)) {
        continue;
      }

      seen.add(queuedUser.id);
      normalizedQueue.push(queuedUser);
    }

    this.waitingQueue = normalizedQueue;
    this.queueSet = seen;
  }

  trimWaitingQueue(maxSize: number): number {
    if (this.waitingQueue.length <= maxSize) {
      return 0;
    }

    const removeCount = this.waitingQueue.length - maxSize;
    this.waitingQueue = this.waitingQueue.slice(removeCount);
    this.syncQueueState();
    return removeCount;
  }
}

export const bot = new ExtraTelegraf(process.env.BOT_TOKEN!);

// Global catch handler
bot.catch(async (err: unknown, ctx) => {
  const errorMessage = err instanceof Error ? err.message : String(err);

  if (errorMessage.includes("timeout") || errorMessage.includes("Timeout")) {
    console.error("[Global bot error] - TimeoutError:", errorMessage);
  } else {
    console.error("[Global bot error]:", err);
  }
  
  if (ctx.callbackQuery) {
    try {
      await ctx.answerCbQuery("An error occurred. Please try again.");
    } catch (answerErr) {
      console.error("[Callback Query Answer Error]:", answerErr);
    }
  }
});

// Process-wide error handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', err => {
  console.error('[FATAL] Uncaught Exception:', err);
  console.log('[FATAL] Shutting down due to uncaught exception...');
  process.exit(1);
});

// Global middleware with error handling
bot.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    const userId = ctx.from?.id;
    console.error(`[MIDDLEWARE ERROR] - User ${userId}:`, err);
  }
});

/* ---------------- LOADERS ---------------- */
import { loadCommands } from "./Utils/commandHandler";
import { loadEvents } from "./Utils/eventHandler";
import { loadActions } from "./Utils/actionHandler";

loadCommands();
loadEvents();
loadActions();

/* ---------------- ADMIN PANEL ---------------- */
import { initAdminActions } from "./Commands/adminaccess";
initAdminActions(bot);

/* ---------------- RE-ENGAGEMENT ---------------- */
import { initReengagementActions } from "./Commands/reengagement";
initReengagementActions(bot);

/* ---------------- STARS PAYMENTS ---------------- */
import { initStarsPaymentHandlers } from "./Utils/starsPayments";
initStarsPaymentHandlers(bot);

/* ---------------- REFERRAL SYSTEM ---------------- */
import referral from "./Commands/referral";
referral.initActions(bot);

/* ---------------- ADMIN COMMANDS (Modular) ---------------- */
import { registerAdminCommands } from "./server/adminCommands";
registerAdminCommands(bot);

/* ---------------- ADMIN CHECK ---------------- */
// Admin check is now handled in adminCommands.ts

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
  const user = await getUser(ctx.from.id);
  
  // Use isPremium function to check both premium flag AND expiry
  if (!isPremium(user)) {
    return ctx.reply("🔒 This feature is only available for Premium users.\n\nUpgrade to Premium to set your gender preference!");
  }
  
  const g = ctx.message.text.split(" ")[1]?.toLowerCase();
  if (!g || !["male", "female"].includes(g)) {
    return ctx.reply("💕 Use: /setgender male OR /setgender female");
  }
  await setGender(ctx.from.id, g);
  ctx.reply(`Gender set to ${g}`);
});

/* ---------------- STARTUP ---------------- */
console.log("[INFO] - Bot is online");

// Load statistics
getTotalChats().then(chats => {
  bot.totalChats = chats;
  console.log(`[INFO] - Loaded ${chats} total chats from database`);
}).catch(err => {
  console.error("[ERROR] - Failed to load statistics:", err);
});

/* ---------------- SERVER STARTUP ---------------- */
import { createWebServer, startWebServer } from "./server/webServer";

const PORT = parseInt(process.env.PORT || "3000", 10);

// Check deployment mode
if (isProduction()) {
  // Production: Use webhooks
  const app = createWebServer(bot);
  startWebServer(app, bot, PORT);
} else {
  // Development: Use long polling
  console.log("[INFO] - Using long polling (local development)");
  bot.launch();
}

/* ---------------- CLEANUP TASKS (Modular) ---------------- */
import { registerCleanupTasks, setupGracefulShutdown } from "./server/cleanup";

registerCleanupTasks(bot);
setupGracefulShutdown(bot);

// Clear state on startup
bot.runningChats.clear();
bot.waitingQueue = [];
bot.messageMap.clear();
bot.messageCountMap.clear();

console.log("[INFO] - Bot startup complete. All state cleared.");
