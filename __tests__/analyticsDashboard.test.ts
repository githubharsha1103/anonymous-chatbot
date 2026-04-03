// jest globals for TS compilation
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const describe: any;
declare const it: any;
declare const expect: any;
/// <reference types="jest" />

import { formatUsageAnalyticsMessage } from "../src/admin/analyticsDashboard";

describe("analyticsDashboard", () => {
  it("formats the dashboard message with all major sections", () => {
    const message = formatUsageAnalyticsMessage({
      dailyActiveUsers: 120,
      matchesLastHour: 7,
      averageMatchesPerHour24h: 5.5,
      averageChatDurationMs: 245000,
      dropOffRate: 18,
      peakUsageTimes: [
        { hour: 20, count: 14 },
        { hour: 21, count: 12 }
      ],
      recentHourlyMatches: [
        { label: "4 PM-5 PM", count: 2 },
        { label: "5 PM-6 PM", count: 3 },
        { label: "6 PM-7 PM", count: 4 },
        { label: "7 PM-8 PM", count: 5 },
        { label: "8 PM-9 PM", count: 6 },
        { label: "9 PM-10 PM", count: 7 }
      ],
      queueInsights: {
        currentWaiting: 8,
        currentPremiumWaiting: 2,
        averageCurrentWaitMs: 120000,
        longestCurrentWaitMs: 420000,
        staleWaiters: 3,
        recentAverageMatchWaitMs: 95000,
        alerts: ["Queue depth is elevated right now."]
      },
      dataFreshnessText: "4/4/2026, 10:15:00 PM"
    });

    expect(message).toContain("*Usage Analytics Dashboard*");
    expect(message).toContain("Daily Active Users: 120");
    expect(message).toContain("*Peak Usage Times (7d)*");
    expect(message).toContain("Queue depth is elevated right now.");
  });
});
