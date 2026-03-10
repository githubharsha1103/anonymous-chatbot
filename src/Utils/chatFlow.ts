import { Markup } from "telegraf";
import type { ExtraTelegraf } from "../index";

type PartnerProfile = {
    age?: string | null;
    gender?: string | null;
    state?: string | null;
};

export const exitChatKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🔍 Find New Partner", "START_SEARCH")],
    [Markup.button.callback("🚨 Report User", "OPEN_REPORT")]
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
        "Tap below to find a new partner or report this chat.\n\n" +
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
        "Tap below to find a new partner or report this chat.\n\n" +
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

export function clearChatRuntime(bot: ExtraTelegraf, userId: number, partnerId: number | null): void {
    const ids = [userId, partnerId].filter((value): value is number => typeof value === "number");

    for (const id of ids) {
        bot.runningChats.delete(id);
        bot.messageMap.delete(id);
        bot.messageCountMap.delete(id);
        bot.rateLimitMap.delete(id);
        bot.removeFromQueue(id);
    }

    for (const [adminId, chat] of bot.spectatingChats) {
        if (ids.includes(chat.user1) || ids.includes(chat.user2)) {
            bot.spectatingChats.delete(adminId);
        }
    }
}

export function beginChatRuntime(bot: ExtraTelegraf, userId: number, partnerId: number): void {
    bot.removeFromQueue(userId);
    bot.removeFromQueue(partnerId);
    bot.runningChats.set(userId, partnerId);
    bot.runningChats.set(partnerId, userId);
    bot.messageCountMap.set(userId, 0);
    bot.messageCountMap.set(partnerId, 0);
}
