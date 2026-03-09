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
    payload: Record<string, unknown>;
  };
}

type TelegramSendExtra = {
  parse_mode?: "Markdown" | "HTML";
} & NonNullable<Parameters<ExtraTelegraf["telegram"]["sendMessage"]>[2]>;

/**
 * Check if an error is a "bot blocked by user" error (403)
 */
export function isBotBlockedError(error: unknown): error is TelegramError {
  const e = error as TelegramError;
  return (
    e?.response?.error_code === 403 &&
    e?.response?.description?.includes("bot was blocked by the user")
  );
}

/**
 * Check if an error is a "not enough rights" error (400)
 * This happens when user restricted bot, bot was removed from chat, or no rights to send messages
 */
export function isNotEnoughRightsError(error: unknown): boolean {
  const e = error as TelegramError;
  return (
    e?.response?.error_code === 400 &&
    (e?.response?.description?.includes("not enough rights") ||
     e?.response?.description?.includes("chat not found") ||
     e?.response?.description?.includes("user is deactivated"))
  );
}

/**
 * Check if an error is a rate limit error (429)
 */
export function isRateLimitError(error: unknown): boolean {
  const e = error as TelegramError;
  return (
    e?.response?.error_code === 429 ||
    !!e?.response?.description?.includes("Too Many Requests")
  );
}

/**
 * Get retry delay from rate limit error (in seconds)
 */
export function getRetryDelay(error: unknown): number {
  const e = error as TelegramError;
  const match = e?.response?.description?.match(/retry after (\d+)/);
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
  // Remove from waiting queue (both array and Set for O(1) cleanup)
  if (bot.queueSet.has(userId)) {
    bot.queueSet.delete(userId);
    const queueIndex = bot.waitingQueue.findIndex(w => w.id === userId);
    if (queueIndex !== -1) {
      bot.waitingQueue.splice(queueIndex, 1);
    }
    console.log(`[CLEANUP] - User ${userId} removed from waiting queue`);
  }

  // Remove from running chats using Map
  if (bot.runningChats.has(userId)) {
    // Get partner before removing
    const partner = bot.getPartner(userId);
    
    // Remove both users from running chats using Map delete
    bot.runningChats.delete(userId);
    if (partner) bot.runningChats.delete(partner);
    
    console.log(`[CLEANUP] - User ${userId} removed from running chats (partner: ${partner})`);

    // Clean up message maps for both users
    bot.messageMap.delete(userId);
    if (partner) {
      bot.messageMap.delete(partner);
    }

    // Clean up message count maps for both users (prevents memory leak)
    bot.messageCountMap.delete(userId);
    if (partner) {
      bot.messageCountMap.delete(partner);
    }

    // Clean up rate limit entries for both users (prevents memory leak)
    bot.rateLimitMap.delete(userId);
    if (partner) {
      bot.rateLimitMap.delete(partner);
    }

    return; // Partner cleanup handled synchronously
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
 * Notifies both users that the chat has ended due to an error
 */
export async function endChatDueToError(bot: ExtraTelegraf, userId: number, partnerId: number): Promise<void> {
  // First notify the partner (best effort)
  try {
    const reportKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback("🚨 Report User", "OPEN_REPORT")]
    ]);
    
    await bot.telegram.sendMessage(
      partnerId,
      "🚫 Partner left the chat\n\n/next - Find new partner\n\n━━━━━━━━━━━━━━━━━\nTo report this chat:",
      { ...reportKeyboard }
    );
    console.log(`[CLEANUP] - Notified partner ${partnerId} about chat ending`);
  } catch (error) {
    console.log(`[CLEANUP] - Could not notify partner ${partnerId}:`, error);
  }
  
  // Remove both users from running chats using Map delete
  bot.runningChats.delete(userId);
  bot.runningChats.delete(partnerId);
  
  // Clean up message maps
  bot.messageMap.delete(userId);
  bot.messageMap.delete(partnerId);
  
  // Clean up message count maps
  bot.messageCountMap.delete(userId);
  bot.messageCountMap.delete(partnerId);
  
  // Clean up rate limit maps
  bot.rateLimitMap.delete(userId);
  bot.rateLimitMap.delete(partnerId);
  
  console.log(`[CLEANUP] - Chat ended due to error: user ${userId}, partner ${partnerId}`);
}

/**
 * Clean up all tracking maps for a user and their partner
 * Call this whenever a chat ends or a user disconnects
 */
export function cleanupUserMaps(bot: ExtraTelegraf, userId: number, partnerId: number | null): void {
  // Clean up message maps for both users
  bot.messageMap.delete(userId);
  if (partnerId) {
    bot.messageMap.delete(partnerId);
  }

  // Clean up message count maps for both users
  bot.messageCountMap.delete(userId);
  if (partnerId) {
    bot.messageCountMap.delete(partnerId);
  }

  // Clean up rate limit entries for both users
  bot.rateLimitMap.delete(userId);
  if (partnerId) {
    bot.rateLimitMap.delete(partnerId);
  }

  console.log(`[CLEANUP] - User maps cleaned: ${userId}, ${partnerId || 'none'}`);
}

/**
 * Handle a Telegram error, returning true if it was handled (e.g., bot blocked)
 * If partnerId is provided, the partner will be notified that the chat ended
 */
export async function handleTelegramError(
  bot: ExtraTelegraf,
  error: unknown,
  userId?: number,
  _partnerId?: number
): Promise<boolean> {
  const errorLike = error as TelegramError;
  if (isBotBlockedError(error)) {
    const chatId = errorLike.on?.payload?.chat_id;
    const blockedUserId = userId || (typeof chatId === "number" ? chatId : undefined);
    if (typeof blockedUserId === "number") {
      await cleanupBlockedUserAsync(bot, blockedUserId);
    }
    console.log(`[HANDLED] - Bot blocked by user ${blockedUserId}`);
    return true;
  }
  
  if (isNotEnoughRightsError(error)) {
    const chatId = errorLike.on?.payload?.chat_id;
    const affectedUserId = userId || (typeof chatId === "number" ? chatId : undefined);
    if (typeof affectedUserId === "number") {
      await cleanupBlockedUserAsync(bot, affectedUserId);
    }
    console.log(`[HANDLED] - Not enough rights error for user ${affectedUserId}`);
    return true;
  }
  
  // Log other errors but don't crash
  const errorDetails = errorLike.message || errorLike.response?.description || JSON.stringify(error) || "Unknown error";
  console.error(`[TELEGRAM ERROR] -`, errorDetails);
  return false;
}

/**
 * Rate limiter to prevent Too Many Requests errors
 */
const messageQueue: { chatId: number; text: string; extra?: TelegramSendExtra; resolve: (value: boolean) => void }[] = [];
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
    } catch (error: unknown) {
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
        const e = error as { message?: string };
        console.error(`[SEND ERROR] -`, e.message || error);
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
  extra?: TelegramSendExtra
): Promise<boolean> {
  return new Promise((resolve) => {
    messageQueue.push({ chatId, text, extra, resolve });
    processMessageQueue();
    // resolution will happen inside processMessageQueue when send succeeds/fails
  });
}

/**
 * Send message immediately (for critical messages) with retry logic and timeout
 */
export async function sendMessageWithRetry(
  bot: ExtraTelegraf,
  chatId: number | null,
  text: string,
  extra?: TelegramSendExtra,
  maxRetries: number = 5,
  timeoutMs: number = 15000
): Promise<boolean> {
  // Validate chatId before attempting to send
  if (!chatId || chatId === 0) {
    console.error(`[SEND ERROR] - Invalid chatId: ${chatId}, message not sent`);
    return false;
  }
  
  let lastError: unknown;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Wrap with timeout using Promise.race
      const promise = bot.telegram.sendMessage(chatId, text, extra);
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error("Telegram API timeout")), timeoutMs)
      );
      await Promise.race([promise, timeoutPromise]);
      return true;
    } catch (error: unknown) {
      lastError = error;
      const e = error as TelegramError & { code?: string; message?: string };
      
      // Handle network errors (ECONNRESET, ETIMEDOUT, fetch failures, empty reason, etc.)
      const isNetworkError = 
        e.message?.includes('ECONNRESET') || 
        e.message?.includes('ETIMEDOUT') ||
        e.message?.includes('ECONNREFUSED') ||
        e.message?.includes('ENOTFOUND') ||
        e.message?.includes('EAI_AGAIN') ||
        e.message?.includes('network') ||
        e.message?.includes('fetch') ||
        e.message?.includes('socket hang up') ||
        e.message?.includes('reason:') ||
        e.code === 'ECONNREFUSED' ||
        e.code === 'ECONNRESET' ||
        e.code === 'ETIMEDOUT' ||
        e.code === 'ENOTFOUND' ||
        e.code === 'UND_ERR_CONNECT_TIMEOUT' ||
        // Catch fetch failures with empty reason (the specific error from logs)
        (e.message && e.message.includes('failed') && !e.response?.error_code);
      
      if (isNetworkError) {
        const backoff = Math.min(2000 * Math.pow(2, attempt), 10000); // Exponential backoff, max 10s
        console.log(`[NETWORK ERROR] - Network issue on attempt ${attempt + 1}/${maxRetries} (${e.message || 'unknown'}), retrying in ${backoff}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue;
      }
      
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
      console.error(`[SEND ERROR] - Attempt ${attempt + 1}/${maxRetries}:`, e.message || e);
    }
  }
  
  const finalError = lastError as { message?: string } | undefined;
  console.error(`[SEND ERROR] - Failed after ${maxRetries} attempts:`, finalError?.message || lastError);
  return false;
}

/**
 * Broadcast message to multiple users with rate limiting and chunking
 * BLOCKING: Waits for all messages to be sent before returning
 * 
 * Optimizations for large broadcasts (10k+ users):
 * - Processes users in chunks (30 at a time) to respect Telegram limits
 * - Sends messages in parallel within each chunk
 * - Respects Telegram rate limits with 1s delay between chunks
 * - Reports progress periodically
 * - Handles failures gracefully with retry logic
 */
export async function broadcastWithRateLimit(
  bot: ExtraTelegraf,
  userIds: number[],
  text: string,
  extra?: {
    parse_mode?: "Markdown" | "HTML";
    reply_markup?: TelegramSendExtra["reply_markup"];
    onProgress?: (success: number, failed: number) => void;
  }
): Promise<{ success: number; failed: number; failedUserIds: number[] }> {
  // Configuration for large broadcasts - 30 users per chunk (Telegram safe limit)
  const CHUNK_SIZE = 30;
  const CHUNK_DELAY = 1000;  // 1 second delay between chunks
  
  console.log(`[BROADCAST] - Starting broadcast to ${userIds.length} users (chunk size: ${CHUNK_SIZE})`);
  
  // For small broadcasts, use the original sequential approach
  if (userIds.length <= CHUNK_SIZE) {
    return await broadcastSequential(bot, userIds, text, extra);
  }
  
  // For large broadcasts, use chunked approach with parallel sending within chunks
  const totalChunks = Math.ceil(userIds.length / CHUNK_SIZE);
  let success = 0;
  let failed = 0;
  const failedUserIds: number[] = [];
  
  for (let chunk = 0; chunk < totalChunks; chunk++) {
    const chunkStart = chunk * CHUNK_SIZE;
    const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, userIds.length);
    const chunkUsers = userIds.slice(chunkStart, chunkEnd);
    
    console.log(`[BROADCAST] - Processing chunk ${chunk + 1}/${totalChunks} (${chunkUsers.length} users)`);
    
    // Send messages in parallel within this chunk
    const chunkResults = await Promise.all(
      chunkUsers.map(userId => 
        sendMessageSafe(bot, userId, text, extra)
      )
    );
    
    // Count results
    for (const result of chunkResults) {
      if (result.success) {
        success++;
      } else {
        failed++;
        if (result.userId) failedUserIds.push(result.userId);
      }
    }
    
    // Progress log
    const totalProcessed = (chunk + 1) * CHUNK_SIZE;
    if (totalProcessed % 300 === 0 || chunk === totalChunks - 1) {
      console.log(`[BROADCAST] - Progress: ${Math.min(totalProcessed, userIds.length)}/${userIds.length} (${success} sent, ${failed} failed)`);
    }
    
    // Delay between chunks to avoid hitting rate limits
    if (chunk < totalChunks - 1) {
      await new Promise(resolve => setTimeout(resolve, CHUNK_DELAY));
    }
  }
  
  console.log(`[BROADCAST] - Complete! Sent: ${success}, Failed: ${failed} out of ${userIds.length} users`);
  return { success, failed, failedUserIds };
}

/**
 * Safe message send with retry logic
 */
async function sendMessageSafe(
  bot: ExtraTelegraf,
  userId: number,
  text: string,
  extra?: TelegramSendExtra
): Promise<{ success: boolean; userId?: number }> {
  const MAX_RETRIES = 2;
  
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      await bot.telegram.sendMessage(userId, text, extra);
      return { success: true, userId };
    } catch (error: unknown) {
      const e = error as TelegramError & { response?: { parameters?: { retry_after?: number } } };
      // Check for rate limit - wait and retry
      if (e?.response?.error_code === 429) {
        const retryAfter = e?.response?.parameters?.retry_after || 5;
        console.log(`[BROADCAST] - Rate limited! Waiting ${retryAfter}s...`);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        continue;
      }
      
      // Check for retryable errors
      const isRetryable = e?.response?.error_code === 403 || 
                          e?.response?.error_code === 400;
      
      if (isRetryable && attempt < MAX_RETRIES - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      
      // Failed
      return { success: false, userId };
    }
  }
  
  return { success: false, userId };
}

/**
 * Sequential broadcast - handles a single chunk of users
 * Used internally by broadcastWithRateLimit
 */
async function broadcastSequential(
  bot: ExtraTelegraf,
  userIds: number[],
  text: string,
  extra?: TelegramSendExtra
): Promise<{ success: number; failed: number; failedUserIds: number[] }> {
  const failedUserIds: number[] = [];
  let success = 0;
  let failed = 0;
  const SEND_DELAY = 35;
  const MAX_RETRIES = 2;
  
  for (let i = 0; i < userIds.length; i++) {
    const userId = userIds[i];
    let retries = 0;
    let sent = false;
    
    while (retries < MAX_RETRIES && !sent) {
      try {
        await bot.telegram.sendMessage(userId, text, extra);
        success++;
        sent = true;
      } catch (error: unknown) {
        const e = error as TelegramError & { response?: { parameters?: { retry_after?: number } } };
        // Check for 429 rate limit
        if (e?.response?.error_code === 429) {
          const retryAfter = e?.response?.parameters?.retry_after || 5;
          console.log(`[BROADCAST] - Rate limited! Waiting ${retryAfter}s...`);
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
          retries++;
          continue;
        }
        
        // Check for other retryable errors (bot blocked, user deactivated)
        const isRetryable = e?.response?.error_code === 403 || 
                          e?.response?.error_code === 400;
        
        if (isRetryable && retries < MAX_RETRIES - 1) {
          retries++;
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
        
        // Non-retryable error or max retries reached
        failed++;
        failedUserIds.push(userId);
        sent = true; // Stop retrying
      }
    }
    
    // Delay between messages
    if (i < userIds.length - 1) {
      await new Promise(resolve => setTimeout(resolve, SEND_DELAY));
    }
  }
  
  return { success, failed, failedUserIds };
}
