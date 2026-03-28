import { ExtraTelegraf } from '../index';
import { closeDatabase, revokeExpiredPremiumUsers, expireOldPremiumOrders } from '../storage/db';

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
    
    // Clean up rate limit map
    for (const [userId, timestamp] of bot.rateLimitMap) {
      if (now - timestamp > RATE_LIMIT_CLEANUP_THRESHOLD) {
        bot.rateLimitMap.delete(userId);
      }
    }
    
    // Clean up message maps for users not in active chats (prevent memory leaks)
    for (const [userId] of bot.messageMap) {
      if (!bot.runningChats.has(userId)) {
        bot.messageMap.delete(userId);
        bot.messageCountMap.delete(userId);
        console.log(`[CLEANUP] Removed stale message data for user ${userId} (not in active chat)`);
      }
    }
    
    // Clean up message count map entries not in message map
    for (const [userId] of bot.messageCountMap) {
      if (!bot.messageMap.has(userId)) {
        bot.messageCountMap.delete(userId);
      }
    }
    
    // Clean up stale spectator sessions (where users are no longer in active chats)
    // Note: Iterating a Map while deleting is safe in JavaScript - the iterator is not affected
    // by deletions that occur after the current entry was visited
    let spectatorCount = 0;
    for (const [sessionKey, spectators] of bot.spectatingChats) {
      spectatorCount += spectators.size;
      // Check if either user is still in an active chat
      // Note: This captures state at iteration time; a user could theoretically rejoin between
      // check and delete, but that's acceptable - stale sessions will be cleaned on next run
      const [user1, user2] = sessionKey.split('_').map(Number);
      const user1Active = bot.runningChats.has(user1);
      const user2Active = bot.runningChats.has(user2);
      
      // Remove if neither user is active anymore
      if (!user1Active && !user2Active) {
        // Remove all spectators for this session
        for (const adminId of spectators) {
          bot.removeSpectator(adminId);
        }
        console.log(`[CLEANUP] - Removed stale spectator session: ${sessionKey}`);
      }
    }
    
    console.log(`[CLEANUP] - Rate limit map: ${bot.rateLimitMap.size}, Running chats: ${bot.runningChats.size}, Waiting queue: ${bot.waitingQueue.length} (Set: ${bot.queueSet.size}), Spectating: ${spectatorCount}, Message maps: ${bot.messageMap.size}`);
  } catch (error) {
    console.error("[CLEANUP] - Error during cleanup:", error);
  }
}

/**
 * Enforce queue size limit - remove oldest entries if too large
 * FIX: Now also rebuilds preference maps
 */
export function enforceQueueSizeLimit(bot: ExtraTelegraf): void {
  const MAX_QUEUE_SIZE = 10000;
  
  if (bot.waitingQueue.length > MAX_QUEUE_SIZE) {
    bot.waitingQueue = bot.waitingQueue.slice(-MAX_QUEUE_SIZE);
    // Rebuild queueSet after slicing
    bot.queueSet.clear();
    for (const user of bot.waitingQueue) {
      bot.queueSet.add(user.id);
    }
    // FIX: Rebuild preference map using public method
    bot.clearPreferenceMaps();
    for (const user of bot.waitingQueue) {
      bot.addToPreferenceMap(user, false);
    }
  }
  
  // Sync queueSet with waitingQueue if out of sync
  if (bot.queueSet.size !== bot.waitingQueue.length) {
    bot.queueSet.clear();
    for (const user of bot.waitingQueue) {
      bot.queueSet.add(user.id);
    }
  }
  
  if (bot.waitingQueue.length > MAX_QUEUE_SIZE * 0.8) {
    console.log(`[WARN] - Queue size is at ${bot.waitingQueue.length}/${MAX_QUEUE_SIZE}`);
  }
}

/**
 * Ensure users in active chats are not in the waiting queue
 * Also syncs queueSet with waitingQueue array
 * FIX: Now also rebuilds preference maps
 */
export function filterQueueUsersInChats(bot: ExtraTelegraf): void {
  const initialLength = bot.waitingQueue.length;
  const initialPremiumLength = bot.premiumQueue.length;
  
  // Filter regular queue - keep users NOT in running chats
  bot.waitingQueue = bot.waitingQueue.filter(user => {
    if (bot.runningChats.has(user.id)) {
      console.log(`[CLEANUP] Removed user ${user.id} from queue (in active chat)`);
      return false;
    }
    return true;
  });
  
  // Filter premium queue - keep users NOT in running chats
  bot.premiumQueue = bot.premiumQueue.filter(user => {
    if (bot.runningChats.has(user.id)) {
      console.log(`[CLEANUP] Removed user ${user.id} from premium queue (in active chat)`);
      return false;
    }
    return true;
  });
  
  // Rebuild queueSets to ensure consistency with arrays
  bot.queueSet.clear();
  for (const user of bot.waitingQueue) {
    bot.queueSet.add(user.id);
  }
  
  bot.premiumQueueSet.clear();
  for (const user of bot.premiumQueue) {
    bot.premiumQueueSet.add(user.id);
  }
  
  // FIX: Rebuild preference maps using public method
  bot.clearPreferenceMaps();
  for (const user of bot.waitingQueue) {
    bot.addToPreferenceMap(user, false);
  }
  for (const user of bot.premiumQueue) {
    bot.addToPreferenceMap(user, true);
  }
  
  const removed = initialLength - bot.waitingQueue.length;
  const premiumRemoved = initialPremiumLength - bot.premiumQueue.length;
  
  if (removed > 0 || premiumRemoved > 0) {
    console.log(`[CLEANUP] Removed ${removed} users from regular queue and ${premiumRemoved} from premium queue who were in active chats`);
  }
  
  // Log mismatches if detected
  if (bot.queueSet.size !== bot.waitingQueue.length) {
    console.log(`[CLEANUP] Queue consistency fix: Set size ${bot.queueSet.size}, Array length ${bot.waitingQueue.length}`);
  }
  
  if (bot.premiumQueueSet.size !== bot.premiumQueue.length) {
    console.log(`[CLEANUP] Premium queue consistency fix: Set size ${bot.premiumQueueSet.size}, Array length ${bot.premiumQueue.length}`);
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
 * Register all cleanup intervals
 */
export function registerCleanupTasks(bot: ExtraTelegraf): void {
  // Run premium expiry cleanup once on startup
  revokeExpiredPremiumUsers().then(revoked => {
    if (revoked > 0) {
      console.log(`[CLEANUP] - Revoked premium for ${revoked} expired users`);
    }
  }).catch(error => {
    console.error("[CLEANUP] - Startup premium cleanup failed:", error);
  });

  // Run expired orders cleanup once on startup
  expireOldPremiumOrders().then(expired => {
    if (expired > 0) {
      console.log(`[CLEANUP] - Expired ${expired} pending premium orders`);
    }
  }).catch(error => {
    console.error("[CLEANUP] - Startup order expiry cleanup failed:", error);
  });

  // Run cleanup every 5 minutes
  setInterval(() => cleanupStaleData(bot), 300000);
  
  // Hourly map cleanup
  setInterval(() => hourlyMapCleanup(bot), 3600000);
  
  // Queue size check every minute
  setInterval(() => enforceQueueSizeLimit(bot), 60000);
  
  // Queue safety filter every 30 seconds
  setInterval(() => filterQueueUsersInChats(bot), 30000);
  
  // Queue state synchronization every 2 minutes
  setInterval(() => {
    try {
      bot.syncQueueState();
    } catch (error) {
      console.error("[CLEANUP] - Error during queue synchronization:", error);
    }
  }, 120000);

  // Revoke expired premium users every hour
  setInterval(async () => {
    try {
      const revoked = await revokeExpiredPremiumUsers();
      if (revoked > 0) {
        console.log(`[CLEANUP] - Revoked premium for ${revoked} expired users`);
      }
    } catch (error) {
      console.error("[CLEANUP] - Error revoking expired premium users:", error);
    }
  }, 3600000);

  // Expire old pending orders every 10 minutes
  setInterval(async () => {
    try {
      const expired = await expireOldPremiumOrders();
      if (expired > 0) {
        console.log(`[CLEANUP] - Expired ${expired} pending premium orders`);
      }
    } catch (error) {
      console.error("[CLEANUP] - Error expiring old orders:", error);
    }
  }, 600000); // 10 minutes
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
