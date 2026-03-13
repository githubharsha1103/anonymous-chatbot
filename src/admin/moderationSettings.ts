/**
 * Auto Moderation Settings Module
 * 
 * Configuration for auto-warn, auto-temp-ban, auto-ban thresholds.
 * Stores settings using in-memory cache with existing db patterns.
 * 
 * Dependencies:
 * - src/Utils/adminAuth.ts - Admin validation
 * - src/Utils/telegramUi.ts - Safe UI functions
 * - src/admin/adminLogs.ts - Audit logging
 */

import { Context, Markup } from "telegraf";
import { isAdminContext, unauthorizedResponse } from "../Utils/adminAuth";
import { safeAnswerCbQuery, safeEditMessageText, getErrorMessage } from "../Utils/telegramUi";
import { logAdminAction } from "./adminLogs";
import { getSettings, saveSettings } from "../storage/db";

// ==================== Types ====================

export interface ModerationSettings {
    autoWarnThreshold: number;
    autoTempBanThreshold: number;
    autoBanThreshold: number;
    tempBanDurationMs: number;
    enabled: boolean;
    updatedBy?: number;
    updatedAt?: Date;
}

// Default settings
const DEFAULT_MODERATION_SETTINGS: ModerationSettings = {
    autoWarnThreshold: 3,
    autoTempBanThreshold: 5,
    autoBanThreshold: 10,
    tempBanDurationMs: 24 * 60 * 60 * 1000, // 24 hours
    enabled: true
};

// In-memory storage with database persistence
let cachedSettings: ModerationSettings = { ...DEFAULT_MODERATION_SETTINGS };
let settingsLoaded = false;

/**
 * Load moderation settings from database (called on bot startup)
 */
export async function loadModerationSettings(): Promise<void> {
    if (settingsLoaded) return;
    
    const saved = await getSettings<ModerationSettings>("moderation");
    if (saved) {
        cachedSettings = { ...DEFAULT_MODERATION_SETTINGS, ...saved };
    }
    settingsLoaded = true;
    console.log("[MODERATION] Settings loaded:", cachedSettings);
}

// ==================== Core Functions ====================

/**
 * Get current moderation settings.
 */
export function getModerationSettings(): ModerationSettings {
    return { ...cachedSettings };
}

/**
 * Update moderation settings.
 */
export async function updateModerationSettings(
    adminId: number,
    settings: Partial<ModerationSettings>
): Promise<{ success: boolean; message: string }> {
    try {
        // Validate settings
        if (settings.autoWarnThreshold !== undefined) {
            if (settings.autoWarnThreshold < 1 || settings.autoWarnThreshold > 100) {
                return { success: false, message: "autoWarnThreshold must be between 1 and 100" };
            }
        }
        
        if (settings.autoTempBanThreshold !== undefined) {
            if (settings.autoTempBanThreshold < 1 || settings.autoTempBanThreshold > 100) {
                return { success: false, message: "autoTempBanThreshold must be between 1 and 100" };
            }
        }
        
        if (settings.autoBanThreshold !== undefined) {
            if (settings.autoBanThreshold < 1 || settings.autoBanThreshold > 100) {
                return { success: false, message: "autoBanThreshold must be between 1 and 100" };
            }
        }
        
        if (settings.tempBanDurationMs !== undefined) {
            if (settings.tempBanDurationMs < 60000 || settings.tempBanDurationMs > 30 * 24 * 60 * 60 * 1000) {
                return { success: false, message: "tempBanDurationMs must be between 1 minute and 30 days" };
            }
        }
        
        // Update cached settings
        cachedSettings = {
            ...cachedSettings,
            ...settings,
            updatedBy: adminId,
            updatedAt: new Date()
        };
        
        // Persist to database
        await saveSettings("moderation", cachedSettings);
        
        // Log the action
        await logAdminAction(adminId, "settings_change", undefined, {
            category: "moderation",
            changes: settings
        });
        
        console.log(`[moderationSettings] Settings updated by admin ${adminId}:`, settings);
        
        return { success: true, message: "Settings updated successfully" };
    } catch (error) {
        console.error("[moderationSettings] Failed to update settings:", getErrorMessage(error));
        return { success: false, message: "Failed to update settings" };
    }
}

/**
 * Reset settings to defaults.
 */
export async function resetToDefaults(
    adminId: number
): Promise<{ success: boolean; message: string }> {
    try {
        cachedSettings = {
            ...DEFAULT_MODERATION_SETTINGS,
            updatedBy: adminId,
            updatedAt: new Date()
        };
        
        // Persist to database
        await saveSettings("moderation", cachedSettings);
        
        // Log the action
        await logAdminAction(adminId, "settings_change", undefined, {
            category: "moderation",
            action: "reset_to_defaults"
        });
        
        console.log(`[moderationSettings] Settings reset to defaults by admin ${adminId}`);
        
        return { success: true, message: "Settings reset to defaults" };
    } catch (error) {
        console.error("[moderationSettings] Failed to reset settings:", getErrorMessage(error));
        return { success: false, message: "Failed to reset settings" };
    }
}

// ==================== UI Handlers ====================

/**
 * Format duration in human-readable format.
 */
function formatDuration(ms: number): string {
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
        return `${days} day${days > 1 ? "s" : ""}`;
    } else if (hours > 0) {
        return `${hours} hour${hours > 1 ? "s" : ""}`;
    } else {
        return `${minutes} minute${minutes > 1 ? "s" : ""}`;
    }
}

/**
 * Display moderation settings panel.
 */
export async function showModerationSettings(ctx: Context): Promise<void> {
    // Admin validation using context-based check
    if (!isAdminContext(ctx)) {
        await unauthorizedResponse(ctx, "Unauthorized");
        return;
    }
    
    const adminId = ctx.from?.id;
    if (!adminId) return;
    
    try {
        await safeAnswerCbQuery(ctx);
        
        const settings = getModerationSettings();
        
        const enabledStatus = settings.enabled ? "✅ Enabled" : "❌ Disabled";
        
        const message = 
            `🛡️ *Auto Moderation Settings*\n\n` +
            `*Status:* ${enabledStatus}\n\n` +
            `*Thresholds:*\n` +
            `  ⚠️ Auto-Warn: ${settings.autoWarnThreshold} reports\n` +
            `  ⏱️ Auto-Temp-Ban: ${settings.autoTempBanThreshold} reports\n` +
            `  🚫 Auto-Ban: ${settings.autoBanThreshold} reports\n\n` +
            `*Temp Ban Duration:*\n` +
            `  ⏳ ${formatDuration(settings.tempBanDurationMs)}\n\n` +
            `_Use buttons below to modify settings_`;
        
        // Build keyboard with action buttons
        const keyboard = [
            [
                Markup.button.callback(
                    settings.enabled ? "⏸️ Disable" : "▶️ Enable",
                    "ADMIN_MODERATION_TOGGLE"
                )
            ],
            [
                Markup.button.callback("🔄 Reset to Defaults", "ADMIN_MODERATION_RESET")
            ],
            [
                Markup.button.callback("🔙 Back to Menu", "ADMIN_BACK")
            ]
        ];
        
        await safeEditMessageText(
            ctx,
            message,
            { parse_mode: "Markdown", ...Markup.inlineKeyboard(keyboard) }
        );
    } catch (error) {
        console.error("[moderationSettings] showModerationSettings error:", getErrorMessage(error));
        await safeAnswerCbQuery(ctx, "Error loading settings");
    }
}

/**
 * Handle moderation toggle callback.
 */
export async function handleModerationToggle(ctx: Context): Promise<void> {
    // Admin validation using context-based check
    if (!isAdminContext(ctx)) {
        await unauthorizedResponse(ctx, "Unauthorized");
        return;
    }
    
    const adminId = ctx.from?.id;
    if (!adminId) return;
    
    try {
        const settings = getModerationSettings();
        const newEnabled = !settings.enabled;
        
        const result = await updateModerationSettings(adminId, { enabled: newEnabled });
        
        if (result.success) {
            await safeAnswerCbQuery(ctx, newEnabled ? "✅ Moderation enabled" : "❌ Moderation disabled");
        } else {
            await safeAnswerCbQuery(ctx, `❌ ${result.message}`);
        }
        
        await showModerationSettings(ctx);
    } catch (error) {
        console.error("[moderationSettings] handleModerationToggle error:", getErrorMessage(error));
        await safeAnswerCbQuery(ctx, "Error updating settings");
    }
}

/**
 * Handle moderation reset callback.
 */
export async function handleModerationReset(ctx: Context): Promise<void> {
    // Admin validation using context-based check
    if (!isAdminContext(ctx)) {
        await unauthorizedResponse(ctx, "Unauthorized");
        return;
    }
    
    const adminId = ctx.from?.id;
    if (!adminId) return;
    
    try {
        const result = await resetToDefaults(adminId);
        
        if (result.success) {
            await safeAnswerCbQuery(ctx, "✅ Settings reset to defaults");
        } else {
            await safeAnswerCbQuery(ctx, `❌ ${result.message}`);
        }
        
        await showModerationSettings(ctx);
    } catch (error) {
        console.error("[moderationSettings] handleModerationReset error:", getErrorMessage(error));
        await safeAnswerCbQuery(ctx, "Error resetting settings");
    }
}

/**
 * Handle moderation settings callback.
 */
export async function handleModerationSettings(ctx: Context): Promise<void> {
    await showModerationSettings(ctx);
}
