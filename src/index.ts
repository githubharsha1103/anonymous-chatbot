/**
 * Anonymous Chat Bot - Main Entry Point
 * 
 * This is the main entry point for the Telegram bot.
 * The code has been refactored into modular components for better maintainability.
 * 
 * REFACTORING SUMMARY (2024-03):
 * - Added internal mutex locking to all queue operations (addToQueueAtomic, matchFromQueue,
 *   removeFromQueue, addToPremiumQueue, removeFromPremiumQueue) to prevent race conditions
 *   when callers forget to use withChatStateLock. This makes the API thread-safe by default.
 * - Improved uncaughtException handler to call graceful shutdown before exiting, allowing
 *   DB connections to close properly and cleanup hooks to run.
 * - Enhanced flood control logging with structured telemetry for better observability.
 */

import 'dotenv/config';
import { Context, Telegraf } from "telegraf";
import { AsyncLocalStorage } from "async_hooks";

// Lock context interface for re-entrant mutex
interface ChatLockContext {
  token: symbol;
  depth: number;
}

// AsyncLocalStorage for tracking async execution context with depth
const chatLockStorage = new AsyncLocalStorage<ChatLockContext>();

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
  private readonly MAX_MESSAGE_QUEUE_SIZE = 5000;
  private readonly MESSAGE_RETRY_COUNT = 2;
  private readonly MESSAGE_RETRY_DELAY_MS = 1000;
  
  runningChats: Map<number, number> = new Map();
  messageMap: Map<number, { [key: number]: number }> = new Map();
  messageCountMap: Map<number, number> = new Map();
  totalChats: number = 0;
  totalUsers: number = 0;
  // Spectating: Map<sessionKey("user1_user2"), Set<adminId>> for multiple spectators
  spectatingChats: Map<string, Set<number>> = new Map();
  // Legacy: Map<adminId, { user1, user2 }> - kept for backward compatibility
  spectatingChatsLegacy: Map<number, { user1: number; user2: number }> = new Map();
  rateLimitMap: Map<number, number> = new Map();
  actionCooldownMap: Map<number, Map<string, number>> = new Map();
  
  ACTION_COOLDOWN = 1000;
  MAX_QUEUE_SIZE = 10000;
  MAX_PREMIUM_QUEUE_SIZE = 5000;
  RATE_LIMIT_WINDOW = 1000;

  chatMutex = new Mutex();
  queueMutex = new Mutex();
  matchMutex = new Mutex();

  // Re-entrant mutex using AsyncLocalStorage with context-based depth tracking
  // Depth is stored per async execution flow, not globally
  
  async withChatStateLock<T>(fn: () => Promise<T>): Promise<T> {
    const context = chatLockStorage.getStore();
    
    if (context) {
      // Nested call in same async flow - increment depth
      context.depth++;
      console.log(`[LOCK] nested lock detected (depth: ${context.depth})`);
      try {
        return await fn();
      } finally {
        context.depth--;
      }
    }

    // First call — acquire mutex
    console.log("[LOCK] acquiring chat lock");
    await this.chatMutex.acquire();

    const newContext: ChatLockContext = {
      token: Symbol("chatLock"),
      depth: 1
    };

    try {
      return await chatLockStorage.run(newContext, async () => {
        return await fn();
      });
    } finally {
      console.log("[LOCK] releasing chat lock");
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

  // Add to chat - NOW INTERNALLY PROTECTED BY chatMutex
  // Ensures thread-safe manipulation of runningChats Map
  async addToChat(userId: number, partnerId: number): Promise<void> {
    await this.chatMutex.acquire();
    try {
      this.runningChats.set(userId, partnerId);
      this.runningChats.set(partnerId, userId);
    } finally {
      this.chatMutex.release();
    }
  }

  // Remove from chat - NOW INTERNALLY PROTECTED BY chatMutex
  // Returns partner ID before removal, or null if not in chat
  async removeFromChat(userId: number): Promise<number | null> {
    await this.chatMutex.acquire();
    try {
      const partnerId = this.runningChats.get(userId) || null;
      if (partnerId) {
        this.runningChats.delete(userId);
        this.runningChats.delete(partnerId);
      }
      return partnerId;
    } finally {
      this.chatMutex.release();
    }
  }

  incrementChatCount() {
    this.totalChats++;
    incrementTotalChats().catch(err => console.error("[ERROR] - Failed to persist chat count:", err));
  }

  incrementUserCount() {
    this.totalUsers++;
  }

  // Generate session key from two user IDs (smaller ID first)
  private getSessionKey(user1: number, user2: number): string {
    return user1 < user2 ? `${user1}_${user2}` : `${user2}_${user1}`;
  }

  // Add admin to spectate a chat session
  addSpectator(adminId: number, user1: number, user2: number): void {
    // First, remove admin from any existing session to prevent duplicates
    this.removeSpectator(adminId);
    
    const sessionKey = this.getSessionKey(user1, user2);
    const [u1, u2] = sessionKey.split('_').map(Number);
    let spectators = this.spectatingChats.get(sessionKey);
    if (!spectators) {
      spectators = new Set();
      this.spectatingChats.set(sessionKey, spectators);
    }
    spectators.add(adminId);
    // Also update legacy map for backward compatibility - use same ordering as session key
    this.spectatingChatsLegacy.set(adminId, { user1: u1, user2: u2 });
  }

  // Remove admin from spectating
  removeSpectator(adminId: number): void {
    // Find and remove from the new map
    for (const [sessionKey, spectators] of this.spectatingChats) {
      if (spectators.has(adminId)) {
        spectators.delete(adminId);
        if (spectators.size === 0) {
          this.spectatingChats.delete(sessionKey);
        }
        break;
      }
    }
    // Remove from legacy map
    this.spectatingChatsLegacy.delete(adminId);
  }

  // Check if user is in any spectated chat
  isUserInSpectatorChat(userId: number): boolean {
    for (const [sessionKey] of this.spectatingChats) {
      const [u1, u2] = sessionKey.split('_').map(Number);
      if (u1 === userId || u2 === userId) {
        return true;
      }
    }
    return false;
  }

  // Get all spectators for a user (used for message forwarding)
  getSpectatorsForUser(userId: number): { adminId: number; chat: { user1: number; user2: number } }[] {
    const results: { adminId: number; chat: { user1: number; user2: number } }[] = [];
    for (const [sessionKey, spectators] of this.spectatingChats) {
      const [u1, u2] = sessionKey.split('_').map(Number);
      if (u1 === userId || u2 === userId) {
        for (const adminId of spectators) {
          results.push({ adminId, chat: { user1: u1, user2: u2 } });
        }
      }
    }
    return results;
  }

  // Legacy method for backward compatibility
  getSpectatorChatForUser(userId: number): { adminId: number; chat: { user1: number; user2: number } } | null {
    for (const [adminId, chat] of this.spectatingChatsLegacy) {
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

  // Atomic queue operations - NOW INTERNALLY PROTECTED BY queueMutex
  // These methods handle queueSet internally for O(1) lookups
  // Added internal locking to prevent race conditions even if callers forget to lock
  async addToQueueAtomic(user: { id: number; preference: string; gender: string; isPremium: boolean; blockedUsers?: number[] }): Promise<boolean> {
    await this.queueMutex.acquire();
    try {
      // O(1) check using Set - much faster than array.some()
      if (this.runningChats.has(user.id)) return false;
      
      // Route premium users to premium queue
      if (user.isPremium) {
        if (this.premiumQueueSet.has(user.id)) return false;
        if (this.premiumQueue.length >= this.MAX_PREMIUM_QUEUE_SIZE) return false;
        
        this.premiumQueue.push(user);
        this.premiumQueueSet.add(user.id); // O(1) insertion
        return true;
      }
      
      // Regular users go to waiting queue
      if (this.queueSet.has(user.id)) return false;
      if (this.isQueueFull()) return false;
      
      this.waitingQueue.push(user);
      this.queueSet.add(user.id); // O(1) insertion
      return true;
    } finally {
      this.queueMutex.release();
    }
  }

  // Match from queue - NOW INTERNALLY PROTECTED BY queueMutex
  // This ensures thread safety even if callers forget to use withChatStateLock
  // Priority matching:
  // 1. If premiumQueue.length >= 2: match premium users together
  // 2. If premiumQueue.length >= 1 && waitingQueue.length >= 1: match premium with normal
  // 3. Else: match normal users
  async matchFromQueue(userId: number, matchData: { id: number; preference: string; gender: string; isPremium: boolean; blockedUsers?: number[] }): Promise<{ matched: boolean; partnerId: number | null }> {
    await this.queueMutex.acquire();
    try {
      // Helper to check if two users match
      const usersMatch = (u1: { gender: string; preference: string; blockedUsers?: number[] }, u2Id: number, u2: { gender: string; preference: string; blockedUsers?: number[] }, u1Id: number): boolean => {
        const u1Gender = u1.gender || "any";
        const u1Pref = u1.preference || "any";
        const u2Gender = u2.gender || "any";
        const u2Pref = u2.preference || "any";
        const u1Blocked = u1.blockedUsers || [];
        const u2Blocked = u2.blockedUsers || [];
        
        const genderMatches = u1Pref === "any" || u1Pref === u2Gender;
        const preferenceMatches = u2Pref === "any" || u2Pref === u1Gender;
        const notBlocked = !u1Blocked.includes(u2Id) && !u2Blocked.includes(u1Id);
        
        return genderMatches && preferenceMatches && notBlocked;
      };
      
      // Priority 1: Match premium users together (premiumQueue >= 2)
      if (matchData.isPremium && this.premiumQueue.length >= 2) {
        const matchIndex = this.premiumQueue.findIndex(w => {
          if (!this.premiumQueueSet.has(w.id)) return false;
          if (w.id === userId) return false;
          return usersMatch(matchData, w.id, w, userId);
        });
        
        if (matchIndex !== -1) {
          const match = this.premiumQueue.splice(matchIndex, 1)[0];
          this.premiumQueueSet.delete(match.id);
          
          this.runningChats.set(match.id, userId);
          this.runningChats.set(userId, match.id);
          
          return { matched: true, partnerId: match.id };
        }
      }
      
      // Priority 2: Match premium with normal (premiumQueue >= 1 && waitingQueue >= 1)
      if (matchData.isPremium && this.premiumQueue.length >= 1) {
        const matchIndex = this.premiumQueue.findIndex(w => {
          if (!this.premiumQueueSet.has(w.id)) return false;
          return usersMatch(matchData, w.id, w, userId);
        });
        
        if (matchIndex !== -1) {
          const match = this.premiumQueue.splice(matchIndex, 1)[0];
          this.premiumQueueSet.delete(match.id);
          
          this.runningChats.set(match.id, userId);
          this.runningChats.set(userId, match.id);
          
          return { matched: true, partnerId: match.id };
        }
      }
      
      // Priority 3: If current user is premium but no match in premium queue, try normal queue
      if (matchData.isPremium && this.waitingQueue.length >= 1) {
        const matchIndex = this.waitingQueue.findIndex(w => {
          if (!this.queueSet.has(w.id)) return false;
          return usersMatch(matchData, w.id, w, userId);
        });
        
        if (matchIndex !== -1) {
          const match = this.waitingQueue.splice(matchIndex, 1)[0];
          this.queueSet.delete(match.id);
          
          this.runningChats.set(match.id, userId);
          this.runningChats.set(userId, match.id);
          
          return { matched: true, partnerId: match.id };
        }
      }
      
      // Priority 4: Match normal users (non-premium or couldn't match premium)
      const matchIndex = this.waitingQueue.findIndex(w => {
        if (!this.queueSet.has(w.id)) return false;
        if (w.id === userId) return false;
        return usersMatch(matchData, w.id, w, userId);
      });
      
      if (matchIndex === -1) {
        return { matched: false, partnerId: null };
      }
      
      const match = this.waitingQueue.splice(matchIndex, 1)[0];
      this.queueSet.delete(match.id);
      
      this.runningChats.set(match.id, userId);
      this.runningChats.set(userId, match.id);
      
      return { matched: true, partnerId: match.id };
    } finally {
      this.queueMutex.release();
    }
  }

  // Remove from queue - NOW INTERNALLY PROTECTED BY queueMutex
  // Ensures thread safety even if callers forget to use withChatStateLock
  async removeFromQueue(userId: number): Promise<boolean> {
    await this.queueMutex.acquire();
    try {
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
    } finally {
      this.queueMutex.release();
    }
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

  // Add to premium queue - NOW INTERNALLY PROTECTED BY queueMutex
  async addToPremiumQueue(user: { id: number; preference: string; gender: string; isPremium: boolean; blockedUsers?: number[] }): Promise<boolean> {
    await this.queueMutex.acquire();
    try {
      if (this.premiumQueueSet.has(user.id)) return false;
      if (this.premiumQueue.length >= this.MAX_PREMIUM_QUEUE_SIZE) return false;
      
      this.premiumQueue.push({ ...user, isPremium: true });
      this.premiumQueueSet.add(user.id);
      this.premiumUsers.add(user.id);
      return true;
    } finally {
      this.queueMutex.release();
    }
  }

  // Remove from premium queue - NOW INTERNALLY PROTECTED BY queueMutex
  async removeFromPremiumQueue(userId: number): Promise<boolean> {
    await this.queueMutex.acquire();
    try {
      const idx = this.premiumQueue.findIndex(w => w.id === userId);
      if (idx === -1) return false;
      
      this.premiumQueue.splice(idx, 1);
      this.premiumQueueSet.delete(userId);
      return true;
    } finally {
      this.queueMutex.release();
    }
  }

  // ==================== Message Queue for Rate Limiting ====================
  
  // Current message delay (can be increased during flood control)
  private _currentMessageDelayMs: number = 40;
  // Flag to track if we're in flood wait mode
  private _inFloodWait: boolean = false;
  // Timestamp when flood wait ends
  private _floodWaitUntil: number = 0;
  // Maximum delay during flood control (5 seconds)
  private readonly MAX_FLOOD_DELAY_MS = 5000;
  // Base delay
  private readonly BASE_MESSAGE_DELAY_MS = 40;
  // Flood wait duration when 429 error occurs (in ms)
  private readonly FLOOD_WAIT_DURATION_MS = 1000;
  
  // Queue a message to be sent with rate limiting
  queueMessage(userId: number, text: string, extra?: unknown): void {
    // Queue size protection - drop oldest if too many messages
    if (this._messageQueue.length > this.MAX_MESSAGE_QUEUE_SIZE) {
      this._messageQueue.shift(); // Drop oldest
      console.warn("[WARN] Message queue full, dropping oldest message");
    }
    
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
      
      // Check if we're in flood wait mode
      if (this._inFloodWait && Date.now() < this._floodWaitUntil) {
        const waitTime = this._floodWaitUntil - Date.now();
        await new Promise(resolve => setTimeout(resolve, Math.min(waitTime, 1000)));
        continue;
      }
      
      // Exit flood wait mode if time has passed
      if (this._inFloodWait && Date.now() >= this._floodWaitUntil) {
        this._inFloodWait = false;
        this._currentMessageDelayMs = this.BASE_MESSAGE_DELAY_MS;
        console.log("[INFO] Exited flood wait mode, restored message delay to base level");
      }
      
      // Try sending with retry logic
      let sent = false;
      for (let attempt = 0; attempt <= this.MESSAGE_RETRY_COUNT && !sent; attempt++) {
        try {
          await this.telegram.sendMessage(item.userId, item.text, item.extra as Parameters<ExtraTelegraf['telegram']['sendMessage']>[2]);
          sent = true;
        } catch (error) {
          // Check for flood control error (429)
          const errorMessage = error instanceof Error ? error.message : String(error);
          const isFloodError = errorMessage.includes("429") || 
                              errorMessage.toLowerCase().includes("too many requests") ||
                              errorMessage.includes("Flood control");
          
          if (isFloodError) {
            // Enter flood wait mode
            this._inFloodWait = true;
            this._floodWaitUntil = Date.now() + this.FLOOD_WAIT_DURATION_MS;
            
            // Increase delay temporarily (but cap at max)
            this._currentMessageDelayMs = Math.min(
              this._currentMessageDelayMs + 500,
              this.MAX_FLOOD_DELAY_MS
            );
            
            // Log the flood event
            console.log(JSON.stringify({
              type: "TELEGRAM_FLOOD_DETECTED",
              userId: item.userId,
              currentDelayMs: this._currentMessageDelayMs,
              floodWaitUntil: new Date(this._floodWaitUntil).toISOString(),
              timestamp: new Date().toISOString()
            }));
            
            // Retry immediately after flood wait
            continue;
          }
          
          if (attempt < this.MESSAGE_RETRY_COUNT) {
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, this.MESSAGE_RETRY_DELAY_MS));
          } else {
            console.error("[ERROR] Message queue send error after retries:", error);
          }
        }
      }
      
      // Rate limiting delay (using adaptive delay)
      await new Promise(resolve => setTimeout(resolve, this._currentMessageDelayMs));
    }
    
    this._isProcessingQueue = false;
  }

  // ==================== Stale Queue Cleanup ====================
  
  // Remove users from queues who have been waiting too long or have inconsistencies
  cleanupStaleQueueUsers(): number {
    let removed = 0;
    
    // Sync queue states to ensure consistency - removes users in running chats
    this.syncQueueState();
    
    // Also sync premium queue - remove users who are:
    // 1. No longer premium (not in premiumUsers Set)
    // 2. Already in running chats
    // 3. Duplicate entries
    const seenPremium = new Set<number>();
    const normalizedPremiumQueue = this.premiumQueue.filter(u => {
      if (!u) {
        removed++;
        return false;
      }
      
      // Remove duplicates
      if (seenPremium.has(u.id)) {
        removed++;
        return false;
      }
      
      // Remove users already in running chats
      if (this.runningChats.has(u.id)) {
        removed++;
        return false;
      }
      
      // Remove users who are no longer premium
      if (!this.premiumUsers.has(u.id)) {
        removed++;
        return false;
      }
      
      seenPremium.add(u.id);
      return true;
    });
    
    if (removed > 0 || normalizedPremiumQueue.length !== this.premiumQueue.length) {
      this.premiumQueue = normalizedPremiumQueue;
      // Rebuild premiumQueueSet to ensure synchronization
      this.premiumQueueSet.clear();
      for (const user of this.premiumQueue) {
        this.premiumQueueSet.add(user.id);
      }
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

// TEMPORARY DEBUG: Log bot token and get bot info
console.log("RUNTIME BOT TOKEN:", process.env.BOT_TOKEN ? process.env.BOT_TOKEN.slice(0, -6) + "******" : "undefined");

export const bot = new ExtraTelegraf(process.env.BOT_TOKEN!);

// TEMPORARY DEBUG: Get bot info from Telegram
bot.telegram.getMe().then((me) => {
  console.log("DEBUG - BOT USERNAME:", me.username);
  console.log("DEBUG - BOT ID:", me.id);
  console.log("DEBUG - BOT FIRST NAME:", me.first_name);
});

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
// REFACTORING: Improved uncaughtException to run graceful cleanup before exiting
// This ensures DB connections close and cleanup hooks run, preventing data loss
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

// Import closeDatabase for graceful shutdown in uncaughtException
import { closeDatabase } from "./storage/db";

process.on('uncaughtException', async err => {
  console.error('[FATAL] Uncaught Exception:', err);
  console.log('[FATAL] Running graceful shutdown before exit...');
  
  try {
    // Stop bot gracefully (similar to setupGracefulShutdown)
    if (process.env.RENDER_EXTERNAL_HOSTNAME || process.env.WEBHOOK_URL) {
      await bot.telegram.deleteWebhook();
      console.log('[FATAL] - Webhook deleted');
    } else if (bot.botInfo) {
      await bot.stop('uncaughtException');
    }
  } catch (error) {
    console.log('[FATAL] - Bot stop skipped:', (error as Error).message);
  }
  
  try {
    // Close database connection
    await closeDatabase();
    console.log('[FATAL] - Database connection closed');
  } catch (error) {
    console.error('[FATAL] - Error closing database:', error);
  }
  
  console.log('[FATAL] - Graceful shutdown complete, exiting with code 1');
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
import { initAdminActions, startSessionCleanup } from "./Commands/adminaccess";
initAdminActions(bot);
startSessionCleanup();

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

/* ---------------- ADMIN MODULES ---------------- */
import { registerAdminCallbacks } from "./admin/index";
import { loadModerationSettings } from "./admin/moderationSettings";
registerAdminCallbacks(bot);
loadModerationSettings().catch(err => console.error("[INIT] Failed to load moderation settings:", err));

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
if (process.env.NODE_ENV === "test") {
  console.log("[INFO] - Test mode detected. Bot launch skipped.");
} else if (isProduction()) {
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

// Disable background tasks during tests
if (process.env.NODE_ENV !== "test") {
  registerCleanupTasks(bot);
  setupGracefulShutdown(bot);
}

// Clear state on startup
bot.runningChats.clear();
bot.waitingQueue = [];
bot.messageMap.clear();
bot.messageCountMap.clear();

console.log("[INFO] - Bot startup complete. All state cleared.");
