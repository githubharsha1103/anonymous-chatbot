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
 * - src/admin/adminLogs.ts - Audit logging
 */

import { Context, Markup } from "telegraf";
import { ExtraTelegraf } from "../index";
import { isAdminContext, unauthorizedResponse } from "../Utils/adminAuth";
import { safeAnswerCbQuery, safeEditMessageText, getErrorMessage } from "../Utils/telegramUi";
import { logAdminAction } from "./adminLogs";

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
 * Get queue details for inspection.
 */
export function getQueueDetails(bot: ExtraTelegraf): QueueDetails {
    const waiting: QueueUser[] = bot.waitingQueue.map(user => ({
        id: user.id,
        gender: user.gender,
        preference: user.preference,
        isPremium: false
    }));
    
    const premium: QueueUser[] = bot.premiumQueue.map(user => ({
        id: user.id,
        gender: user.gender,
        preference: user.preference,
        isPremium: true
    }));
    
    return { waiting, premium };
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
        
        // Log the action
        await logAdminAction(adminId, "queue_remove", userId, {
            removedFrom: isInPremiumQueue ? "premium" : "waiting"
        });
        
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
        const details = getQueueDetails(bot);
        
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
        
        // Show first few users from each queue
        if (details.waiting.length > 0) {
            message += "*Waiting Queue:*\n";
            const displayUsers = details.waiting.slice(0, 5);
            message += displayUsers.map((u, i) => 
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
            message += displayUsers.map((u, i) => 
                `${i + 1}. \`${u.id}\` 👑 - ${u.gender} → ${u.preference}`
            ).join("\n");
            if (details.premium.length > 5) {
                message += `\n... and ${details.premium.length - 5} more`;
            }
        }
        
        // Build keyboard with remove buttons for first 5 users
        const keyboardRows = [];
        
        // Add remove buttons for waiting queue
        for (const user of details.waiting.slice(0, 5)) {
            keyboardRows.push([
                Markup.button.callback(
                    `❌ Remove ${user.id}`,
                    `ADMIN_QUEUE_REMOVE_${user.id}`
                )
            ]);
        }
        
        // Add remove buttons for premium queue
        for (const user of details.premium.slice(0, 5)) {
            keyboardRows.push([
                Markup.button.callback(
                    `❌ Remove ${user.id} 👑`,
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
        
        const result = await safeRemoveFromQueue(bot, userId, adminId);
        
        if (result.success) {
            await safeAnswerCbQuery(ctx, `✅ ${result.message}`);
        } else {
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
 * Handle queue monitor callback.
 */
export async function handleQueueMonitor(ctx: Context, bot: ExtraTelegraf): Promise<void> {
    await showQueueMonitor(ctx, bot);
}
