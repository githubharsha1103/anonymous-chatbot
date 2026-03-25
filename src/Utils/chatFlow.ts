import { Markup } from "telegraf";
import type { ExtraTelegraf } from "../index";

type PartnerProfile = {
    age?: string | null;
    gender?: string | null;
    state?: string | null;
};

export const exitChatKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🔍 Find New Partner", "START_SEARCH")],
    [Markup.button.callback("🚨 Report User", "OPEN_REPORT")],
    [Markup.button.callback("⛔ Block User", "BLOCK_LAST_PARTNER")]
]);

export function buildPartnerMatchMessage(viewerIsPremium: boolean, partner: PartnerProfile): string {
    const partnerGender = viewerIsPremium && partner.gender
        ? partner.gender.charAt(0).toUpperCase() + partner.gender.slice(1)
        : "🔒 Hidden";
    const partnerAge = partner.age || "Not Set";
    const partnerState = partner.state
        ? ` - ${partner.state.charAt(0).toUpperCase() + partner.state.slice(1)}`
        : "";

    return (
        "✅ Partner Matched\n\n" +
        `🔢 Age: ${partnerAge}\n` +
        `👥 Gender: ${partnerGender}\n` +
        `🌍 Country: 🇮🇳 India${partnerState}\n\n` +
        "🚫 Links are restricted\n" +
        "⏱️ Media sharing unlocked after 2 minutes\n\n" +
        "/end - Leave the chat"
    );
}

export function buildPartnerLeftMessage(durationText?: string, messageCount?: number): string {
    const details = durationText && typeof messageCount === "number"
        ? `\n💬 Chat Duration: ${durationText}\n💭 Messages Exchanged: ${messageCount}\n`
        : "";

    return (
        "🚫 Partner left the chat\n" +
        details +
        "\nHow was your chat experience?\n\n" +
        "Tap below to find a new partner, report, or block this user.\n\n" +
        "━━━━━━━━━━━━━━━━━\n" +
        "To report this chat:"
    );
}

export function buildSelfEndedMessage(durationText: string, messageCount: number): string {
    return (
        "👋 You ended the chat\n\n" +
        `💬 Chat Duration: ${durationText}\n` +
        `💭 Messages Exchanged: ${messageCount}\n\n` +
        "Ready for another conversation?\n\n" +
        "Tap below to find a new partner, report, or block this user.\n\n" +
        "━━━━━━━━━━━━━━━━━\n" +
        "To report this chat:"
    );
}

export function buildSelfSkippedMessage(): string {
    return (
        "👋 You left the chat\n\n" +
        "Finding a new partner for you...\n\n" +
        "You can also report this chat below if needed."
    );
}

export async function clearChatRuntime(bot: ExtraTelegraf, userId: number, partnerId: number | null): Promise<void> {
    // Use mutex to prevent race conditions when clearing chat runtime
    // Wrap in try/finally to ensure cleanup always runs
    try {
        await bot.withChatStateLock(async () => {
            const ids = [userId, partnerId].filter((value): value is number => typeof value === "number");

            for (const id of ids) {
                bot.runningChats.delete(id);
                bot.messageMap.delete(id);
                bot.messageCountMap.delete(id);
                bot.rateLimitMap.delete(id);
                await bot.removeFromQueue(id);
            }

            // Collect session keys to remove (can't modify Map while iterating)
            const sessionsToCleanup: string[] = [];
            for (const [sessionKey] of bot.spectatingChats) {
                const [u1, u2] = sessionKey.split('_').map(Number);
                if (ids.includes(u1) || ids.includes(u2)) {
                    sessionsToCleanup.push(sessionKey);
                }
            }

            // Remove spectator sessions for these users
            for (const sessionKey of sessionsToCleanup) {
                const spectators = bot.spectatingChats.get(sessionKey);
                if (spectators) {
                    for (const adminId of spectators) {
                        bot.removeSpectator(adminId);
                    }
                }
            }
        }, userId);
    } catch (error) {
        // Force cleanup even if lock fails - prevent stuck users
        console.error("[CLEAR] Error during chat runtime cleanup, forcing cleanup:", error);
        const ids = [userId, partnerId].filter((value): value is number => typeof value === "number");
        for (const id of ids) {
            bot.runningChats.delete(id);
            bot.messageMap.delete(id);
            bot.messageCountMap.delete(id);
            bot.rateLimitMap.delete(id);
        }
        // Try to remove from queue without lock
        try {
            await bot.removeFromQueue(userId);
            if (partnerId) await bot.removeFromQueue(partnerId);
        } catch (queueError) {
            console.error("[CLEAR] Force queue removal failed:", queueError);
        }
    }
}

export async function beginChatRuntime(bot: ExtraTelegraf, userId: number, partnerId: number): Promise<void> {
    await bot.removeFromQueue(userId);
    await bot.removeFromQueue(partnerId);
    bot.runningChats.set(userId, partnerId);
    bot.runningChats.set(partnerId, userId);
    bot.messageCountMap.set(userId, 0);
    bot.messageCountMap.set(partnerId, 0);
}
