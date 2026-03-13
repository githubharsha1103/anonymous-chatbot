/**
 * Bot Health Dashboard Module
 * 
 * Read-only metrics display using existing web server health endpoints.
 * Provides real-time view of bot health status.
 * 
 * Dependencies:
 * - src/Utils/adminAuth.ts - Admin validation
 * - src/Utils/telegramUi.ts - Safe UI functions
 * - src/storage/db.ts - Database status functions
 * - src/server/webServer.ts - Health endpoints
 */

import { Context, Markup } from "telegraf";
import { isAdminContext, unauthorizedResponse } from "../Utils/adminAuth";
import { safeAnswerCbQuery, safeEditMessageText, getErrorMessage } from "../Utils/telegramUi";
import { getDatabaseStatus, pingDatabase, getTotalChats, getAllUsers } from "../storage/db";
import os from "os";

// Track CPU usage between calls
let lastCpuInfo: { total: number; idle: number } | null = null;
let lastCpuTime = 0;

function getCpuUsage(): number {
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;
    
    for (const cpu of cpus) {
        for (const type in cpu.times) {
            totalTick += cpu.times[type as keyof typeof cpu.times];
        }
        totalIdle += cpu.times.idle;
    }
    
    const now = Date.now();
    
    if (lastCpuInfo && lastCpuTime) {
        const totalTickDiff = totalTick - lastCpuInfo.total;
        const idleDiff = totalIdle - lastCpuInfo.idle;
        const cpuPercent = totalTickDiff > 0 
            ? Math.round((1 - idleDiff / totalTickDiff) * 100) 
            : 0;
        
        lastCpuInfo = { total: totalTick, idle: totalIdle };
        lastCpuTime = now;
        
        return Math.max(0, Math.min(100, cpuPercent));
    }
    
    lastCpuInfo = { total: totalTick, idle: totalIdle };
    lastCpuTime = now;
    return 0;
}

// ==================== Types ====================

export interface HealthMetrics {
    status: "OK" | "DEGRADED" | "ERROR";
    database: {
        mode: string;
        healthy: boolean;
        mongoConnected: boolean;
    };
    uptime: number;
    timestamp: string;
}

export interface BotResourceInfo {
    uptime: number;
    memoryUsage: {
        heapUsed: number;
        heapTotal: number;
        rss: number;
        external: number;
    };
    cpuUsage: number;
}

// ==================== Core Functions ====================

/**
 * Fetch health metrics from database and system.
 */
export async function getHealthMetrics(): Promise<HealthMetrics> {
    const dbStatus = getDatabaseStatus();
    
    // Try to verify MongoDB connection if configured
    let mongoConnected = false;
    if (dbStatus.mode === "mongodb") {
        try {
            mongoConnected = await pingDatabase();
        } catch {
            mongoConnected = false;
        }
    }
    
    const healthy = dbStatus.mode === "mongodb"
        ? (dbStatus.healthy && mongoConnected)
        : dbStatus.healthy;
    
    return {
        status: healthy ? "OK" : "DEGRADED",
        database: {
            mode: dbStatus.mode,
            healthy: dbStatus.healthy,
            mongoConnected
        },
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    };
}

/**
 * Get bot resource information.
 */
export function getBotResourceInfo(): BotResourceInfo {
    const memUsage = process.memoryUsage();
    
    return {
        uptime: process.uptime(),
        memoryUsage: {
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
            rss: Math.round(memUsage.rss / 1024 / 1024), // MB
            external: Math.round(memUsage.external / 1024 / 1024) // MB
        },
        cpuUsage: getCpuUsage()
    };
}

/**
 * Get additional bot statistics.
 */
export async function getBotStats(): Promise<{
    totalUsers: number;
    totalChats: number;
    queueSize: number;
}> {
    try {
        const [users, chats] = await Promise.all([
            getAllUsers(),
            getTotalChats()
        ]);
        
        return {
            totalUsers: users.length,
            totalChats: chats,
            queueSize: 0 // Will be populated by queueMonitor if needed
        };
    } catch (error) {
        console.error("[dashboard] Failed to get bot stats:", getErrorMessage(error));
        return {
            totalUsers: 0,
            totalChats: 0,
            queueSize: 0
        };
    }
}

// ==================== UI Handlers ====================

const backKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🔄 Refresh", "ADMIN_HEALTH_DASHBOARD")],
    [Markup.button.callback("🔙 Back to Menu", "ADMIN_BACK")]
]);

/**
 * Format uptime in human-readable format.
 */
function formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
    
    return parts.join(" ");
}

/**
 * Format memory in human-readable format.
 */
function formatMemory(mb: number): string {
    if (mb >= 1024) {
        return `${(mb / 1024).toFixed(2)} GB`;
    }
    return `${mb} MB`;
}

/**
 * Display health dashboard in admin panel.
 */
export async function showHealthDashboard(ctx: Context): Promise<void> {
    // Admin validation using context-based check
    if (!isAdminContext(ctx)) {
        await unauthorizedResponse(ctx, "Unauthorized");
        return;
    }
    
    const adminId = ctx.from?.id;
    if (!adminId) return;
    
    try {
        await safeAnswerCbQuery(ctx);
        
        // Gather all metrics in parallel
        const [health, resources, stats] = await Promise.all([
            getHealthMetrics(),
            Promise.resolve(getBotResourceInfo()),
            getBotStats()
        ]);
        
        // Format the status message
        const statusEmoji = health.status === "OK" ? "✅" : "⚠️";
        const dbStatus = health.database.mongoConnected ? "🟢 Connected" : "🔴 Disconnected";
        
        const message = 
            `📊 *Bot Health Dashboard*\n\n` +
            `${statusEmoji} *Status:* ${health.status}\n\n` +
            `*Database:*\n` +
            `  Mode: \`${health.database.mode}\`\n` +
            `  Connection: ${dbStatus}\n\n` +
            `*Resources:*\n` +
            `  Uptime: ${formatUptime(resources.uptime)}\n` +
            `  Heap Used: ${formatMemory(resources.memoryUsage.heapUsed)}\n` +
            `  Heap Total: ${formatMemory(resources.memoryUsage.heapTotal)}\n` +
            `  RSS: ${formatMemory(resources.memoryUsage.rss)}\n\n` +
            `*Statistics:*\n` +
            `  Total Users: ${stats.totalUsers}\n` +
            `  Total Chats: ${stats.totalChats}\n\n` +
            `_Last updated: ${new Date(health.timestamp).toLocaleString()}_`;
        
        await safeEditMessageText(
            ctx,
            message,
            { parse_mode: "Markdown", ...backKeyboard }
        );
    } catch (error) {
        console.error("[dashboard] showHealthDashboard error:", getErrorMessage(error));
        await safeAnswerCbQuery(ctx, "Error loading health data");
    }
}

/**
 * Handle health dashboard callback.
 */
export async function handleHealthDashboard(ctx: Context): Promise<void> {
    await showHealthDashboard(ctx);
}
