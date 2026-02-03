import { ExtraTelegraf } from "../index";
import { Markup } from "telegraf";

/**
 * Telegram API Error types
 */
export interface TelegramError extends Error {
  response?: {
    ok: boolean;
    error_code: number;
    description: string;
  };
  on?: {
    method: string;
    payload: any;
  };
}

/**
 * Check if an error is a "bot blocked by user" error (403)
 */
export function isBotBlockedError(error: any): error is TelegramError {
  return (
    error?.response?.error_code === 403 &&
    error?.response?.description?.includes("bot was blocked by the user")
  );
}

/**
 * Check if an error is a "not enough rights" error (400)
 * This happens when user restricted bot, bot was removed from chat, or no rights to send messages
 */
export function isNotEnoughRightsError(error: any): boolean {
  return (
    error?.response?.error_code === 400 &&
    (error?.response?.description?.includes("not enough rights") ||
     error?.response?.description?.includes("chat not found") ||
     error?.response?.description?.includes("user is deactivated"))
  );
}

/**
 * Check if an error is a rate limit error (429)
 */
export function isRateLimitError(error: any): boolean {
  return (
    error?.response?.error_code === 429 ||
    error?.response?.description?.includes("Too Many Requests")
  );
}

/**
 * Get retry delay from rate limit error (in seconds)
 */
export function getRetryDelay(error: any): number {
  const match = error?.response?.description?.match(/retry after (\d+)/);
  if (match) {
    return parseInt(match[1], 10);
  }
  // Default delay if not specified
  return 5;
}

/**
 * Clean up user state when they block the bot or bot loses rights
 * This removes the user from waiting queues, active chats, etc.
 */
export function cleanupBlockedUser(bot: ExtraTelegraf, userId: number): void {
  let cleanedUp = false;

  // Remove from waiting queue
  const queueIndex = bot.waitingQueue.findIndex(w => w.id === userId);
  if (queueIndex !== -1) {
    bot.waitingQueue.splice(queueIndex, 1);
    cleanedUp = true;
    console.log(`[CLEANUP] - User ${userId} removed from waiting queue`);
  }

  // Clear waiting if it was this user
  if (bot.waiting === userId) {
    bot.waiting = null;
    cleanedUp = true;
  }

  // Remove from running chats
  const chatIndex = bot.runningChats.indexOf(userId);
  if (chatIndex !== -1) {
    // Get partner before removing
    const partner = bot.getPartner(userId);
    
    // Remove both users from running chats (pair is broken)
    bot.runningChats = bot.runningChats.filter(u => u !== userId);
    if (partner) {
      bot.runningChats = bot.runningChats.filter(u => u !== partner);
    }
    
    cleanedUp = true;
    console.log(`[CLEANUP] - User ${userId} removed from running chats (partner: ${partner})`);

    // Clean up message maps for both users
    bot.messageMap.delete(userId);
    if (partner) {
      bot.messageMap.delete(partner);
    }

    return; // Partner cleanup handled synchronously
  }

  if (cleanedUp) {
    console.log(`[CLEANUP] - Completed cleanup for user ${userId}`);
  }

  // Note: User data is NOT deleted from database to preserve statistics
}

/**
 * Async version of cleanupBlockedUser that also notifies the partner
 */
export async function cleanupBlockedUserAsync(bot: ExtraTelegraf, userId: number): Promise<void> {
  const partner = bot.getPartner(userId);
  
  // First notify the partner (best effort)
  if (partner) {
    const reportKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback("🚨 Report User", "OPEN_REPORT")]
    ]);
    
    try {
      await bot.telegram.sendMessage(
        partner,
        "🚫 Partner left the chat\n\n/next - Find new partner\n\n━━━━━━━━━━━━━━━━━\nTo report this chat:",
        { ...reportKeyboard }
      );
      console.log(`[CLEANUP] - Notified partner ${partner} that user ${userId} left`);
    } catch (error) {
      console.log(`[CLEANUP] - Could not notify partner ${partner}:`, error);
    }
  }
  
  // Then perform cleanup
  cleanupBlockedUser(bot, userId);
}

/**
 * End a chat properly when an error occurs with the partner
 */
export function endChatDueToError(bot: ExtraTelegraf, userId: number, partnerId: number): void {
  // Remove both users from running chats
  bot.runningChats = bot.runningChats.filter(u => u !== userId && u !== partnerId);
  
  // Clean up message maps
  bot.messageMap.delete(userId);
  bot.messageMap.delete(partnerId);
  
  console.log(`[CLEANUP] - Chat ended due to error: user ${userId}, partner ${partnerId}`);
}

/**
 * Handle a Telegram error, returning true if it was handled (e.g., bot blocked)
 * If partnerId is provided, the partner will be notified that the chat ended
 */
export async function handleTelegramError(
  bot: ExtraTelegraf,
  error: any,
  userId?: number,
  partnerId?: number
): Promise<boolean> {
  if (isBotBlockedError(error)) {
    const blockedUserId = userId || error.on?.payload?.chat_id;
    if (blockedUserId) {
      await cleanupBlockedUserAsync(bot, blockedUserId);
    }
    console.log(`[HANDLED] - Bot blocked by user ${blockedUserId}`);
    return true;
  }
  
  if (isNotEnoughRightsError(error)) {
    const affectedUserId = userId || error.on?.payload?.chat_id;
    if (affectedUserId) {
      await cleanupBlockedUserAsync(bot, affectedUserId);
    }
    console.log(`[HANDLED] - Not enough rights error for user ${affectedUserId}`);
    return true;
  }
  
  // Log other errors but don't crash
  console.error(`[TELEGRAM ERROR] -`, error.message || error);
  return false;
}

/**
 * Rate limiter to prevent Too Many Requests errors
 */
const messageQueue: { chatId: number; text: string; extra?: any; resolve: (value: boolean) => void }[] = [];
let isProcessingQueue = false;
const MIN_DELAY_MS = 1000; // Minimum 1 second between messages

let lastMessageTime = 0;

/**
 * Process the message queue with rate limiting
 */
async function processMessageQueue(): Promise<void> {
  if (isProcessingQueue || messageQueue.length === 0) return;
  
  isProcessingQueue = true;
  
  while (messageQueue.length > 0) {
    const now = Date.now();
    const timeSinceLastMessage = now - lastMessageTime;
    
    // Wait if we need to respect rate limits
    if (timeSinceLastMessage < MIN_DELAY_MS) {
      await new Promise(resolve => 
        setTimeout(resolve, MIN_DELAY_MS - timeSinceLastMessage)
      );
    }
    
    const item = messageQueue.shift();
    if (!item) continue;
    
    lastMessageTime = Date.now();
    
    try {
      const bot = require("../index").bot;
      await bot.telegram.sendMessage(item.chatId, item.text, item.extra);
      item.resolve(true);
    } catch (error: any) {
      if (isBotBlockedError(error)) {
        cleanupBlockedUserAsync(require("../index").bot, item.chatId);
        item.resolve(false);
      } else if (isNotEnoughRightsError(error)) {
        cleanupBlockedUserAsync(require("../index").bot, item.chatId);
        item.resolve(false);
      } else if (isRateLimitError(error)) {
        const delay = getRetryDelay(error) * 1000;
        console.log(`[RATE LIMIT] - Retrying after ${delay}ms`);
        
        // Put the message back at the front of the queue
        messageQueue.unshift(item);
        
        // Wait for the retry delay
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.error(`[SEND ERROR] -`, error.message || error);
        item.resolve(false);
      }
    }
  }
  
  isProcessingQueue = false;
}

/**
 * Safe send message wrapper that handles all errors with rate limiting
 */
export async function safeSendMessage(
  bot: ExtraTelegraf,
  chatId: number,
  text: string,
  extra?: any
): Promise<boolean> {
  return new Promise((resolve) => {
    messageQueue.push({ chatId, text, extra, resolve });
    processMessageQueue();
    resolve(true); // Return immediately, actual result handled by queue
  });
}

/**
 * Send message immediately (for critical messages) with retry logic
 */
export async function sendMessageWithRetry(
  bot: ExtraTelegraf,
  chatId: number,
  text: string,
  extra?: any,
  maxRetries: number = 3
): Promise<boolean> {
  let lastError: any;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await bot.telegram.sendMessage(chatId, text, extra);
      return true;
    } catch (error: any) {
      lastError = error;
      
      if (isBotBlockedError(error)) {
        await cleanupBlockedUserAsync(bot, chatId);
        return false;
      }
      
      if (isNotEnoughRightsError(error)) {
        await cleanupBlockedUserAsync(bot, chatId);
        return false;
      }
      
      if (isRateLimitError(error)) {
        const delay = getRetryDelay(error) * 1000;
        console.log(`[RATE LIMIT] - Retry ${attempt + 1}/${maxRetries} after ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // For other errors, log and continue
      console.error(`[SEND ERROR] - Attempt ${attempt + 1}/${maxRetries}:`, error.message || error);
    }
  }
  
  console.error(`[SEND ERROR] - Failed after ${maxRetries} attempts:`, lastError?.message || lastError);
  return false;
}

/**
 * Broadcast message to multiple users with rate limiting
 */
export async function broadcastWithRateLimit(
  bot: ExtraTelegraf,
  userIds: number[],
  text: string,
  onProgress?: (success: number, failed: number) => void
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;
  
  for (const userId of userIds) {
    const result = await sendMessageWithRetry(bot, userId, text);
    if (result) {
      success++;
    } else {
      failed++;
    }
    
    if (onProgress) {
      onProgress(success, failed);
    }
    
    // Add delay between broadcasts to avoid rate limits
    if (userIds.indexOf(userId) < userIds.length - 1) {
      await new Promise(resolve => setTimeout(resolve, MIN_DELAY_MS));
    }
  }
  
  return { success, failed };
}
