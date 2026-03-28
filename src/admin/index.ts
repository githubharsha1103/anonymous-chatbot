/**
 * Admin Modules Index
 * 
 * This module exports all admin sub-modules and provides callback registration
 * for integration with the main admin panel.
 * 
 * Modules:
 * - dashboard.ts - Bot health monitoring
 * - queueMonitor.ts - Matchmaking queue viewer
 * - revenueAnalytics.ts - Payment analytics
 * - moderationSettings.ts - Auto-moderation configuration
 */

import { Context } from "telegraf";
import { ExtraTelegraf } from "../index";
import { isAdminContext, unauthorizedResponse } from "../Utils/adminAuth";
import { safeAnswerCbQuery, getErrorMessage } from "../Utils/telegramUi";

// Export all modules
export * from "./dashboard";
export * from "./queueMonitor";
export * from "./revenueAnalytics";
export * from "./moderationSettings";

// Re-export types for convenience
export type { ModerationSettings } from "./moderationSettings";
export type { QueueStats, QueueUser, QueueDetails } from "./queueMonitor";
export type { RevenueAnalytics, RevenueTrend } from "./revenueAnalytics";
export type { HealthMetrics, BotResourceInfo } from "./dashboard";

// ==================== Callback Registration ====================

/**
 * Register all admin module callbacks with the bot.
 * Call this function during bot initialization.
 */
export function registerAdminCallbacks(bot: ExtraTelegraf): void {
    // Dashboard callbacks
    bot.action("ADMIN_HEALTH_DASHBOARD", async (ctx: Context) => {
        try {
            if (!isAdminContext(ctx)) {
                await unauthorizedResponse(ctx, "Unauthorized");
                return;
            }
            await safeAnswerCbQuery(ctx);
            const { showHealthDashboard } = await import("./dashboard");
            await showHealthDashboard(ctx);
        } catch (error) {
            console.error("[admin] ADMIN_HEALTH_DASHBOARD error:", getErrorMessage(error));
            await safeAnswerCbQuery(ctx, "Error loading dashboard");
        }
    });
    
    // Queue Monitor callbacks
    bot.action("ADMIN_QUEUE_MONITOR", async (ctx: Context) => {
        try {
            if (!isAdminContext(ctx)) {
                await unauthorizedResponse(ctx, "Unauthorized");
                return;
            }
            const { handleQueueMonitor } = await import("./queueMonitor");
            await handleQueueMonitor(ctx, bot);
        } catch (error) {
            console.error("[admin] ADMIN_QUEUE_MONITOR error:", getErrorMessage(error));
            await safeAnswerCbQuery(ctx, "Error loading queue");
        }
    });
    
    // Queue remove callback (regex pattern)
    bot.action(/^ADMIN_QUEUE_REMOVE_(\d+)$/, async (ctx: Context) => {
        try {
            const match = (ctx.callbackQuery as unknown as { match?: RegExpMatchArray })?.match;
            if (!match) return;
            const userId = parseInt(match[1], 10);
            
            if (!isAdminContext(ctx)) {
                await unauthorizedResponse(ctx, "Unauthorized");
                return;
            }
            
            await safeAnswerCbQuery(ctx);
            const { handleQueueRemove } = await import("./queueMonitor");
            await handleQueueRemove(ctx, bot, userId);
        } catch (error) {
            console.error("[admin] ADMIN_QUEUE_REMOVE error:", getErrorMessage(error));
            await safeAnswerCbQuery(ctx, "Error removing user");
        }
    });
    
    // Queue connect callback - connect admin with queued user
    bot.action(/^ADMIN_QUEUE_CONNECT_(\d+)$/, async (ctx: Context) => {
        try {
            const match = (ctx.callbackQuery as unknown as { match?: RegExpMatchArray })?.match;
            if (!match) return;
            const userId = parseInt(match[1], 10);
            
            if (!isAdminContext(ctx)) {
                await unauthorizedResponse(ctx, "Unauthorized");
                return;
            }
            
            await safeAnswerCbQuery(ctx);
            const { handleQueueConnect } = await import("./queueMonitor");
            await handleQueueConnect(ctx, bot, userId);
        } catch (error) {
            console.error("[admin] ADMIN_QUEUE_CONNECT error:", getErrorMessage(error));
            await safeAnswerCbQuery(ctx, "Error connecting to user");
        }
    });
    
    // Queue connect confirmation callback
    bot.action(/^ADMIN_QUEUE_CONNECT_CONFIRM_(\d+)$/, async (ctx: Context) => {
        try {
            const match = (ctx.callbackQuery as unknown as { match?: RegExpMatchArray })?.match;
            if (!match) return;
            const userId = parseInt(match[1], 10);
            
            if (!isAdminContext(ctx)) {
                await unauthorizedResponse(ctx, "Unauthorized");
                return;
            }
            
            await safeAnswerCbQuery(ctx);
            const { handleQueueConnectConfirm } = await import("./queueMonitor");
            await handleQueueConnectConfirm(ctx, bot, userId);
        } catch (error) {
            console.error("[admin] ADMIN_QUEUE_CONNECT_CONFIRM error:", getErrorMessage(error));
            await safeAnswerCbQuery(ctx, "Error connecting to user");
        }
    });
    
    // Revenue Analytics callbacks
    bot.action("ADMIN_REVENUE_DASHBOARD", async (ctx: Context) => {
        try {
            if (!isAdminContext(ctx)) {
                await unauthorizedResponse(ctx, "Unauthorized");
                return;
            }
            const { handleRevenueDashboard } = await import("./revenueAnalytics");
            await handleRevenueDashboard(ctx);
        } catch (error) {
            console.error("[admin] ADMIN_REVENUE_DASHBOARD error:", getErrorMessage(error));
            await safeAnswerCbQuery(ctx, "Error loading revenue");
        }
    });
    
    // Revenue period callbacks
    bot.action(/^ADMIN_REVENUE_PERIOD_(\d+)$/, async (ctx: Context) => {
        try {
            if (!isAdminContext(ctx)) {
                await unauthorizedResponse(ctx, "Unauthorized");
                return;
            }
            const match = (ctx.callbackQuery as unknown as { match?: RegExpMatchArray })?.match;
            if (!match) return;
            const days = parseInt(match[1], 10);
            
            const { handleRevenuePeriod } = await import("./revenueAnalytics");
            await handleRevenuePeriod(ctx, days);
        } catch (error) {
            console.error("[admin] ADMIN_REVENUE_PERIOD error:", getErrorMessage(error));
            await safeAnswerCbQuery(ctx, "Error loading revenue");
        }
    });
    
    // Moderation Settings callbacks
    bot.action("ADMIN_MODERATION_SETTINGS", async (ctx: Context) => {
        try {
            if (!isAdminContext(ctx)) {
                await unauthorizedResponse(ctx, "Unauthorized");
                return;
            }
            const { handleModerationSettings } = await import("./moderationSettings");
            await handleModerationSettings(ctx);
        } catch (error) {
            console.error("[admin] ADMIN_MODERATION_SETTINGS error:", getErrorMessage(error));
            await safeAnswerCbQuery(ctx, "Error loading settings");
        }
    });
    
    // Moderation toggle
    bot.action("ADMIN_MODERATION_TOGGLE", async (ctx: Context) => {
        try {
            if (!isAdminContext(ctx)) {
                await unauthorizedResponse(ctx, "Unauthorized");
                return;
            }
            const { handleModerationToggle } = await import("./moderationSettings");
            await handleModerationToggle(ctx);
        } catch (error) {
            console.error("[admin] ADMIN_MODERATION_TOGGLE error:", getErrorMessage(error));
            await safeAnswerCbQuery(ctx, "Error updating settings");
        }
    });
    
    // Moderation reset
    bot.action("ADMIN_MODERATION_RESET", async (ctx: Context) => {
        try {
            if (!isAdminContext(ctx)) {
                await unauthorizedResponse(ctx, "Unauthorized");
                return;
            }
            const { handleModerationReset } = await import("./moderationSettings");
            await handleModerationReset(ctx);
        } catch (error) {
            console.error("[admin] ADMIN_MODERATION_RESET error:", getErrorMessage(error));
            await safeAnswerCbQuery(ctx, "Error resetting settings");
        }
    });
    
    // Edit Warn Threshold
    bot.action("ADMIN_MODERATION_EDIT_WARN", async (ctx: Context) => {
        try {
            if (!isAdminContext(ctx)) {
                await unauthorizedResponse(ctx, "Unauthorized");
                return;
            }
            const { handleEditWarnThreshold } = await import("./moderationSettings");
            await handleEditWarnThreshold(ctx);
        } catch (error) {
            console.error("[admin] ADMIN_MODERATION_EDIT_WARN error:", getErrorMessage(error));
            await safeAnswerCbQuery(ctx, "Error loading editor");
        }
    });
    
    // Edit Temp Ban Threshold
    bot.action("ADMIN_MODERATION_EDIT_TEMPBAN", async (ctx: Context) => {
        try {
            if (!isAdminContext(ctx)) {
                await unauthorizedResponse(ctx, "Unauthorized");
                return;
            }
            const { handleEditTempBanThreshold } = await import("./moderationSettings");
            await handleEditTempBanThreshold(ctx);
        } catch (error) {
            console.error("[admin] ADMIN_MODERATION_EDIT_TEMPBAN error:", getErrorMessage(error));
            await safeAnswerCbQuery(ctx, "Error loading editor");
        }
    });
    
    // Edit Ban Threshold
    bot.action("ADMIN_MODERATION_EDIT_BAN", async (ctx: Context) => {
        try {
            if (!isAdminContext(ctx)) {
                await unauthorizedResponse(ctx, "Unauthorized");
                return;
            }
            const { handleEditBanThreshold } = await import("./moderationSettings");
            await handleEditBanThreshold(ctx);
        } catch (error) {
            console.error("[admin] ADMIN_MODERATION_EDIT_BAN error:", getErrorMessage(error));
            await safeAnswerCbQuery(ctx, "Error loading editor");
        }
    });
    
    // Edit Duration
    bot.action("ADMIN_MODERATION_EDIT_DURATION", async (ctx: Context) => {
        try {
            if (!isAdminContext(ctx)) {
                await unauthorizedResponse(ctx, "Unauthorized");
                return;
            }
            const { handleEditDuration } = await import("./moderationSettings");
            await handleEditDuration(ctx);
        } catch (error) {
            console.error("[admin] ADMIN_MODERATION_EDIT_DURATION error:", getErrorMessage(error));
            await safeAnswerCbQuery(ctx, "Error loading editor");
        }
    });
    
    console.log("[admin] Admin callbacks registered successfully");
}

/**
 * Add admin module buttons to the main menu keyboard.
 * Returns additional keyboard rows to be added to the main admin menu.
 */

