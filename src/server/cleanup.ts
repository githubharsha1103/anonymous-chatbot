import { ExtraTelegraf } from '../index';
import { resetDailyCounts, closeDatabase } from '../storage/db';

/**
 * Cleanup and maintenance tasks
 * Extracted from index.ts for better organization
 */

/**
 * Clean up stale data from Maps to prevent memory leaks
 */
export function cleanupStaleData(bot: ExtraTelegraf): void {
  try {
    const now = Date.now();
    const RATE_LIMIT_CLEANUP_THRESHOLD = 60000; // 1 minute
    
    for (const [userId, timestamp] of bot.rateLimitMap) {
      if (now - timestamp > RATE_LIMIT_CLEANUP_THRESHOLD) {
        bot.rateLimitMap.delete(userId);
      }
    }
    
    console.log(`[CLEANUP] - Rate limit map size: ${bot.rateLimitMap.size}, Running chats: ${bot.runningChats.size}, Waiting queue: ${bot.waitingQueue.length}`);
  } catch (error) {
    console.error("[CLEANUP] - Error during cleanup:", error);
  }
}

/**
 * Enforce queue size limit - remove oldest entries if too large
 */
export function enforceQueueSizeLimit(bot: ExtraTelegraf): void {
  const MAX_QUEUE_SIZE = 10000;
  
  if (bot.waitingQueue.length > MAX_QUEUE_SIZE) {
    bot.waitingQueue = bot.waitingQueue.slice(-MAX_QUEUE_SIZE);
  }
  
  if (bot.waitingQueue.length > MAX_QUEUE_SIZE * 0.8) {
    console.log(`[WARN] - Queue size is at ${bot.waitingQueue.length}/${MAX_QUEUE_SIZE}`);
  }
}

/**
 * Ensure users in active chats are not in the waiting queue
 */
export function filterQueueUsersInChats(bot: ExtraTelegraf): void {
  const initialLength = bot.waitingQueue.length;
  
  bot.waitingQueue = bot.waitingQueue.filter(user => {
    return !bot.runningChats.has(user.id);
  });
  
  const removed = initialLength - bot.waitingQueue.length;
  if (removed > 0) {
    console.log(`[CLEANUP] - Removed ${removed} users from queue who were in active chats`);
  }
}

/**
 * Hourly cleanup of rate limit and cooldown maps
 * Only removes entries older than 1 hour to avoid disconnecting active users
 */
export function hourlyMapCleanup(bot: ExtraTelegraf): void {
  const now = Date.now();
  const ENTRY_MAX_AGE = 3600000; // 1 hour in milliseconds
  
  // Only clear entries older than 1 hour
  let rateLimitCleared = 0;
  for (const [userId, timestamp] of bot.rateLimitMap) {
    if (now - timestamp > ENTRY_MAX_AGE) {
      bot.rateLimitMap.delete(userId);
      rateLimitCleared++;
    }
  }
  
  let cooldownCleared = 0;
  for (const [userId, cooldowns] of bot.actionCooldownMap) {
    let hasRecent = false;
    for (const [action, time] of cooldowns) {
      if (now - time <= ENTRY_MAX_AGE) {
        hasRecent = true;
      } else {
        cooldowns.delete(action);
        cooldownCleared++;
      }
    }
    if (!hasRecent || cooldowns.size === 0) {
      bot.actionCooldownMap.delete(userId);
    }
  }
  
  console.log(`[CLEANUP] - Rate limit map: cleared ${rateLimitCleared} stale entries; Action cooldown map: cleared ${cooldownCleared} stale entries`);
}

/**
 * Schedule daily reset of chat counts
 */
export function scheduleDailyReset(): void {
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
    
    // Schedule next reset every 24 hours
    setInterval(async () => {
      try {
        const count = await resetDailyCounts();
        console.log(`[DAILY] - Daily chat counts reset for ${count} users`);
      } catch (error) {
        console.error("[DAILY] - Error resetting daily counts:", error);
      }
    }, 24 * 60 * 60 * 1000);
  }, msUntilMidnight);
}

/**
 * Register all cleanup intervals
 */
export function registerCleanupTasks(bot: ExtraTelegraf): void {
  // Run cleanup every 5 minutes
  setInterval(() => cleanupStaleData(bot), 300000);
  
  // Hourly map cleanup
  setInterval(() => hourlyMapCleanup(bot), 3600000);
  
  // Queue size check every minute
  setInterval(() => enforceQueueSizeLimit(bot), 60000);
  
  // Queue safety filter every 30 seconds
  setInterval(() => filterQueueUsersInChats(bot), 30000);
  
  // Schedule daily reset
  scheduleDailyReset();
}

/**
 * Setup graceful shutdown handlers
 */
export function setupGracefulShutdown(bot: ExtraTelegraf): void {
  process.once("SIGINT", async () => {
    console.log("[INFO] - Stopping bot (SIGINT)...");
    try {
      if (process.env.RENDER_EXTERNAL_HOSTNAME || process.env.WEBHOOK_URL) {
        await bot.telegram.deleteWebhook();
        console.log("[INFO] - Webhook deleted");
      } else if (bot.botInfo) {
        await bot.stop("SIGINT");
      }
    } catch (error) {
      console.log("[INFO] - Bot stop skipped:", (error as Error).message);
    }
    
    try {
      await closeDatabase();
    } catch {
      // Ignore close errors
    }
    process.exit(0);
  });

  process.once("SIGTERM", async () => {
    console.log("[INFO] - Stopping bot (SIGTERM)...");
    try {
      if (process.env.RENDER_EXTERNAL_HOSTNAME || process.env.WEBHOOK_URL) {
        await bot.telegram.deleteWebhook();
        console.log("[INFO] - Webhook deleted");
      } else if (bot.botInfo) {
        await bot.stop("SIGTERM");
      }
    } catch (error) {
      console.log("[INFO] - Bot stop skipped:", (error as Error).message);
    }
    
    try {
      await closeDatabase();
    } catch {
      // Ignore close errors
    }
    process.exit(0);
  });
}
