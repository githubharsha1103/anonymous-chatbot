/**
 * Spectate Chats Module
 * 
 * Real-time chat spectating for admins.
 * Allows admins to watch active ongoing chats without storing messages.
 * 
 * Features:
 * - List active chat sessions
 * - Spectate any active chat
 * - Multiple admins can spectate the same chat
 * - Real-time message forwarding (no storage)
 * - Stop spectating
 * 
 * REFACTORING SUMMARY (2024-03):
 * - Replaced `any` types with proper TypeScript interfaces (User from db.ts)
 * - Improved session active checks to prevent stale views - added verification
 *   at display time to handle race conditions when chats end during view
 * - Added proper typing for callback buttons and context matches
 * 
 * Dependencies:
 * - src/index.ts - ExtraTelegraf with runningChats and spectatingChats
 * - src/Utils/adminAuth.ts - Admin validation
 * - src/Utils/telegramUi.ts - Safe UI functions
 * - src/Utils/chatFlow.ts - Chat termination
 */

import { Context, Markup } from "telegraf";
import { ExtraTelegraf } from "../index";
import { isAdminContext, unauthorizedResponse } from "../Utils/adminAuth";
import { safeAnswerCbQuery, safeEditMessageText, getErrorMessage } from "../Utils/telegramUi";
import { logAdminAction } from "./adminLogs";
import { getUser, User } from "../storage/db";

// ==================== Types ====================

export interface ActiveChatSession {
    user1: number;
    user2: number;
    user1Name: string;
    user2Name: string;
    startTime?: number;
    messageCount?: number;
}

export interface SpectatorSession {
    sessionKey: string;
    user1: number;
    user2: number;
    adminIds: number[];
}

// ==================== Helper Functions ====================

/**
 * Format duration in milliseconds to human readable string
 */
function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

/**
 * Get all active chat sessions
 */
export function getActiveChats(bot: ExtraTelegraf): ActiveChatSession[] {
    const sessions: ActiveChatSession[] = [];
    
    // runningChats Map: userId -> partnerId
    // We need to find unique pairs
    const seenPairs = new Set<string>();
    
    for (const [userId, partnerId] of bot.runningChats) {
        if (!partnerId) continue;
        
        // Create consistent key (smaller ID first)
        const key = userId < partnerId ? `${userId}_${partnerId}` : `${partnerId}_${userId}`;
        
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);
        
        const [u1, u2] = key.split('_').map(Number);
        
        // Get user info for display
        // Note: In production, you'd cache this or fetch async
        sessions.push({
            user1: u1,
            user2: u2,
            user1Name: `User ${u1}`,
            user2Name: `User ${u2}`
        });
    }
    
    return sessions.slice(0, 10); // Limit to 10 sessions
}

/**
 * Get chat details for a specific session
 * Now returns properly typed User data instead of any
 */
export async function getChatDetails(user1: number, user2: number, bot: ExtraTelegraf): Promise<{
    user1Data: User | null;
    user2Data: User | null;
    duration: string;
    messageCount: number;
    isActive: boolean;  // Added: indicates if session is still active
}> {
    const [user1Data, user2Data] = await Promise.all([
        getUser(user1),
        getUser(user2)
    ]);
    
    // Calculate duration - only show if users are actually in active chat together
    const chatStartTime = user1Data?.chatStartTime || user2Data?.chatStartTime;
    let duration = "Unknown";
    
    // REFACTORING: Verify both users are in active chat before showing duration
    // This handles race conditions where chat might end between listing and viewing
    const user1Partner = bot.runningChats.get(user1);
    const user2Partner = bot.runningChats.get(user2);
    const isActive = user1Partner === user2 && user2Partner === user1;
    
    if (isActive && chatStartTime) {
        duration = formatDuration(Date.now() - chatStartTime);
    }
    
    // Get message counts (only if still active)
    const user1Messages = isActive ? (bot.messageCountMap.get(user1) || 0) : 0;
    const user2Messages = isActive ? (bot.messageCountMap.get(user2) || 0) : 0;
    
    return {
        user1Data,
        user2Data,
        duration,
        messageCount: user1Messages + user2Messages,
        isActive
    };
}

/**
 * Format user info for display
 * Now uses proper User | null type instead of any
 */
function formatUserInfo(userData: User | null, userId: number): string {
    const name = userData?.name || `User ${userId}`;
    // Handle null/undefined/empty gender properly - check for string type
    const gender = (typeof userData?.gender === 'string' && userData.gender.length > 0) 
        ? (userData.gender.charAt(0).toUpperCase() + userData.gender.slice(1)) 
        : "Not set";
    const age = userData?.age || "Not set";
    const state = userData?.state || "Not set";
    
    return `<b>${name}</b> (${userId})\n👤 Gender: ${gender} | Age: ${age} | 📍 ${state}`;
}

// ==================== Callback Registration ====================

/**
 * Register all spectate-related callbacks with the bot
 */
export function registerSpectateCallbacks(bot: ExtraTelegraf): void {
    const backKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback("🔙 Back to Menu", "ADMIN_BACK")]
    ]);
    
    // Show list of active chats to spectate
    bot.action("ADMIN_SPECTATE_CHATS", async (ctx: Context) => {
        try {
            if (!isAdminContext(ctx)) {
                await unauthorizedResponse(ctx, "Unauthorized");
                return;
            }
            await safeAnswerCbQuery(ctx);
            
            const activeChats = getActiveChats(bot);
            
            if (activeChats.length === 0) {
                await safeEditMessageText(
                    ctx,
                    "👀 *Spectate Chats*\n\nNo active chats at the moment.",
                    { parse_mode: "Markdown", ...backKeyboard }
                );
                return;
            }
            
            // Build keyboard with chat buttons
            // REFACTORING: Type-safe button array construction
            const chatButtons: Array<Array<ReturnType<typeof Markup.button.callback>>> = [];
            for (const chat of activeChats) {
                chatButtons.push([
                    Markup.button.callback(
                        `👀 ${chat.user1} ↔ ${chat.user2}`,
                        `ADMIN_SPECTATE_SESSION_${chat.user1}_${chat.user2}`
                    )
                ]);
            }
            
            const keyboard = Markup.inlineKeyboard([
                ...chatButtons,
                [Markup.button.callback("🔙 Back to Menu", "ADMIN_BACK")]
            ]);
            
            await safeEditMessageText(
                ctx,
                `👀 *Spectate Chats*\n\nTotal active: ${activeChats.length}\n\nSelect a chat to spectate:`,
                { parse_mode: "Markdown", ...keyboard }
            );
        } catch (error) {
            console.error("[ERROR] - ADMIN_SPECTATE_CHATS:", error);
            await safeEditMessageText(
                ctx,
                `❌ Error loading chats: ${getErrorMessage(error)}`,
                backKeyboard
            );
        }
    });
    
    // Spectate a specific chat session
    // REFACTORING: Improved session active check and proper context typing
    bot.action(/^ADMIN_SPECTATE_SESSION_(\d+)_(\d+)$/, async (ctx: Context) => {
        try {
            if (!isAdminContext(ctx)) {
                await unauthorizedResponse(ctx, "Unauthorized");
                return;
            }
            await safeAnswerCbQuery(ctx);
            
            // Properly type the regex match from callback query
            // Using type guard to safely access match property from regex actions
            const match = 'match' in ctx ? ctx.match as RegExpMatchArray : null;
            if (!match) {
                await safeEditMessageText(ctx, "❌ Invalid request", backKeyboard);
                return;
            }
            const user1 = parseInt(match[1]);
            const user2 = parseInt(match[2]);
            const adminId = ctx.from?.id;
            
            if (!adminId) return;
            
            // Verify chat is still active before spectating
            const actualPartner = bot.runningChats.get(user1);
            if (actualPartner !== user2) {
                await safeEditMessageText(
                    ctx,
                    "⚠️ This chat is no longer active.",
                    backKeyboard
                );
                return;
            }
            
            // Add admin as spectator
            bot.addSpectator(adminId, user1, user2);
            
            // Get chat details - now includes isActive flag
            const { user1Data, user2Data, duration, messageCount, isActive } = await getChatDetails(user1, user2, bot);
            
            // Handle case where session became inactive between check and display
            if (!isActive) {
                bot.removeSpectator(adminId); // Clean up the spectator we just added
                await safeEditMessageText(
                    ctx,
                    "⚠️ This chat is no longer active.",
                    backKeyboard
                );
                return;
            }
            
            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback("🛑 Terminate Chat", `ADMIN_TERMINATE_SESSION_${user1}_${user2}`)],
                [Markup.button.callback("❌ Stop Spectating", `ADMIN_STOP_SPECTATING`)]
            ]);
            
            await safeEditMessageText(
                ctx,
                `<b>👁️ Spectating Chat</b>\n\n` +
                `<b>User 1:</b>\n${formatUserInfo(user1Data, user1)}\n\n` +
                `<b>User 2:</b>\n${formatUserInfo(user2Data, user2)}\n\n` +
                `<b>⏱️ Duration:</b> ${duration}\n` +
                `<b>💬 Messages:</b> ${messageCount}\n\n` +
                `Messages from this chat will be forwarded here in real-time.\n\n` +
                `Use the buttons below to manage the chat.`,
                { parse_mode: "HTML", ...keyboard }
            );
            
            // Log the action - use user1 as target for logging purposes
            logAdminAction(adminId, "spectate_chat", user1);
        } catch (error) {
            console.error("[ERROR] - ADMIN_SPECTATE_SESSION:", error);
            await safeEditMessageText(
                ctx,
                `❌ Error: ${getErrorMessage(error)}`,
                backKeyboard
            );
        }
    });
    
    // Terminate a chat session (admin action)
    // REFACTORING: Proper context typing for regex match
    bot.action(/^ADMIN_TERMINATE_SESSION_(\d+)_(\d+)$/, async (ctx: Context) => {
        try {
            if (!isAdminContext(ctx)) {
                await unauthorizedResponse(ctx, "Unauthorized");
                return;
            }
            await safeAnswerCbQuery(ctx);
            
            // Properly type the regex match from callback query
            const match = 'match' in ctx ? ctx.match as RegExpMatchArray : null;
            if (!match) {
                await safeEditMessageText(ctx, "❌ Invalid request", backKeyboard);
                return;
            }
            const user1 = parseInt(match[1]);
            const user2 = parseInt(match[2]);
            const adminId = ctx.from?.id;
            
            if (!adminId) return;
            
            // Remove all spectators for this session
            // Note: Must collect IDs first, then remove (can't modify Map while iterating)
            const sessionKey = user1 < user2 ? `${user1}_${user2}` : `${user2}_${user1}`;
            const spectators = bot.spectatingChats.get(sessionKey);
            if (spectators) {
                // Collect IDs first to avoid modifying Map during iteration
                const spectatorIds = Array.from(spectators);
                for (const spectatorId of spectatorIds) {
                    bot.removeSpectator(spectatorId);
                }
            }
            
            // Import and use chat termination from chatFlow
            const { clearChatRuntime } = await import("../Utils/chatFlow");
            await clearChatRuntime(bot, user1, user2);
            
            // Update user states
            const { updateUser } = await import("../storage/db");
            await updateUser(user1, { chatStartTime: null });
            await updateUser(user2, { chatStartTime: null });
            
            // Notify both users that chat was terminated
            try {
                await ctx.telegram.sendMessage(user1, "⚠️ Your chat has been terminated by an administrator.");
            } catch {
                // User might have blocked the bot
            }
            
            try {
                await ctx.telegram.sendMessage(user2, "⚠️ Your chat has been terminated by an administrator.");
            } catch {
                // User might have blocked the bot
            }
            
            await safeEditMessageText(
                ctx,
                `<b>✅ Chat Terminated</b>\n\n` +
                `Chat between <code>${user1}</code> and <code>${user2}</code> has been ended.\n\n` +
                `Both users have been notified.`,
                backKeyboard
            );
            
            // Log the action
            logAdminAction(adminId, "terminate_chat", user1);
        } catch (error) {
            console.error("[ERROR] - ADMIN_TERMINATE_SESSION:", error);
            await safeEditMessageText(
                ctx,
                `❌ Error: ${getErrorMessage(error)}`,
                backKeyboard
            );
        }
    });
    
    // Stop spectating
    bot.action("ADMIN_STOP_SPECTATING", async (ctx: Context) => {
        try {
            if (!isAdminContext(ctx)) {
                await unauthorizedResponse(ctx, "Unauthorized");
                return;
            }
            await safeAnswerCbQuery(ctx);
            
            const adminId = ctx.from?.id;
            if (adminId) {
                bot.removeSpectator(adminId);
            }
            
            await safeEditMessageText(
                ctx,
                "👁️ Spectator Mode Exited.\n\nUse the button below to return to menu.",
                { parse_mode: "Markdown", ...backKeyboard }
            );
            
            // Log the action
            if (adminId) {
                logAdminAction(adminId, "stop_spectating");
            }
        } catch (error) {
            console.error("[ERROR] - ADMIN_STOP_SPECTATING:", error);
            await safeEditMessageText(
                ctx,
                `❌ Error: ${getErrorMessage(error)}`,
                backKeyboard
            );
        }
    });
}

// ==================== Exports ====================

// Note: Types are already exported via their interface declarations above
