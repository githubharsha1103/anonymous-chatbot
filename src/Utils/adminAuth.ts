/**
 * Shared Admin Authentication Utilities
 * This module provides centralized admin validation functions
 * to avoid code duplication across the codebase.
 * 
 * SECURITY NOTE: Only numeric Telegram IDs are trusted for admin authentication.
 * Username-based admin checks have been removed as they can be spoofed.
 */

const ADMINS = (process.env.ADMIN_IDS || "")
    .split(",")
    .map(id => id.trim())
    .filter(id => /^\d+$/.test(id));
const ADMIN_SET = new Set(ADMINS);

interface AdminContextLike {
    from?: { id?: number };
    callbackQuery?: { id?: string };
    answerCbQuery?: (text?: string) => Promise<unknown>;
}

// Export ADMINS for use in other modules
export { ADMINS };

/**
 * Check if a user ID is an admin (by numeric ID only)
 * This is the ONLY secure way to check admin status
 */
export function isAdmin(id: number): boolean {
    // Ensure id is a valid number
    if (!id || isNaN(id)) return false;
    return ADMIN_SET.has(id.toString());
}

/**
 * Validate if a user is an admin (numeric ID only)
 * Username-based checks have been removed for security
 */
export function validateAdmin(id: number, _username?: string): boolean {
    return isAdmin(id);
}

/**
 * Helper to extract admin validation check for Telegraf context
 * Only uses numeric ID - username is ignored for security
 */
export function isAdminContext(ctx: AdminContextLike): boolean {
    const userId = ctx.from?.id;
    if (!userId) return false;
    // Only trust numeric ID, ignore username completely
    return isAdmin(Number(userId));
}

/**
 * Create an unauthorized response for Telegraf callback queries
 */
export async function unauthorizedResponse(ctx: AdminContextLike, message: string = "Unauthorized"): Promise<void> {
    try {
        if (ctx.callbackQuery?.id && ctx.answerCbQuery) {
            await ctx.answerCbQuery(message);
        }
    } catch {
        // Ignore errors
    }
}
