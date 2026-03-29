/**
 * Auto Moderation Settings Module
 * 
 * Configuration for auto-warn, auto-temp-ban, auto-ban thresholds.
 * Fully dynamic settings with database persistence.
 * 
 * Dependencies:
 * - src/Utils/adminAuth.ts - Admin validation
 * - src/Utils/telegramUi.ts - Safe UI functions
 * - src/storage/db.ts - Database functions
 */

import { Context, Markup } from "telegraf";
import { isAdminContext, unauthorizedResponse } from "../Utils/adminAuth";
import { safeAnswerCbQuery, safeEditMessageText, getErrorMessage } from "../Utils/telegramUi";

// ==================== Types ====================

export interface ModerationSettings {
    // New snake_case field names
    auto_warn_reports: number;
    auto_tempban_reports: number;
    auto_ban_reports: number;
    tempban_duration_hours: number;
    enabled: boolean;
    updated_at: number;
    updated_by?: number;
    
    // Legacy camelCase field names (for backward compatibility with existing database records)
    autoWarnThreshold?: number;
    autoTempBanThreshold?: number;
    autoBanThreshold?: number;
    tempBanDurationMs?: number;
}

// Default settings
const DEFAULT_MODERATION_SETTINGS: ModerationSettings = {
    auto_warn_reports: 3,
    auto_tempban_reports: 5,
    auto_ban_reports: 10,
    tempban_duration_hours: 24,
    enabled: true,
    updated_at: Date.now()
};

// In-memory storage with database persistence
let cachedSettings: ModerationSettings = { ...DEFAULT_MODERATION_SETTINGS };
let settingsLoaded = false;
const pendingEdits = new Map<number, "warn" | "tempban" | "ban" | "duration">();

// ==================== Database Functions ====================

// Database module types
interface DbModuleType {
    db: unknown;
    useMongoDB: unknown;
    isFallbackMode: unknown;
}

let dbConnection: unknown = null;
let mongoEnabled = false;
let fallbackMode = false;

// Import database connection info
async function initDbConnection(): Promise<void> {
    try {
        const dbModule = await import("../storage/db") as unknown as DbModuleType;
        dbConnection = dbModule.db;
        mongoEnabled = Boolean(dbModule.useMongoDB);
        fallbackMode = Boolean(dbModule.isFallbackMode);
    } catch (error) {
        console.error("[MODERATION] Failed to import db module:", error);
    }
}

/**
 * Load moderation settings from database (called on bot startup)
 */
export async function loadModerationSettings(): Promise<void> {
    if (settingsLoaded) return;
    
    await initDbConnection();
    
    if (!dbConnection || !mongoEnabled || fallbackMode) {
        // Use defaults if no database
        cachedSettings = { ...DEFAULT_MODERATION_SETTINGS };
        settingsLoaded = true;
        console.log("[MODERATION] Using default settings (no database)");
        return;
    }
    
    try {
        const db = dbConnection as { collection: (name: string) => {
            findOne: (query: Record<string, unknown>) => Promise<ModerationSettings | null>;
            insertOne: (doc: ModerationSettings) => Promise<{ insertedId: { toString: () => string } }>;
            updateOne: (query: Record<string, unknown>, update: Record<string, unknown>, options?: { upsert: boolean }) => Promise<{ modifiedCount: number }>;
        }};
        const collection = db.collection("moderation_settings");
        const result = await collection.findOne({});
        
        if (result) {
            // Handle migration from old camelCase field names to new snake_case
            cachedSettings = {
                auto_warn_reports: result.auto_warn_reports ?? result.autoWarnThreshold ?? DEFAULT_MODERATION_SETTINGS.auto_warn_reports,
                auto_tempban_reports: result.auto_tempban_reports ?? result.autoTempBanThreshold ?? DEFAULT_MODERATION_SETTINGS.auto_tempban_reports,
                auto_ban_reports: result.auto_ban_reports ?? result.autoBanThreshold ?? DEFAULT_MODERATION_SETTINGS.auto_ban_reports,
                // Convert ms to hours for old tempBanDurationMs field
                tempban_duration_hours: result.tempban_duration_hours ?? (result.tempBanDurationMs ? Math.round(result.tempBanDurationMs / (1000 * 60 * 60)) : undefined) ?? DEFAULT_MODERATION_SETTINGS.tempban_duration_hours,
                enabled: result.enabled ?? DEFAULT_MODERATION_SETTINGS.enabled,
                updated_at: result.updated_at ?? Date.now()
            };
            console.log("[MODERATION] Settings loaded from database:", cachedSettings);
        } else {
            // Insert default settings if not exist
            await collection.insertOne({
                ...DEFAULT_MODERATION_SETTINGS,
                updated_at: Date.now()
            });
            console.log("[MODERATION] Created default moderation settings in database");
        }
        
        settingsLoaded = true;
    } catch (error) {
        console.error("[MODERATION] Error loading settings:", error);
        cachedSettings = { ...DEFAULT_MODERATION_SETTINGS };
        settingsLoaded = true;
    }
}

/**
 * Save moderation settings to database
 */
async function saveModerationSettingsToDb(): Promise<void> {
    if (!dbConnection || !mongoEnabled || fallbackMode) {
        return;
    }
    
    try {
        const db = dbConnection as { collection: (name: string) => {
            findOne: (query: Record<string, unknown>) => Promise<ModerationSettings | null>;
            insertOne: (doc: ModerationSettings) => Promise<{ insertedId: { toString: () => string } }>;
            updateOne: (query: Record<string, unknown>, update: Record<string, unknown>, options?: { upsert: boolean }) => Promise<{ modifiedCount: number }>;
        }};
        const collection = db.collection("moderation_settings");
        await collection.updateOne(
            {},
            {
                $set: {
                    auto_warn_reports: cachedSettings.auto_warn_reports,
                    auto_tempban_reports: cachedSettings.auto_tempban_reports,
                    auto_ban_reports: cachedSettings.auto_ban_reports,
                    tempban_duration_hours: cachedSettings.tempban_duration_hours,
                    enabled: cachedSettings.enabled,
                    updated_at: Date.now()
                }
            },
            { upsert: true }
        );
    } catch (error) {
        console.error("[MODERATION] Error saving settings:", error);
    }
}

// ==================== Core Functions ====================

/**
 * Get current moderation settings.
 */
export function getModerationSettings(): ModerationSettings {
    return { ...cachedSettings };
}

/**
 * Check if moderation is enabled.
 */
export function isModerationEnabled(): boolean {
    return cachedSettings.enabled;
}

/**
 * Get auto warn threshold.
 */
export function getAutoWarnThreshold(): number {
    return cachedSettings.auto_warn_reports;
}

/**
 * Get auto temp ban threshold.
 */
export function getAutoTempBanThreshold(): number {
    return cachedSettings.auto_tempban_reports;
}

/**
 * Get auto ban threshold.
 */
export function getAutoBanThreshold(): number {
    return cachedSettings.auto_ban_reports;
}

/**
 * Get temp ban duration in hours.
 */
export function getTempBanDurationHours(): number {
    return cachedSettings.tempban_duration_hours;
}

/**
 * Get temp ban duration in milliseconds.
 */
export function getTempBanDurationMs(): number {
    return cachedSettings.tempban_duration_hours * 60 * 60 * 1000;
}

export function setPendingModerationEdit(adminId: number, type: "warn" | "tempban" | "ban" | "duration"): void {
    pendingEdits.set(adminId, type);
}

export function getPendingModerationEdit(adminId: number): "warn" | "tempban" | "ban" | "duration" | null {
    return pendingEdits.get(adminId) ?? null;
}

export function clearPendingModerationEdit(adminId: number): void {
    pendingEdits.delete(adminId);
}

/**
 * Validate settings with rule: Warn < TempBan < Ban
 */
function validateThresholds(
    warn?: number,
    tempBan?: number,
    ban?: number
): { valid: boolean; message: string } {
    // Get current values for comparison
    const currentW = cachedSettings.auto_warn_reports;
    const currentT = cachedSettings.auto_tempban_reports;
    const currentB = cachedSettings.auto_ban_reports;
    
    // Use new values if provided, otherwise use current values
    const w = warn ?? currentW;
    const t = tempBan ?? currentT;
    const b = ban ?? currentB;
    
    // Only validate if we're changing at least one threshold
    if (warn !== undefined || tempBan !== undefined || ban !== undefined) {
        // Check that warn < tempBan < ban
        if (!(w < t && t < b)) {
            return {
                valid: false,
                message: `Invalid threshold order. Warn (${w}) must be less than Temp Ban (${t}), and Temp Ban must be less than Ban (${b}).`
            };
        }
    }
    return { valid: true, message: "" };
}

/**
 * Update moderation settings with full validation.
 */
export async function updateModerationSettings(
    adminId: number,
    settings: Partial<ModerationSettings>,
    _oldSettings?: ModerationSettings
): Promise<{ success: boolean; message: string }> {
    try {
        const previousSettings = { ...cachedSettings };

        // Validate warn threshold: 1-20
        if (settings.auto_warn_reports !== undefined) {
            if (settings.auto_warn_reports < 1 || settings.auto_warn_reports > 20) {
                return { success: false, message: "Warn threshold must be between 1 and 20" };
            }
        }
        
        // Validate temp ban threshold: 2-50
        if (settings.auto_tempban_reports !== undefined) {
            if (settings.auto_tempban_reports < 2 || settings.auto_tempban_reports > 50) {
                return { success: false, message: "Temp Ban threshold must be between 2 and 50" };
            }
        }
        
        // Validate ban threshold: 3-100
        if (settings.auto_ban_reports !== undefined) {
            if (settings.auto_ban_reports < 3 || settings.auto_ban_reports > 100) {
                return { success: false, message: "Ban threshold must be between 3 and 100" };
            }
        }
        
        // Validate temp ban duration: 1-168 hours
        if (settings.tempban_duration_hours !== undefined) {
            if (settings.tempban_duration_hours < 1 || settings.tempban_duration_hours > 168) {
                return { success: false, message: "Temp Ban Duration must be between 1 and 168 hours (7 days)" };
            }
        }
        
        // Validate threshold order if multiple values provided
        const validation = validateThresholds(
            settings.auto_warn_reports,
            settings.auto_tempban_reports,
            settings.auto_ban_reports
        );
        
        if (!validation.valid) {
            return { success: false, message: validation.message };
        }
        
        // Update cached settings
        cachedSettings = {
            ...cachedSettings,
            ...settings,
            updated_by: adminId,
            updated_at: Date.now()
        };
        
        // Persist to database
        await saveModerationSettingsToDb();
        
        // Log the changes
        logSettingsChange(adminId, previousSettings, cachedSettings);
        
        return { success: true, message: "Settings updated successfully" };
    } catch (error) {
        console.error("[MODERATION] Failed to update settings:", getErrorMessage(error));
        return { success: false, message: "Failed to update settings" };
    }
}

/**
 * Log settings changes.
 */
function logSettingsChange(adminId: number, previousSettings: ModerationSettings, newSettings: ModerationSettings): void {
    const changes: string[] = [];
    
    if (previousSettings.auto_warn_reports !== newSettings.auto_warn_reports) {
        changes.push(`Warn: ${previousSettings.auto_warn_reports} → ${newSettings.auto_warn_reports}`);
    }
    if (previousSettings.auto_tempban_reports !== newSettings.auto_tempban_reports) {
        changes.push(`TempBan: ${previousSettings.auto_tempban_reports} → ${newSettings.auto_tempban_reports}`);
    }
    if (previousSettings.auto_ban_reports !== newSettings.auto_ban_reports) {
        changes.push(`Ban: ${previousSettings.auto_ban_reports} → ${newSettings.auto_ban_reports}`);
    }
    if (previousSettings.tempban_duration_hours !== newSettings.tempban_duration_hours) {
        changes.push(`Duration: ${previousSettings.tempban_duration_hours}h → ${newSettings.tempban_duration_hours}h`);
    }
    if (previousSettings.enabled !== newSettings.enabled) {
        changes.push(`Status: ${previousSettings.enabled ? "Enabled" : "Disabled"} → ${newSettings.enabled ? "Enabled" : "Disabled"}`);
    }
    
    if (changes.length > 0) {
        console.log(`[MODERATION] Admin ${adminId} updated settings:`, changes.join(", "));
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
            updated_by: adminId,
            updated_at: Date.now()
        };
        
        // Persist to database
        await saveModerationSettingsToDb();
        
        // Log the reset
        console.log(`[MODERATION] Admin ${adminId} reset settings to defaults`);
        
        return { success: true, message: "Settings reset to defaults" };
    } catch (error) {
        console.error("[MODERATION] Failed to reset settings:", getErrorMessage(error));
        return { success: false, message: "Failed to reset settings" };
    }
}

// ==================== UI Handlers ====================

/**
 * Format duration in human-readable format.
 */
function formatDuration(hours: number): string {
    if (hours >= 24) {
        const days = Math.floor(hours / 24);
        return `${days} day${days > 1 ? "s" : ""}`;
    } else if (hours > 1) {
        return `${hours} hours`;
    } else {
        return `${hours} hour`;
    }
}

/**
 * Display moderation settings panel with edit buttons.
 */
export async function showModerationSettings(ctx: Context): Promise<void> {
    // Admin validation using context-based check
    if (!isAdminContext(ctx)) {
        await unauthorizedResponse(ctx, "Unauthorized");
        return;
    }
    
    const adminId = ctx.from?.id;
    if (!adminId) return;
    clearPendingModerationEdit(adminId);
    
    try {
        await safeAnswerCbQuery(ctx);
        
        const settings = getModerationSettings();
        
        const enabledStatus = settings.enabled ? "✅ Enabled" : "❌ Disabled";
        
        const message = 
            `🛡️ *Auto Moderation Settings*\n\n` +
            `*Status:* ${enabledStatus}\n\n` +
            `*Thresholds:*\n` +
            `  ⚠️ Auto-Warn: ${settings.auto_warn_reports} reports\n` +
            `  ⏱️ Auto-Temp-Ban: ${settings.auto_tempban_reports} reports\n` +
            `  🚫 Auto-Ban: ${settings.auto_ban_reports} reports\n\n` +
            `*Temp Ban Duration:*\n` +
            `  ⏳ ${formatDuration(settings.tempban_duration_hours)}\n\n` +
            `_Use buttons below to modify settings_`;
        
        // Build keyboard with action buttons - now with edit options
        const keyboard = [
            [
                Markup.button.callback("✏️ Edit Warn Threshold", "ADMIN_MODERATION_EDIT_WARN"),
                Markup.button.callback("✏️ Edit Temp Ban Threshold", "ADMIN_MODERATION_EDIT_TEMPBAN")
            ],
            [
                Markup.button.callback("✏️ Edit Ban Threshold", "ADMIN_MODERATION_EDIT_BAN"),
                Markup.button.callback("✏️ Edit Duration", "ADMIN_MODERATION_EDIT_DURATION")
            ],
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
        console.error("[MODERATION] showModerationSettings error:", getErrorMessage(error));
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
        console.error("[MODERATION] handleModerationToggle error:", getErrorMessage(error));
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
        console.error("[MODERATION] handleModerationReset error:", getErrorMessage(error));
        await safeAnswerCbQuery(ctx, "Error resetting settings");
    }
}

/**
 * Handle moderation settings callback.
 */
export async function handleModerationSettings(ctx: Context): Promise<void> {
    await showModerationSettings(ctx);
}

// ==================== Edit Handlers ====================

/**
 * Ask for warn threshold input.
 */
export async function handleEditWarnThreshold(ctx: Context): Promise<void> {
    if (!isAdminContext(ctx)) {
        await unauthorizedResponse(ctx, "Unauthorized");
        return;
    }
    const adminId = ctx.from?.id;
    if (!adminId) return;
    
    try {
        await safeAnswerCbQuery(ctx);
        setPendingModerationEdit(adminId, "warn");
        
        const settings = getModerationSettings();
        
        await safeEditMessageText(
            ctx,
            `✏️ *Edit Warn Threshold*\n\n` +
            `Current value: ${settings.auto_warn_reports} reports\n\n` +
            `Enter new value (1-20):\n` +
            `_Minimum: 1, Maximum: 20_`,
            { 
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("🔙 Cancel", "ADMIN_MODERATION_SETTINGS")]
                ])
            }
        );
    } catch (error) {
        console.error("[MODERATION] handleEditWarnThreshold error:", getErrorMessage(error));
    }
}

/**
 * Ask for temp ban threshold input.
 */
export async function handleEditTempBanThreshold(ctx: Context): Promise<void> {
    if (!isAdminContext(ctx)) {
        await unauthorizedResponse(ctx, "Unauthorized");
        return;
    }
    const adminId = ctx.from?.id;
    if (!adminId) return;
    
    try {
        await safeAnswerCbQuery(ctx);
        setPendingModerationEdit(adminId, "tempban");
        
        const settings = getModerationSettings();
        
        await safeEditMessageText(
            ctx,
            `✏️ *Edit Temp Ban Threshold*\n\n` +
            `Current value: ${settings.auto_tempban_reports} reports\n\n` +
            `Enter new value (2-50):\n` +
            `_Minimum: 2, Maximum: 50_`,
            { 
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("🔙 Cancel", "ADMIN_MODERATION_SETTINGS")]
                ])
            }
        );
    } catch (error) {
        console.error("[MODERATION] handleEditTempBanThreshold error:", getErrorMessage(error));
    }
}

/**
 * Ask for ban threshold input.
 */
export async function handleEditBanThreshold(ctx: Context): Promise<void> {
    if (!isAdminContext(ctx)) {
        await unauthorizedResponse(ctx, "Unauthorized");
        return;
    }
    const adminId = ctx.from?.id;
    if (!adminId) return;
    
    try {
        await safeAnswerCbQuery(ctx);
        setPendingModerationEdit(adminId, "ban");
        
        const settings = getModerationSettings();
        
        await safeEditMessageText(
            ctx,
            `✏️ *Edit Ban Threshold*\n\n` +
            `Current value: ${settings.auto_ban_reports} reports\n\n` +
            `Enter new value (3-100):\n` +
            `_Minimum: 3, Maximum: 100_`,
            { 
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("🔙 Cancel", "ADMIN_MODERATION_SETTINGS")]
                ])
            }
        );
    } catch (error) {
        console.error("[MODERATION] handleEditBanThreshold error:", getErrorMessage(error));
    }
}

/**
 * Ask for temp ban duration input.
 */
export async function handleEditDuration(ctx: Context): Promise<void> {
    if (!isAdminContext(ctx)) {
        await unauthorizedResponse(ctx, "Unauthorized");
        return;
    }
    const adminId = ctx.from?.id;
    if (!adminId) return;
    
    try {
        await safeAnswerCbQuery(ctx);
        setPendingModerationEdit(adminId, "duration");
        
        const settings = getModerationSettings();
        
        await safeEditMessageText(
            ctx,
            `✏️ *Edit Temp Ban Duration*\n\n` +
            `Current value: ${formatDuration(settings.tempban_duration_hours)}\n\n` +
            `Enter new duration in hours:\n` +
            `_Examples: 12, 24, 48, 72_\n` +
            `_Minimum: 1 hour, Maximum: 168 hours (7 days)_`,
            { 
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("🔙 Cancel", "ADMIN_MODERATION_SETTINGS")]
                ])
            }
        );
    } catch (error) {
        console.error("[MODERATION] handleEditDuration error:", getErrorMessage(error));
    }
}

/**
 * Process threshold edit from text input.
 */
export async function processThresholdEdit(
    ctx: Context,
    value: string,
    type: "warn" | "tempban" | "ban" | "duration"
): Promise<boolean> {
    if (!isAdminContext(ctx)) {
        await unauthorizedResponse(ctx, "Unauthorized");
        return false;
    }
    
    const adminId = ctx.from?.id;
    if (!adminId) return false;
    
    const numValue = parseInt(value, 10);
    
    // Validate that it's a valid integer
    if (isNaN(numValue) || String(numValue) !== value.trim()) {
        await ctx.reply("Invalid number. Please enter a whole number.");
        return false;
    }
    
    let result: { success: boolean; message: string };
    
    switch (type) {
        case "warn":
            result = await updateModerationSettings(adminId, { auto_warn_reports: numValue });
            break;
        case "tempban":
            result = await updateModerationSettings(adminId, { auto_tempban_reports: numValue });
            break;
        case "ban":
            result = await updateModerationSettings(adminId, { auto_ban_reports: numValue });
            break;
        case "duration":
            result = await updateModerationSettings(adminId, { tempban_duration_hours: numValue });
            break;
        default:
            await ctx.reply("Invalid edit type.");
            return false;
    }
    
    if (result.success) {
        clearPendingModerationEdit(adminId);
        await ctx.reply(`✅ ${result.message}`);
        // Show the settings panel
        await showModerationSettings(ctx);
        return true;
    }

    await ctx.reply(`❌ ${result.message}`);
    return false;
}
