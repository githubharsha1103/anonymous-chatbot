/**
 * Matchmaking Queue Monitor Module
 * 
 * Read-only queue inspection with safe user removal using mutex protection.
 * Allows admins to view and manage the matchmaking queue.
 * 
 * Dependencies:
 * - src/index.ts - ExtraTelegraf with queueMutex
 * - src/Utils/adminAuth.ts - Admin validation
 * - src/Utils/telegramUi.ts - Safe UI functions
 * - src/Utils/chatFlow.ts - Chat runtime functions
 * - src/storage/db.ts - Database functions
 */

import { Context, Markup } from "telegraf";
import { ExtraTelegraf } from "../index";
import { isAdminContext, unauthorizedResponse } from "../Utils/adminAuth";
import { safeAnswerCbQuery, safeEditMessageText, getErrorMessage } from "../Utils/telegramUi";
import { getUser, updateUser } from "../storage/db";
import { beginChatRuntime } from "../Utils/chatFlow";
import { 
    tryLockUserForConnection, 
    markUserAsConnected, 
    markUserAsRemoved
} from "../storage/db";

// ==================== Types ====================

export interface QueueStats {
    waitingCount: number;
    premiumCount: number;
    totalInQueue: number;
    queueSetSize: number;
}

export interface QueueUser {
    id: number;
    gender: string;
    preference: string;
    isPremium: boolean;
}

export interface QueueDetails {
    waiting: QueueUser[];
    premium: QueueUser[];
}

// ==================== Database Queue Functions ====================

/**
 * Get queue users from database based on in-memory state.
 * This function retrieves user data from DB for users currently in queue.
 * Returns enriched queue data with current preferences from database.
 */
export async function getQueueFromDB(bot: ExtraTelegraf): Promise<{ waiting: QueueUser[]; premium: QueueUser[] }> {
    const waiting: QueueUser[] = [];
    const premium: QueueUser[] = [];
    
    // Get users from waiting queue and fetch their latest data from DB
    for (const user of bot.waitingQueue) {
        try {
            const dbUser = await getUser(user.id);
            waiting.push({
                id: user.id,
                gender: dbUser.gender || user.gender || "unknown",
                preference: dbUser.preference || user.preference || "any",
                isPremium: false
            });
        } catch (error) {
            console.error(`[queueMonitor] Error fetching user ${user.id} from DB:`, error);
            // Fallback to in-memory data
            waiting.push({
                id: user.id,
                gender: user.gender || "unknown",
                preference: user.preference || "any",
                isPremium: false
            });
        }
    }
    
    // Get users from premium queue and fetch their latest data from DB
    for (const user of bot.premiumQueue) {
        try {
            const dbUser = await getUser(user.id);
            premium.push({
                id: user.id,
                gender: dbUser.gender || user.gender || "unknown",
                preference: dbUser.preference || user.preference || "any",
                isPremium: true
            });
        } catch (error) {
            console.error(`[queueMonitor] Error fetching premium user ${user.id} from DB:`, error);
            // Fallback to in-memory data
            premium.push({
                id: user.id,
                gender: user.gender || "unknown",
                preference: user.preference || "any",
                isPremium: true
            });
        }
    }
    
    console.log(`[queueMonitor] Fetched queue from DB: ${waiting.length} waiting, ${premium.length} premium`);
    return { waiting, premium };
}

/**
 * Update user's preference in queue when they change it.
 * This ensures the in-memory queue reflects the latest preference from DB.
 */
export function updateUserPreferenceInQueue(bot: ExtraTelegraf, userId: number, newPreference: string): void {
    // Update in waiting queue
    const waitingUser = bot.waitingQueue.find((u: { id: number }) => u.id === userId);
    if (waitingUser) {
        waitingUser.preference = newPreference;
        console.log(`[queueMonitor] Updated preference for user ${userId} in waiting queue: ${newPreference}`);
    }
    
    // Update in premium queue
    const premiumUser = bot.premiumQueue.find((u: { id: number }) => u.id === userId);
    if (premiumUser) {
        premiumUser.preference = newPreference;
        console.log(`[queueMonitor] Updated preference for user ${userId} in premium queue: ${newPreference}`);
    }
}

// ==================== Core Functions ====================

/**
 * Get current queue statistics.
 */
export function getQueueStats(bot: ExtraTelegraf): QueueStats {
    return {
        waitingCount: bot.waitingQueue.length,
        premiumCount: bot.premiumQueue.length,
        totalInQueue: bot.waitingQueue.length + bot.premiumQueue.length,
        queueSetSize: bot.queueSet.size
    };
}

/**
 * Get queue details for inspection - now fetches from DB for accurate data.
 */
export async function getQueueDetails(bot: ExtraTelegraf): Promise<QueueDetails> {
    // Always fetch latest data from database
    const dbQueue = await getQueueFromDB(bot);
    
    return {
        waiting: dbQueue.waiting,
        premium: dbQueue.premium
    };
}

/**
 * Safely remove user from queue with mutex protection.
 * This is the key safety function that uses queueMutex.
 */
export async function safeRemoveFromQueue(
    bot: ExtraTelegraf,
    userId: number,
    adminId: number
): Promise<{ success: boolean; message: string }> {
    // Validate userId
    if (!userId || isNaN(userId)) {
        return { success: false, message: "Invalid user ID" };
    }
    
    // Check if user is in queue
    const isInWaitingQueue = bot.queueSet.has(userId);
    const isInPremiumQueue = bot.premiumQueueSet.has(userId);
    
    if (!isInWaitingQueue && !isInPremiumQueue) {
        return { success: false, message: "User not found in queue" };
    }
    
    // Acquire mutex for thread-safe operation
    let locked = false;
    try {
        await bot.queueMutex.acquire();
        locked = true;
        
        // Double-check after acquiring lock
        const stillInQueue = bot.queueSet.has(userId) || bot.premiumQueueSet.has(userId);
        if (!stillInQueue) {
            return { success: false, message: "User already removed from queue" };
        }
        
        // Remove from waiting queue
        const waitingIdx = bot.waitingQueue.findIndex(u => u.id === userId);
        if (waitingIdx !== -1) {
            bot.waitingQueue.splice(waitingIdx, 1);
            bot.queueSet.delete(userId);
        }
        
        // Remove from premium queue
        const premiumIdx = bot.premiumQueue.findIndex(u => u.id === userId);
        if (premiumIdx !== -1) {
            bot.premiumQueue.splice(premiumIdx, 1);
            bot.premiumQueueSet.delete(userId);
        }
        
        // Verify user is removed from all queue structures
        const stillInWaiting = bot.queueSet.has(userId);
        const stillInPremium = bot.premiumQueueSet.has(userId);
        
        if (stillInWaiting || stillInPremium) {
            console.error(`[queueMonitor] Warning: User ${userId} still in queue after removal attempt`);
            return { success: false, message: "Failed to fully remove user from queue" };
        }
        
        console.log(`[queueMonitor] User ${userId} removed from queue by admin ${adminId}`);
        
        return { success: true, message: `User ${userId} removed from queue` };
    } catch (error) {
        console.error("[queueMonitor] Failed to remove user:", getErrorMessage(error));
        return { success: false, message: "Failed to remove user from queue" };
    } finally {
        if (locked) {
            bot.queueMutex.release();
        }
    }
}

/**
 * Check if a user is in any queue.
 */
export function isUserInQueue(bot: ExtraTelegraf, userId: number): boolean {
    return bot.queueSet.has(userId) || bot.premiumQueueSet.has(userId);
}

// ==================== Connect Admin to Queue User ====================

/**
 * Connect admin with a queued user.
 * Uses atomic DB operations to prevent race conditions.
 */
export async function connectAdminToUser(
    ctx: Context,
    bot: ExtraTelegraf,
    adminId: number,
    userId: number
): Promise<{ success: boolean; message: string }> {
    console.log(`[queueMonitor] Connect clicked by admin ${adminId} for user ${userId}`);
    
    // Validate userId
    if (!userId || isNaN(userId)) {
        return { success: false, message: "Invalid user ID" };
    }
    
    // Edge case: Prevent connecting to self
    if (adminId === userId) {
        console.log(`[queueMonitor] Error: Admin ${adminId} tried to connect to themselves`);
        return { success: false, message: "Cannot connect to yourself" };
    }
    
    // Check if user is in queue (in-memory check first for quick failure)
    if (!isUserInQueue(bot, userId)) {
        console.log(`[queueMonitor] User ${userId} not in in-memory queue`);
        return { success: false, message: "User is no longer in the queue" };
    }
    
    // Check if admin already has an active chat
    if (bot.runningChats.has(adminId)) {
        return { 
            success: false, 
            message: "ADMIN_IN_CHAT"
        };
    }
    
    // Acquire mutex for thread-safe operation
    let locked = false;
    try {
        await bot.queueMutex.acquire();
        locked = true;
        
        console.log(`[queueMonitor] Acquired mutex, attempting atomic lock for user ${userId}`);
        
        // RACE CONDITION PROTECTION: Try to atomically lock user for connection
        const lockAcquired = await tryLockUserForConnection(userId);
        
        if (!lockAcquired) {
            // Another admin already took action - this is a race condition
            console.log(`[queueMonitor] Connection skipped due to race condition - user ${userId} already being connected`);
            return { success: false, message: "User already connecting or connected by another admin" };
        }
        
        console.log(`[queueMonitor] User ${userId} locked for connection successfully`);
        
        // Double-check user is still in queue after acquiring lock
        if (!isUserInQueue(bot, userId)) {
            // User was removed while we were acquiring lock - rollback the lock
            console.log(`[queueMonitor] User ${userId} no longer in queue after lock - rolling back`);
            await updateUser(userId, { queueStatus: "waiting" });
            return { success: false, message: "User is no longer in the queue" };
        }
        
        // Double-check admin still doesn't have a chat
        if (bot.runningChats.has(adminId)) {
            // Rollback the lock
            console.log(`[queueMonitor] Admin ${adminId} already in chat - rolling back lock`);
            await updateUser(userId, { queueStatus: "waiting" });
            return { 
                success: false, 
                message: "ADMIN_IN_CHAT"
            };
        }
        
        // Get user data for notifications
        const userData = await getUser(userId);
        if (!userData) {
            await updateUser(userId, { queueStatus: "waiting" });
            return { success: false, message: "User not found" };
        }
        
        // Check if user is already connected (edge case)
        if (userData.queueStatus === "connected") {
            console.log(`[queueMonitor] User ${userId} already connected - rolling back`);
            return { success: false, message: "User already connected" };
        }
        
        // Remove user from queue
        const removeResult = await safeRemoveFromQueue(bot, userId, adminId);
        if (!removeResult.success) {
            // Rollback the lock
            await updateUser(userId, { queueStatus: "waiting" });
            return { success: false, message: removeResult.message };
        }
        
        // Set up chat runtime (adds to runningChats, messageCountMap)
        await beginChatRuntime(bot, adminId, userId);
        
        // Update chat start time in database for both users
        const chatStartTime = Date.now();
        await updateUser(userId, { chatStartTime });
        await updateUser(adminId, { chatStartTime });
        
        // Mark both users as connected
        await markUserAsConnected(userId);
        await markUserAsConnected(adminId);
        
        // Send notification to the user - use normal match flow
        try {
            // First send the "Partner found" message
            const partnerFoundMessage = "🎉 Partner found!\n⏳ Connecting...";
            await bot.telegram.sendMessage(userId, partnerFoundMessage);
            await bot.telegram.sendMessage(adminId, partnerFoundMessage);
            
            // After delay, send the connection message (normal matchmaking flow)
            setTimeout(async () => {
                // Verify both users are still in chat
                if (!bot.runningChats.has(userId) || !bot.runningChats.has(adminId)) {
                    return;
                }
                try {
                    await bot.telegram.sendMessage(userId, "💬 You are now connected. Say hi!");
                    await bot.telegram.sendMessage(adminId, "💬 You are now connected. Say hi!");
                } catch {
                    // Silently ignore if users blocked bot
                }
            }, 1200);
        } catch (error) {
            console.error("[queueMonitor] Failed to notify user:", getErrorMessage(error));
        }
        
        // Log success
        console.log(`[queueMonitor] Connection success: Admin ${adminId} connected to user ${userId}`);
        
        return { success: true, message: `Connected to user ${userId}` };
    } catch (error) {
        console.error("[queueMonitor] Failed to connect admin to user:", getErrorMessage(error));
        // Attempt rollback on error - only if user is still in "connecting" state
        try {
            const currentUser = await getUser(userId);
            if (currentUser?.queueStatus === "connecting") {
                await updateUser(userId, { queueStatus: "waiting" });
                console.log(`[queueMonitor] Rolled back user ${userId} to waiting state after error`);
            } else {
                console.log(`[queueMonitor] Skipped rollback for user ${userId}: status is now "${currentUser?.queueStatus || 'unknown'}"`);
            }
        } catch (rollbackError) {
            console.error("[queueMonitor] Rollback failed:", getErrorMessage(rollbackError));
        }
        return { success: false, message: "Failed to connect to user" };
    } finally {
        if (locked) {
            bot.queueMutex.release();
        }
    }
}

// ==================== UI Handlers ====================

const backKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🔙 Back to Menu", "ADMIN_BACK")]
]);

/**
 * Display queue monitor in admin panel.
 */
export async function showQueueMonitor(ctx: Context, bot: ExtraTelegraf): Promise<void> {
    // Admin validation using context-based check
    if (!isAdminContext(ctx)) {
        await unauthorizedResponse(ctx, "Unauthorized");
        return;
    }
    
    const adminId = ctx.from?.id;
    if (!adminId) return;
    
    try {
        await safeAnswerCbQuery(ctx);
        
        const stats = getQueueStats(bot);
        // Get queue details from DB for accurate/preference data
        const details = await getQueueDetails(bot);
        
        console.log(`[queueMonitor] Refresh: Stats - waiting: ${stats.waitingCount}, premium: ${stats.premiumCount}, total: ${stats.totalInQueue}`);
        
        if (stats.totalInQueue === 0) {
            await safeEditMessageText(
                ctx,
                "🔄 *Queue Monitor*\n\n" +
                "Current queue status:\n" +
                `• Waiting: ${stats.waitingCount}\n` +
                `• Premium: ${stats.premiumCount}\n` +
                `• Total: ${stats.totalInQueue}\n\n` +
                "The queue is currently empty.",
                { parse_mode: "Markdown", ...backKeyboard }
            );
            return;
        }
        
        // Build message with queue details
        let message = "🔄 *Queue Monitor*\n\n";
        message += `*Statistics:*\n`;
        message += `• Waiting: ${stats.waitingCount}\n`;
        message += `• Premium: ${stats.premiumCount}\n`;
        message += `• Total: ${stats.totalInQueue}\n\n`;
        
        // Show first few users from each queue (from DB data)
        if (details.waiting.length > 0) {
            message += "*Waiting Queue:*\n";
            const displayUsers = details.waiting.slice(0, 5);
            message += displayUsers.map((u: QueueUser, i: number) => 
                `${i + 1}. \`${u.id}\` - ${u.gender} → ${u.preference}`
            ).join("\n");
            if (details.waiting.length > 5) {
                message += `\n... and ${details.waiting.length - 5} more`;
            }
            message += "\n\n";
        }
        
        if (details.premium.length > 0) {
            message += "*Premium Queue:*\n";
            const displayUsers = details.premium.slice(0, 5);
            message += displayUsers.map((u: QueueUser, i: number) => 
                `${i + 1}. \`${u.id}\` 👑 - ${u.gender} → ${u.preference}`
            ).join("\n");
            if (details.premium.length > 5) {
                message += `\n... and ${details.premium.length - 5} more`;
            }
        }
        
        // Build keyboard with Connect and Remove buttons for first 5 users
        const keyboardRows = [];
        
        // Add Connect and Remove buttons for waiting queue
        for (const user of details.waiting.slice(0, 5)) {
            keyboardRows.push([
                Markup.button.callback(
                    `🔗 Connect ${user.id}`,
                    `ADMIN_QUEUE_CONNECT_${user.id}`
                ),
                Markup.button.callback(
                    `❌ Remove`,
                    `ADMIN_QUEUE_REMOVE_${user.id}`
                )
            ]);
        }
        
        // Add Connect and Remove buttons for premium queue
        for (const user of details.premium.slice(0, 5)) {
            keyboardRows.push([
                Markup.button.callback(
                    `🔗 Connect ${user.id} 👑`,
                    `ADMIN_QUEUE_CONNECT_${user.id}`
                ),
                Markup.button.callback(
                    `❌ Remove`,
                    `ADMIN_QUEUE_REMOVE_${user.id}`
                )
            ]);
        }
        
        keyboardRows.push([Markup.button.callback("🔄 Refresh", "ADMIN_QUEUE_MONITOR")]);
        keyboardRows.push([Markup.button.callback("🔙 Back to Menu", "ADMIN_BACK")]);
        
        await safeEditMessageText(
            ctx,
            message,
            { parse_mode: "Markdown", ...Markup.inlineKeyboard(keyboardRows) }
        );
    } catch (error) {
        console.error("[queueMonitor] showQueueMonitor error:", getErrorMessage(error));
        await safeAnswerCbQuery(ctx, "Error loading queue data");
    }
}

/**
 * Handle queue remove callback.
 * Uses race condition protection to prevent double removal.
 */
export async function handleQueueRemove(
    ctx: Context,
    bot: ExtraTelegraf,
    userId: number
): Promise<void> {
    // Admin validation using context-based check
    if (!isAdminContext(ctx)) {
        await unauthorizedResponse(ctx, "Unauthorized");
        return;
    }
    
    const adminId = ctx.from?.id;
    if (!adminId) return;
    
    try {
        await safeAnswerCbQuery(ctx);
        
        console.log(`[queueMonitor] Remove button clicked for user ${userId} by admin ${adminId}`);
        
        // RACE CONDITION PROTECTION: Check in-memory queue first
        if (!isUserInQueue(bot, userId)) {
            console.log(`[queueMonitor] Duplicate remove prevented: User ${userId} not in in-memory queue`);
            await safeAnswerCbQuery(ctx, "❌ User already removed");
            return;
        }
        
        // Fetch user from DB to check status
        const userData = await getUser(userId);
        if (!userData) {
            console.log(`[queueMonitor] User ${userId} not found in DB`);
            await safeAnswerCbQuery(ctx, "❌ User not found");
            return;
        }
        
        // Prevent removing users who are already connected
        if (userData.queueStatus === "connected") {
            console.log(`[queueMonitor] Prevented remove: User ${userId} is already connected`);
            await safeAnswerCbQuery(ctx, "❌ User already connected - cannot remove");
            return;
        }
        
        // Prevent removing users who are already being connected (in progress)
        if (userData.queueStatus === "connecting") {
            console.log(`[queueMonitor] Prevented remove: User ${userId} is being connected by another admin`);
            await safeAnswerCbQuery(ctx, "❌ User already connecting - please wait");
            return;
        }
        
        // Prevent removing users who are already marked as removed
        if (userData.queueStatus === "removed") {
            console.log(`[queueMonitor] Duplicate remove prevented: User ${userId} already marked as removed in DB`);
            // Also remove from in-memory queue to sync
            await safeRemoveFromQueue(bot, userId, adminId);
            await safeAnswerCbQuery(ctx, "❌ User already removed");
            await showQueueMonitor(ctx, bot);
            return;
        }
        
        // Proceed with removal - silently remove user (no notification)
        const result = await safeRemoveFromQueue(bot, userId, adminId);
        
        if (result.success) {
            // Mark as removed in DB
            await markUserAsRemoved(userId);
            console.log(`[queueMonitor] User ${userId} silently removed from queue by admin ${adminId}`);
            // Silently acknowledge - no visible message to user about admin action
            await safeAnswerCbQuery(ctx, `✅ User removed from queue`);
        } else {
            console.log(`[queueMonitor] Failed to remove user ${userId}: ${result.message}`);
            await safeAnswerCbQuery(ctx, `❌ ${result.message}`);
        }
        
        // Refresh the queue monitor
        await showQueueMonitor(ctx, bot);
    } catch (error) {
        console.error("[queueMonitor] handleQueueRemove error:", getErrorMessage(error));
        await safeAnswerCbQuery(ctx, "Error removing user");
    }
}

/**
 * Handle queue connect callback - connect admin with a queued user.
 * Uses race condition protection.
 */
export async function handleQueueConnect(
    ctx: Context,
    bot: ExtraTelegraf,
    userId: number
): Promise<void> {
    // Admin validation using context-based check
    if (!isAdminContext(ctx)) {
        await unauthorizedResponse(ctx, "Unauthorized");
        return;
    }
    
    const adminId = ctx.from?.id;
    if (!adminId) return;
    
    try {
        await safeAnswerCbQuery(ctx);
        
        console.log(`[queueMonitor] Connect button clicked for user ${userId} by admin ${adminId}`);
        
        // Edge case: Prevent connecting to self
        if (adminId === userId) {
            console.log(`[queueMonitor] Error: Admin ${adminId} tried to connect to themselves`);
            await safeAnswerCbQuery(ctx, "❌ Cannot connect to yourself");
            return;
        }
        
        // Check in-memory queue first
        if (!isUserInQueue(bot, userId)) {
            console.log(`[queueMonitor] User ${userId} not in in-memory queue`);
            await safeAnswerCbQuery(ctx, "❌ User not in queue");
            return;
        }
        
        // Fetch user from DB to check status
        const userData = await getUser(userId);
        if (!userData) {
            console.log(`[queueMonitor] User ${userId} not found in DB`);
            await safeAnswerCbQuery(ctx, "❌ User not found");
            return;
        }
        
        // Prevent connecting to already connected users
        if (userData.queueStatus === "connected") {
            console.log(`[queueMonitor] Prevented: User ${userId} is already connected`);
            await safeAnswerCbQuery(ctx, "❌ User already connected");
            return;
        }
        
        // Prevent connecting to users already being connected
        if (userData.queueStatus === "connecting") {
            console.log(`[queueMonitor] Prevented: User ${userId} is being connected by another admin`);
            await safeAnswerCbQuery(ctx, "❌ User already connecting - please wait");
            return;
        }
        
        const result = await connectAdminToUser(ctx, bot, adminId, userId);
        
        if (result.success) {
            console.log(`[queueMonitor] Successfully connected admin ${adminId} to user ${userId}`);
            await safeAnswerCbQuery(ctx, `✅ ${result.message}`);
            // Show the admin that they're now in a chat
            await ctx.reply(
                `You are now connected to user ${userId}. Use /next to find a new chat or /end to end this chat.`
            );
        } else if (result.message === "ADMIN_IN_CHAT") {
            // Admin already has an active chat - ask for confirmation
            console.log(`[queueMonitor] Admin ${adminId} already in chat, asking for confirmation`);
            const confirmKeyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback("Yes, disconnect and connect", `ADMIN_QUEUE_CONNECT_CONFIRM_${userId}`),
                    Markup.button.callback("Cancel", "ADMIN_QUEUE_MONITOR")
                ]
            ]);
            await safeEditMessageText(
                ctx,
                "⚠️ You already have an active chat.\n\nDo you want to disconnect and connect to this user?",
                { reply_markup: confirmKeyboard }
            );
        } else {
            console.log(`[queueMonitor] Failed to connect to user ${userId}: ${result.message}`);
            await safeAnswerCbQuery(ctx, `❌ ${result.message}`);
            // Refresh the queue monitor
            await showQueueMonitor(ctx, bot);
        }
    } catch (error) {
        console.error("[queueMonitor] handleQueueConnect error:", getErrorMessage(error));
        await safeAnswerCbQuery(ctx, "Error connecting to user");
    }
}

/**
 * Handle queue connect confirmation - when admin confirms to disconnect and connect.
 */
export async function handleQueueConnectConfirm(
    ctx: Context,
    bot: ExtraTelegraf,
    userId: number
): Promise<void> {
    // Admin validation using context-based check
    if (!isAdminContext(ctx)) {
        await unauthorizedResponse(ctx, "Unauthorized");
        return;
    }
    
    const adminId = ctx.from?.id;
    if (!adminId) return;
    
    try {
        await safeAnswerCbQuery(ctx);
        
        // First, end the current admin chat if exists
        const currentPartner = bot.runningChats.get(adminId);
        if (currentPartner) {
            // Remove from running chats
            bot.runningChats.delete(adminId);
            bot.runningChats.delete(currentPartner);
            bot.messageCountMap.delete(adminId);
            bot.messageCountMap.delete(currentPartner);
            
            // Clear chatStartTime in database for partner to prevent inconsistent state
            const { updateUser } = await import("../storage/db");
            await updateUser(currentPartner, { chatStartTime: null });
            
            // Notify the admin they have been disconnected
            await ctx.reply("You have been disconnected from the previous chat.");
            
            // Notify the partner
            try {
                await bot.telegram.sendMessage(
                    currentPartner,
                    "The admin has ended the chat to connect with another user."
                );
            } catch {
                // Ignore if can't notify
            }
        }
        
        // Now try to connect to the new user
        const result = await connectAdminToUser(ctx, bot, adminId, userId);
        
        if (result.success) {
            await safeAnswerCbQuery(ctx, `✅ ${result.message}`);
            await ctx.reply(
                `You are now connected to user ${userId}. Use /next to find a new chat or /end to end this chat.`
            );
        } else {
            await safeAnswerCbQuery(ctx, `❌ ${result.message}`);
            await showQueueMonitor(ctx, bot);
        }
    } catch (error) {
        console.error("[queueMonitor] handleQueueConnectConfirm error:", getErrorMessage(error));
        await safeAnswerCbQuery(ctx, "Error connecting to user");
    }
}

/**
 * Handle queue monitor callback.
 */
export async function handleQueueMonitor(ctx: Context, bot: ExtraTelegraf): Promise<void> {
    await showQueueMonitor(ctx, bot);
}
