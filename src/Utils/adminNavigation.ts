import { Context, Markup } from "telegraf";
import { ExtraTelegraf } from "../index";

/**
 * Admin main menu keyboard with all options
 */
const mainKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("👥 View All Users", "ADMIN_USERS")],
    [Markup.button.callback("🔍 Search by ID", "ADMIN_SEARCH_BY_ID")],
    [Markup.button.callback("🚫 View Bans", "ADMIN_BANS")],
    [Markup.button.callback("📊 Bot Statistics", "ADMIN_STATS")],
    [Markup.button.callback("💬 Active Chats", "ADMIN_ACTIVE_CHATS")],
    [Markup.button.callback("📢 Broadcast Message", "ADMIN_BROADCAST")],
    [Markup.button.callback("📣 Re-engagement", "ADMIN_REENGAGE")],
    [Markup.button.callback("📋 View Reports", "ADMIN_VIEW_REPORTS")],
    [Markup.button.callback("🔗 Referral Stats", "ADMIN_REFERRALS")],
    [Markup.button.callback("💰 Manage Payments", "ADMIN_PAYMENTS")],
    [Markup.button.callback("📊 Health Dashboard", "ADMIN_HEALTH_DASHBOARD")],
    [Markup.button.callback("📥 Queue Monitor", "ADMIN_QUEUE_MONITOR")],
    [Markup.button.callback("💰 Revenue Analytics", "ADMIN_REVENUE_DASHBOARD")],
    [Markup.button.callback("📜 Admin Audit Logs", "ADMIN_AUDIT_LOGS")],
    [Markup.button.callback("🛡 Moderation Settings", "ADMIN_MODERATION_SETTINGS")],
    [Markup.button.callback("👁 Spectate Chats", "ADMIN_SPECTATE_CHATS")]
]);

/**
 * Render the main admin panel menu
 * This is the centralized function for displaying the admin menu
 */
export async function renderAdminMenu(ctx: Context): Promise<void> {
    await ctx.reply(
        "🔐 *Admin Panel*\n\nWelcome, Admin!\n\nSelect an option below:",
        { parse_mode: "Markdown", ...mainKeyboard }
    );
}

/**
 * Get the main keyboard for use in other admin modules
 */
export function getMainKeyboard() {
    return mainKeyboard;
}

/**
 * Create a back button for admin modules
 */
export const adminBackKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🔙 Back to Menu", "ADMIN_BACK")]
]);

/**
 * Register admin navigation callbacks with the bot
 * This centralizes all admin navigation logic
 */
export function registerAdminNavigation(bot: ExtraTelegraf): void {
    // Centralized ADMIN_BACK handler - handles back navigation from all admin modules
    bot.action("ADMIN_BACK", async (ctx) => {
        try {
            // Answer the callback query to stop loading state
            await ctx.answerCbQuery();

            // Try to edit the existing message first
            try {
                await ctx.editMessageText(
                    "🔐 *Admin Panel*\n\nWelcome, Admin!\n\nSelect an option below:",
                    { parse_mode: "Markdown", ...mainKeyboard }
                );
            } catch (editError) {
                // If edit fails, try to delete and send new message
                const errorMsg = editError instanceof Error ? editError.message : String(editError);
                if (errorMsg.includes("message is not modified")) {
                    // Already at the menu, no need to do anything
                    return;
                }

                // Try to delete the message and send new one
                try {
                    if (ctx.callbackQuery?.message) {
                        await ctx.deleteMessage();
                    }
                } catch {
                    // Ignore if message can't be deleted
                }

                // Send new admin panel message
                await ctx.reply(
                    "🔐 *Admin Panel*\n\nWelcome, Admin!\n\nSelect an option below:",
                    { parse_mode: "Markdown", ...mainKeyboard }
                );
            }
        } catch (error) {
            console.error("[ADMIN_NAV] Failed to return to admin menu:", error);
            try {
                await ctx.answerCbQuery("Error returning to menu");
            } catch {
                // Ignore
            }
        }
    });
}
