import { Context, Markup } from "telegraf";
import { ExtraTelegraf } from "../index";
import { isAdminContext, unauthorizedResponse } from "../Utils/adminAuth";
import { safeAnswerCbQuery, safeEditMessageText, getErrorMessage } from "../Utils/telegramUi";
import {
  getUsageAnalyticsSnapshot,
  getUser,
  getUserStats,
  type MatchAnalyticsRecord
} from "../storage/db";

type HourBucket = {
  hour: number;
  count: number;
};

export interface UsageAnalyticsMetrics {
  dailyActiveUsers: number;
  matchesLastHour: number;
  averageMatchesPerHour24h: number;
  averageChatDurationMs: number;
  dropOffRate: number | null;
  peakUsageTimes: HourBucket[];
  recentHourlyMatches: { label: string; count: number }[];
  queueInsights: {
    currentWaiting: number;
    currentPremiumWaiting: number;
    averageCurrentWaitMs: number;
    longestCurrentWaitMs: number;
    staleWaiters: number;
    recentAverageMatchWaitMs: number;
    alerts: string[];
  };
  dataFreshnessText: string;
}

const REFRESH_KEYBOARD = Markup.inlineKeyboard([
  [Markup.button.callback("Refresh", "ADMIN_ANALYTICS_DASHBOARD")],
  [Markup.button.callback("Back to Menu", "ADMIN_BACK")]
]);

function average(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  return Math.round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length);
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "0s";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function formatHourRange(hour: number): string {
  const start = hour % 24;
  const end = (hour + 1) % 24;
  const startLabel = start === 0 ? "12 AM" : start < 12 ? `${start} AM` : start === 12 ? "12 PM" : `${start - 12} PM`;
  const endLabel = end === 0 ? "12 AM" : end < 12 ? `${end} AM` : end === 12 ? "12 PM" : `${end - 12} PM`;
  return `${startLabel}-${endLabel}`;
}

function buildHourlyBuckets(matches: MatchAnalyticsRecord[], sinceMs: number): HourBucket[] {
  const buckets = new Map<number, number>();

  for (const match of matches) {
    if (match.matchedAt < sinceMs) continue;
    const hour = new Date(match.matchedAt).getHours();
    buckets.set(hour, (buckets.get(hour) || 0) + 1);
  }

  return Array.from(buckets.entries())
    .map(([hour, count]) => ({ hour, count }))
    .sort((a, b) => b.count - a.count || a.hour - b.hour);
}

function buildRecentHourSeries(matches: MatchAnalyticsRecord[], now: number): { label: string; count: number }[] {
  const results: { label: string; count: number }[] = [];

  for (let offset = 5; offset >= 0; offset--) {
    const bucketStart = new Date(now - offset * 60 * 60 * 1000);
    bucketStart.setMinutes(0, 0, 0);
    const bucketEnd = bucketStart.getTime() + 60 * 60 * 1000;
    const count = matches.filter(match => match.matchedAt >= bucketStart.getTime() && match.matchedAt < bucketEnd).length;

    results.push({
      label: formatHourRange(bucketStart.getHours()),
      count
    });
  }

  return results;
}

function buildQueueAlerts(input: {
  currentWaiting: number;
  currentPremiumWaiting: number;
  averageCurrentWaitMs: number;
  longestCurrentWaitMs: number;
  staleWaiters: number;
  recentAverageMatchWaitMs: number;
  matchesLastHour: number;
}): string[] {
  const alerts: string[] = [];

  if (input.currentWaiting + input.currentPremiumWaiting >= 8) {
    alerts.push("Queue depth is elevated right now.");
  }
  if (input.staleWaiters >= 3) {
    alerts.push("Multiple users have been waiting longer than 5 minutes.");
  }
  if (input.averageCurrentWaitMs >= 2 * 60 * 1000) {
    alerts.push("Average live queue wait is above 2 minutes.");
  }
  if (input.recentAverageMatchWaitMs >= 3 * 60 * 1000) {
    alerts.push("Recent match wait time trend is climbing.");
  }
  if (input.currentPremiumWaiting > 0 && input.matchesLastHour === 0) {
    alerts.push("Premium queue has pending users but no recent matches.");
  }
  if (alerts.length === 0) {
    alerts.push("No major queue bottlenecks detected.");
  }

  return alerts;
}

export async function collectUsageAnalyticsMetrics(bot: ExtraTelegraf): Promise<UsageAnalyticsMetrics> {
  const now = Date.now();
  const [userStats, snapshot] = await Promise.all([
    getUserStats(),
    getUsageAnalyticsSnapshot()
  ]);

  const last24hCutoff = now - 24 * 60 * 60 * 1000;
  const last7dCutoff = now - 7 * 24 * 60 * 60 * 1000;

  const last24hMatches = snapshot.matches.filter(match => match.matchedAt >= last24hCutoff);
  const last7dMatches = snapshot.matches.filter(match => match.matchedAt >= last7dCutoff);
  const last7dChats = snapshot.chats.filter(chat => chat.endedAt >= last7dCutoff);

  const queueUserIds = [
    ...bot.waitingQueue.map(user => user.id),
    ...bot.premiumQueue.map(user => user.id)
  ];
  const queueUsers = await Promise.all(queueUserIds.map(id => getUser(id)));
  const currentQueueWaits = queueUsers
    .map(user => user.queueJoinedAt ? now - user.queueJoinedAt : 0)
    .filter(waitMs => waitMs > 0);

  const recentMatchWaits = last24hMatches.flatMap(match => match.waitTimeMs).filter(waitMs => waitMs > 0);
  const averageChatDurationMs = average(last7dChats.map(chat => chat.durationMs));
  const dropOffRate = last7dChats.length > 0
    ? Math.round((last7dChats.filter(chat => chat.dropOff).length / last7dChats.length) * 100)
    : null;

  const matchesLastHour = snapshot.matches.filter(match => match.matchedAt >= now - 60 * 60 * 1000).length;
  const recentHourlyMatches = buildRecentHourSeries(last24hMatches, now);
  const peakUsageTimes = buildHourlyBuckets(last7dMatches, last7dCutoff).slice(0, 3);

  const queueInsights = {
    currentWaiting: bot.waitingQueue.length,
    currentPremiumWaiting: bot.premiumQueue.length,
    averageCurrentWaitMs: average(currentQueueWaits),
    longestCurrentWaitMs: currentQueueWaits.length > 0 ? Math.max(...currentQueueWaits) : 0,
    staleWaiters: currentQueueWaits.filter(wait => wait >= 5 * 60 * 1000).length,
    recentAverageMatchWaitMs: average(recentMatchWaits),
    alerts: buildQueueAlerts({
      currentWaiting: bot.waitingQueue.length,
      currentPremiumWaiting: bot.premiumQueue.length,
      averageCurrentWaitMs: average(currentQueueWaits),
      longestCurrentWaitMs: currentQueueWaits.length > 0 ? Math.max(...currentQueueWaits) : 0,
      staleWaiters: currentQueueWaits.filter(wait => wait >= 5 * 60 * 1000).length,
      recentAverageMatchWaitMs: average(recentMatchWaits),
      matchesLastHour
    })
  };

  const freshnessSource = Math.max(
    snapshot.updatedAt || 0,
    ...snapshot.matches.slice(-1).map(match => match.matchedAt),
    ...snapshot.chats.slice(-1).map(chat => chat.endedAt)
  );
  const dataFreshnessText = freshnessSource > 0
    ? new Date(freshnessSource).toLocaleString()
    : "Collecting first analytics events";

  return {
    dailyActiveUsers: userStats.activeToday,
    matchesLastHour,
    averageMatchesPerHour24h: Math.round((last24hMatches.length / 24) * 10) / 10,
    averageChatDurationMs,
    dropOffRate,
    peakUsageTimes,
    recentHourlyMatches,
    queueInsights,
    dataFreshnessText
  };
}

export function formatUsageAnalyticsMessage(metrics: UsageAnalyticsMetrics): string {
  const recentMatchesText = metrics.recentHourlyMatches
    .map(bucket => `  ${bucket.label}: ${bucket.count}`)
    .join("\n");

  const peakUsageText = metrics.peakUsageTimes.length > 0
    ? metrics.peakUsageTimes.map(bucket => `  ${formatHourRange(bucket.hour)} - ${bucket.count} matches`).join("\n")
    : "  No match history yet";

  const queueAlertsText = metrics.queueInsights.alerts
    .map(alert => `  - ${alert}`)
    .join("\n");

  return (
    `*Usage Analytics Dashboard*\n\n` +
    `*Core Metrics*\n` +
    `  Daily Active Users: ${metrics.dailyActiveUsers}\n` +
    `  Matches Last Hour: ${metrics.matchesLastHour}\n` +
    `  Avg Matches / Hour (24h): ${metrics.averageMatchesPerHour24h}\n` +
    `  Avg Chat Duration (7d): ${formatDuration(metrics.averageChatDurationMs)}\n` +
    `  Drop-off Rate (7d): ${metrics.dropOffRate === null ? "Not enough data" : `${metrics.dropOffRate}%`}\n\n` +
    `*Recent Match Activity*\n${recentMatchesText}\n\n` +
    `*Peak Usage Times (7d)*\n${peakUsageText}\n\n` +
    `*Queue Bottleneck Detection*\n` +
    `  Waiting Now: ${metrics.queueInsights.currentWaiting}\n` +
    `  Premium Waiting Now: ${metrics.queueInsights.currentPremiumWaiting}\n` +
    `  Avg Live Wait: ${formatDuration(metrics.queueInsights.averageCurrentWaitMs)}\n` +
    `  Longest Live Wait: ${formatDuration(metrics.queueInsights.longestCurrentWaitMs)}\n` +
    `  Stale Waiters (>5m): ${metrics.queueInsights.staleWaiters}\n` +
    `  Recent Avg Match Wait: ${formatDuration(metrics.queueInsights.recentAverageMatchWaitMs)}\n` +
    `  Alerts:\n${queueAlertsText}\n\n` +
    `_Last analytics event: ${metrics.dataFreshnessText}_`
  );
}

export async function showAnalyticsDashboard(ctx: Context, bot: ExtraTelegraf): Promise<void> {
  if (!isAdminContext(ctx)) {
    await unauthorizedResponse(ctx, "Unauthorized");
    return;
  }

  try {
    await safeAnswerCbQuery(ctx);
    const metrics = await collectUsageAnalyticsMetrics(bot);
    await safeEditMessageText(ctx, formatUsageAnalyticsMessage(metrics), {
      parse_mode: "Markdown",
      ...REFRESH_KEYBOARD
    });
  } catch (error) {
    console.error("[analyticsDashboard] showAnalyticsDashboard error:", getErrorMessage(error));
    await safeAnswerCbQuery(ctx, "Error loading analytics");
  }
}

export async function handleAnalyticsDashboard(ctx: Context, bot: ExtraTelegraf): Promise<void> {
  await showAnalyticsDashboard(ctx, bot);
}
