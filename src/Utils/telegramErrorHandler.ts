import { ExtraTelegraf } from "../index";
import { deleteUser } from "../storage/db";

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
 * This happens when user restricted bot or bot was removed from chat
 */
export function isNotEnoughRightsError(error: any): boolean {
  return (
    error?.response?.error_code === 400 &&
    error?.response?.description?.includes("not enough rights")
  );
}

/**
 * Clean up user state when they block the bot
 * This removes the user from waiting queues, active chats, etc.
 */
export function cleanupBlockedUser(bot: ExtraTelegraf, userId: number): void {
  let cleanedUp = false;

  // Remove from waiting queue
  const queueIndex = bot.waitingQueue.findIndex(w => w.id === userId);
  if (queueIndex !== -1) {
    bot.waitingQueue.splice(queueIndex, 1);
    cleanedUp = true;
    console.log(`[CLEANUP] - User ${userId} removed from waiting queue (bot blocked)`);
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
    bot.runningChats.splice(chatIndex, 1);
    
    // Remove the partner entry as well (paired entries)
    const partnerIndex = bot.runningChats.indexOf(partner);
    if (partnerIndex !== -1) {
      bot.runningChats.splice(partnerIndex, 1);
    }
    
    cleanedUp = true;
    console.log(`[CLEANUP] - User ${userId} removed from running chats (bot blocked)`);

    // Notify partner that user left
    if (partner) {
      console.log(`[CLEANUP] - Notifying partner ${partner} that user ${userId} left`);
    }
  }

  if (cleanedUp) {
    console.log(`[CLEANUP] - Completed cleanup for blocked user ${userId}`);
  }

  // Delete user data from database
  if (deleteUser(userId)) {
    console.log(`[CLEANUP] - Deleted user ${userId} data from database`);
  }
}

/**
 * Handle a Telegram error, returning true if it was handled (e.g., bot blocked)
 */
export function handleTelegramError(
  bot: ExtraTelegraf,
  error: any,
  userId?: number
): boolean {
  if (isBotBlockedError(error)) {
    const blockedUserId = userId || error.on?.payload?.chat_id;
    if (blockedUserId) {
      cleanupBlockedUser(bot, blockedUserId);
    }
    console.log(`[HANDLED] - Bot blocked by user ${blockedUserId}`);
    return true;
  }
  
  // Log other errors but don't crash
  console.error(`[TELEGRAM ERROR] -`, error.message || error);
  return false;
}

/**
 * Safe send message wrapper that handles blocked user errors
 */
export async function safeSendMessage(
  bot: ExtraTelegraf,
  chatId: number,
  text: string,
  extra?: any
): Promise<boolean> {
  try {
    await bot.telegram.sendMessage(chatId, text, extra);
    return true;
  } catch (error) {
    if (isBotBlockedError(error)) {
      cleanupBlockedUser(bot, chatId);
      return false;
    }
    if (isNotEnoughRightsError(error)) {
      // User restricted bot or bot was removed from chat
      cleanupBlockedUser(bot, chatId);
      return false;
    }
    throw error;
  }
}
