/**
 * Admin Audit Logging Module
 * 
 * Non-blocking logging for action tracking using in-memory storage.
 * This module provides audit trail for all admin actions.
 * 
 * Dependencies:
 * - src/Utils/adminAuth.ts - Admin validation
 * - src/Utils/telegramUi.ts - Safe UI functions
 */

import { Context, Markup } from "telegraf";
import { isAdminContext, unauthorizedResponse } from "../Utils/adminAuth";
import { safeAnswerCbQuery, safeEditMessageText, getErrorMessage } from "../Utils/telegramUi";
import { saveAdminLog as dbSaveAdminLog, getAdminLogs as dbGetAdminLogs } from "../storage/db"; // eslint-disable-line @typescript-eslint/no-unused-vars

// ==================== Types ====================

export type AdminAction = 
    | "ban" 
    | "unban" 
    | "temp_ban" 
    | "warn" 
    | "delete_user" 
    | "add_premium" 
    | "remove_premium" 
    | "extend_premium" 
    | "payment_refund" 
    | "settings_change" 
    | "queue_remove"
    | "broadcast"
    | "spectate_chat"
    | "terminate_chat"
    | "stop_spectating";

export interface AdminLogFilter {
    adminId?: number;
    action?: AdminAction;
    targetUserId?: number;
    startDate?: Date;
    endDate?: Date;
}

export interface AdminLog {
    id: string;
    adminId: number;
    action: AdminAction;
    targetUserId?: number;
    details?: Record<string, unknown>;
    timestamp: Date;
}

// In-memory storage for logs (with max size for memory efficiency)
const MAX_LOG_ENTRIES = 500;
const adminLogs: AdminLog[] = [];

// ==================== Core Logging Function ====================

/**
 * Log admin action to the audit log.
 * Uses setImmediate for non-blocking behavior.
 */
export async function logAdminAction(
    adminId: number,
    action: AdminAction,
    targetUserId?: number,
    details?: Record<string, unknown>
): Promise<void> {
    // Validate action type
    const validActions: AdminAction[] = [
        "ban", "unban", "temp_ban", "warn", "delete_user",
        "add_premium", "remove_premium", "extend_premium",
        "payment_refund", "settings_change", "queue_remove", "broadcast"
    ];
    
    if (!validActions.includes(action)) {
        console.error("[adminLogs] Invalid action type:", action);
        return;
    }
    
    // Use setImmediate for non-blocking logging
    setImmediate(() => {
        try {
            // Create log entry
            const logEntry: AdminLog = {
                id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                adminId,
                action,
                targetUserId,
                details,
                timestamp: new Date()
            };
            
            // Add to logs (with size limit)
            adminLogs.push(logEntry);
            
            // Also persist to database for durability
            dbSaveAdminLog({
                adminId,
                action,
                targetUserId,
                details,
                timestamp: Date.now()
            }).catch(err => console.error("[adminLogs] DB save failed:", err));
            
            // Trim old entries if over limit
            while (adminLogs.length > MAX_LOG_ENTRIES) {
                adminLogs.shift();
            }
            
            console.log(`[adminLogs] Logged: ${action} by admin ${adminId}`, {
                targetUserId,
                details
            });
        } catch (error) {
            console.error("[adminLogs] Failed to log action:", getErrorMessage(error));
        }
    });
}

// ==================== Query Functions ====================

/**
 * Get admin logs with pagination and optional filtering.
 */
export function getAdminLogs(
    page: number = 0,
    limit: number = 20,
    filter?: AdminLogFilter
): { logs: AdminLog[]; total: number } {
    try {
        // Filter logs
        let filteredLogs = [...adminLogs];
        
        if (filter) {
            if (filter.adminId) {
                filteredLogs = filteredLogs.filter(log => log.adminId === filter.adminId);
            }
            if (filter.action) {
                filteredLogs = filteredLogs.filter(log => log.action === filter.action);
            }
            if (filter.targetUserId) {
                filteredLogs = filteredLogs.filter(log => log.targetUserId === filter.targetUserId);
            }
            if (filter.startDate) {
                filteredLogs = filteredLogs.filter(log => log.timestamp >= filter.startDate!);
            }
            if (filter.endDate) {
                filteredLogs = filteredLogs.filter(log => log.timestamp <= filter.endDate!);
            }
        }
        
        // Sort by timestamp (newest first)
        filteredLogs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        
        // Paginate
        const total = filteredLogs.length;
        const start = page * limit;
        const paginatedLogs = filteredLogs.slice(start, start + limit);
        
        return { logs: paginatedLogs, total };
    } catch (error) {
        console.error("[adminLogs] Failed to get logs:", getErrorMessage(error));
        return { logs: [], total: 0 };
    }
}

/**
 * Get recent logs for a specific admin.
 */
export function getRecentAdminLogs(
    adminId: number,
    limit: number = 10
): AdminLog[] {
    try {
        return adminLogs
            .filter(log => log.adminId === adminId)
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
            .slice(0, limit);
    } catch (error) {
        console.error("[adminLogs] Failed to get recent logs:", getErrorMessage(error));
        return [];
    }
}

// ==================== UI Handlers ====================

// Pagination storage (in-memory for session state)
const logPages = new Map<number, number>();

const logsPerPage = 10;

/**
 * Display audit log viewer in admin panel.
 */
export async function showAdminLogs(ctx: Context, page: number = 0): Promise<void> {
    // Admin validation using context-based check
    if (!isAdminContext(ctx)) {
        await unauthorizedResponse(ctx, "Unauthorized");
        return;
    }
    
    const adminId = ctx.from?.id;
    if (!adminId) return;
    
    try {
        await safeAnswerCbQuery(ctx);
        
        const { logs, total } = getAdminLogs(page, logsPerPage);
        
        if (total === 0) {
            await safeEditMessageText(
                ctx,
                "📜 *Admin Audit Logs*\n\nNo audit logs found.",
                { 
                    parse_mode: "Markdown", 
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback("🔙 Back to Menu", "ADMIN_BACK")]
                    ])
                }
            );
            return;
        }
        
        const totalPages = Math.ceil(total / logsPerPage);
        const safePage = Math.min(Math.max(0, page), totalPages - 1);
        
        // Store current page
        logPages.set(adminId, safePage);
        
        // Format log entries for display
        const logEntries = logs.map((log, idx) => {
            const idx_ = safePage * logsPerPage + idx + 1;
            const date = log.timestamp.toLocaleString();
            const target = log.targetUserId ? ` → User: \`${log.targetUserId}\`` : "";
            return `${idx_}. \`${log.action}\` by \`${log.adminId}\`${target}\n   📅 ${date}`;
        }).join("\n\n");
        
        // Navigation buttons
        const navButtons = [];
        if (safePage > 0) {
            navButtons.push(Markup.button.callback("◀️ Prev", `ADMIN_AUDIT_LOGS_PAGE_${safePage - 1}`));
        }
        if (safePage < totalPages - 1) {
            navButtons.push(Markup.button.callback("Next ▶️", `ADMIN_AUDIT_LOGS_PAGE_${safePage + 1}`));
        }
        
        await safeEditMessageText(
            ctx,
            `📜 *Admin Audit Logs*\n\n` +
            `Total entries: ${total}\n` +
            `Page ${safePage + 1}/${totalPages}\n\n` +
            logEntries,
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    ...(navButtons.length > 0 ? [navButtons] : []),
                    [Markup.button.callback("🔄 Refresh", `ADMIN_AUDIT_LOGS_PAGE_${safePage}`)],
                    [Markup.button.callback("🔙 Back to Menu", "ADMIN_BACK")]
                ])
            }
        );
    } catch (error) {
        console.error("[adminLogs] showAdminLogs error:", getErrorMessage(error));
        await safeAnswerCbQuery(ctx, "Error loading logs");
    }
}

/**
 * Handle callback for audit log pagination.
 */
export async function handleAdminLogsPage(ctx: Context, page: number): Promise<void> {
    await showAdminLogs(ctx, page);
}

/**
 * Get log count for statistics.
 */
export function getLogCount(): number {
    return adminLogs.length;
}
