/**
 * Revenue Analytics Dashboard Module
 * 
 * Read-only payment analytics with time-based revenue aggregation.
 * Provides insights into payment trends and premium subscriptions.
 * 
 * Dependencies:
 * - src/Utils/adminAuth.ts - Admin validation
 * - src/Utils/telegramUi.ts - Safe UI functions
 * - src/storage/db.ts - Database functions
 * - src/Utils/starsPayments.ts - Payment analytics
 */

import { Context, Markup } from "telegraf";
import { isAdminContext, unauthorizedResponse } from "../Utils/adminAuth";
import { safeAnswerCbQuery, safeEditMessageText, getErrorMessage } from "../Utils/telegramUi";
import { 
    getPaymentOrders, 
    getPaymentOrderStats, 
    getPremiumUsers,
    getExpiringPremiumUsers 
} from "../storage/db";
import { getPaymentAnalytics } from "../Utils/starsPayments";

// ==================== Types ====================

export interface RevenueAnalytics {
    totalRevenue: number;
    totalOrders: number;
    completedOrders: number;
    pendingOrders: number;
    failedOrders: number;
    averageOrderValue: number;
    premiumUsersCount: number;
    expiringSoonCount: number;
    byPeriod: Record<string, { revenue: number; orders: number }>;
}

export interface RevenueTrend {
    date: string;
    revenue: number;
    orders: number;
}

// Telegram Stars conversion (1 Star = $0.01 USD approximately)
const STARS_TO_USD = 0.01;

// ==================== Core Functions ====================

/**
 * Get revenue analytics for a given time period.
 */
export async function getRevenueAnalytics(days: number = 30): Promise<RevenueAnalytics> {
    try {
        // Fetch data in parallel
        const [orderStats, , premiumUsers, expiringSoon] = await Promise.all([
            getPaymentOrderStats(),
            Promise.resolve(getPaymentAnalytics()),
            getPremiumUsers(0, 0), // Get total count
            getExpiringPremiumUsers(48, 100, 0) // Expiring within 48 hours
        ]);
        
        // Get recent orders for revenue calculation
        // Limit to 500 to avoid loading too many records
        const { orders } = await getPaymentOrders(0, 500);
        
        // Filter orders by date
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        
        const recentOrders = orders.filter(order => {
            const orderDate = new Date(order.createdAt);
            return orderDate >= cutoffDate && order.status === "paid";
        });
        
        // Calculate totals
        const completedOrders = recentOrders.filter(o => o.status === "paid");
        const totalRevenue = completedOrders.reduce((sum, order) => {
            return sum + (order.starsAmount || 0);
        }, 0);
        
        const averageOrderValue = completedOrders.length > 0 
            ? totalRevenue / completedOrders.length 
            : 0;
        
        // Group by period (day/week/month)
        const byPeriod: Record<string, { revenue: number; orders: number }> = {};
        
        for (const order of completedOrders) {
            const date = new Date(order.createdAt).toISOString().split("T")[0];
            if (!byPeriod[date]) {
                byPeriod[date] = { revenue: 0, orders: 0 };
            }
            byPeriod[date].revenue += order.starsAmount || 0;
            byPeriod[date].orders += 1;
        }
        
        return {
            totalRevenue,
            totalOrders: recentOrders.length,
            completedOrders: completedOrders.length,
            pendingOrders: orderStats.pending,
            failedOrders: orderStats.failed,
            averageOrderValue,
            premiumUsersCount: premiumUsers.total,
            expiringSoonCount: expiringSoon.total,
            byPeriod
        };
    } catch (error) {
        console.error("[revenueAnalytics] getRevenueAnalytics error:", getErrorMessage(error));
        return {
            totalRevenue: 0,
            totalOrders: 0,
            completedOrders: 0,
            pendingOrders: 0,
            failedOrders: 0,
            averageOrderValue: 0,
            premiumUsersCount: 0,
            expiringSoonCount: 0,
            byPeriod: {}
        };
    }
}

/**
 * Get payment trend data for charts.
 */
export async function getRevenueTrend(days: number): Promise<RevenueTrend[]> {
    try {
        // Limit to 500 to avoid loading too many records
        const { orders } = await getPaymentOrders(0, 500);
        
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        
        const trendMap = new Map<string, { revenue: number; orders: number }>();
        
        // Initialize all days
        for (let i = 0; i < days; i++) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split("T")[0];
            trendMap.set(dateStr, { revenue: 0, orders: 0 });
        }
        
        // Aggregate orders
        for (const order of orders) {
            const orderDate = new Date(order.createdAt);
            if (orderDate >= cutoffDate && order.status === "paid") {
                const dateStr = orderDate.toISOString().split("T")[0];
                const existing = trendMap.get(dateStr) || { revenue: 0, orders: 0 };
                existing.revenue += order.starsAmount || 0;
                existing.orders += 1;
                trendMap.set(dateStr, existing);
            }
        }
        
        // Convert to array, sorted by date
        return Array.from(trendMap.entries())
            .map(([date, data]) => ({
                date,
                revenue: data.revenue,
                orders: data.orders
            }))
            .sort((a, b) => a.date.localeCompare(b.date));
    } catch (error) {
        console.error("[revenueAnalytics] getRevenueTrend error:", getErrorMessage(error));
        return [];
    }
}

/**
 * Format revenue for display.
 */
function formatRevenue(stars: number): string {
    const usdValue = stars * STARS_TO_USD;
    return `${stars.toLocaleString()} ⭐ ($${usdValue.toFixed(2)})`;
}

// ==================== UI Handlers ====================

const backKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("7 Days", "ADMIN_REVENUE_PERIOD_7")],
    [Markup.button.callback("30 Days", "ADMIN_REVENUE_PERIOD_30")],
    [Markup.button.callback("90 Days", "ADMIN_REVENUE_PERIOD_90")],
    [Markup.button.callback("🔙 Back to Menu", "ADMIN_BACK")]
]);

/**
 * Display revenue dashboard in admin panel.
 */
export async function showRevenueDashboard(
    ctx: Context,
    days: number = 30
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
        
        const analytics = await getRevenueAnalytics(days);
        
        const periodLabel = days === 7 ? "7 days" : days === 30 ? "30 days" : "90 days";
        
        const message = 
            `💵 *Revenue Analytics*\n` +
            `*Period:* Last ${periodLabel}\n\n` +
            `*Overview:*\n` +
            `  💰 Total Revenue: ${formatRevenue(analytics.totalRevenue)}\n` +
            `  📦 Completed Orders: ${analytics.completedOrders}\n` +
            `  ⏳ Pending Orders: ${analytics.pendingOrders}\n` +
            `  ❌ Failed Orders: ${analytics.failedOrders}\n` +
            `  📊 Avg Order Value: ${formatRevenue(analytics.averageOrderValue)}\n\n` +
            `*Premium Status:*\n` +
            `  👑 Active Premium Users: ${analytics.premiumUsersCount}\n` +
            `  ⏰ Expiring Soon (48h): ${analytics.expiringSoonCount}\n\n` +
            `_Use buttons below to change time period_`;
        
        await safeEditMessageText(
            ctx,
            message,
            { parse_mode: "Markdown", ...backKeyboard }
        );
    } catch (error) {
        console.error("[revenueAnalytics] showRevenueDashboard error:", getErrorMessage(error));
        await safeAnswerCbQuery(ctx, "Error loading revenue data");
    }
}

/**
 * Handle revenue period callback.
 */
export async function handleRevenuePeriod(ctx: Context, days: number): Promise<void> {
    await showRevenueDashboard(ctx, days);
}

/**
 * Handle revenue dashboard callback.
 */
export async function handleRevenueDashboard(ctx: Context): Promise<void> {
    await showRevenueDashboard(ctx, 30);
}
