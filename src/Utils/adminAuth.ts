/**
 * Shared Admin Authentication Utilities
 * This module provides centralized admin validation functions
 * to avoid code duplication across the codebase.
 */

const ADMINS = process.env.ADMIN_IDS?.split(",") || [];

// Export ADMINS for use in other modules
export { ADMINS };

/**
 * Check if a user ID is an admin (by numeric ID)
 */
export function isAdmin(id: number): boolean {
    return ADMINS.includes(id.toString());
}

/**
 * Check if a username is in the admin list (by username with @)
 */
export function isAdminByUsername(username: string | undefined): boolean {
    if (!username) return false;
    return ADMINS.some(admin => admin.startsWith("@") && admin.toLowerCase() === `@${username.toLowerCase()}`);
}

/**
 * Validate if a user is an admin (by ID or username)
 * Returns true if the user is authorized as admin
 */
export function validateAdmin(id: number, username?: string): boolean {
    return isAdmin(id) || isAdminByUsername(username);
}

/**
 * Helper to extract admin validation check for Telegraf context
 * Returns true if the ctx.from user is authorized as admin
 */
export function isAdminContext(ctx: any): boolean {
    const userId = ctx.from?.id;
    if (!userId) return false;
    return validateAdmin(userId, ctx.from?.username);
}

/**
 * Create an unauthorized response for Telegraf callback queries
 */
export async function unauthorizedResponse(ctx: any, message: string = "Unauthorized"): Promise<void> {
    try {
        if (ctx.callbackQuery?.id) {
            await ctx.answerCbQuery(message);
        }
    } catch {
        // Ignore errors
    }
}
