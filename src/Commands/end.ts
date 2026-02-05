import { Context, Markup } from "telegraf";
import { ExtraTelegraf } from "..";
import { sendMessageWithRetry, cleanupBlockedUser } from "../Utils/telegramErrorHandler";
import { updateUser, getUser, incUserTotalChats } from "../storage/db";

// Rating keyboard with emojis
const ratingKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("😊 Good", "RATE_GOOD")],
    [Markup.button.callback("😐 Okay", "RATE_OKAY")],
    [Markup.button.callback("😞 Bad", "RATE_BAD")]
]);

// Main menu keyboard after chat ends
const mainMenuKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🔍 Find New Partner", "START_SEARCH")],
    [Markup.button.callback("⚙️ Settings", "OPEN_SETTINGS")],
    [Markup.button.callback("❓ Help", "START_HELP")]
]);

// Helper function to format duration
function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
        return `${minutes} min${minutes > 1 ? 's' : ''}`;
    } else {
        return `${seconds}s`;
    }
}

export default {
    name: "end",
    execute: async (ctx: Context, bot: ExtraTelegraf) => {

        const id = ctx.from?.id as number;

        // Check rate limit
        if (bot.isRateLimited(id)) {
            return ctx.reply("⏳ Please wait a few seconds before trying again.");
        }

        // Acquire mutex to prevent race conditions
        await bot.chatMutex.acquire();

        try {
            if (!bot.runningChats.includes(id)) {
                return ctx.reply("You are not in a chat. Use /search to find a partner!");
            }

            const partner = bot.getPartner(id);

            // Calculate chat duration
            const user = await getUser(id);
            const chatStartTime = user.chatStartTime;
            const duration = chatStartTime ? Date.now() - chatStartTime : 0;
            const durationText = formatDuration(duration);

            // Get message count
            const messageCount = bot.messageCountMap.get(id) || 0;

            // Clean up chat state
            bot.runningChats = bot.runningChats.filter(
                u => u !== id && u !== partner
            );

            bot.messageMap.delete(id);
            bot.messageMap.delete(partner);

            // Clean up message count
            bot.messageCountMap.delete(id);
            if (partner) {
                bot.messageCountMap.delete(partner);
            }

            // Store partner ID for potential report
            if (partner) {
                await updateUser(id, { reportingPartner: partner });
                await updateUser(partner, { reportingPartner: id });
            }

            // Clear chat start time and increment chat count
            await updateUser(id, { chatStartTime: null });
            if (partner) {
                await updateUser(partner, { chatStartTime: null });
                // Increment total chats for both users
                await incUserTotalChats(id);
                await incUserTotalChats(partner);
            }

            // Report keyboard
            const reportKeyboard = Markup.inlineKeyboard([
                [Markup.button.callback("🚨 Report User", "OPEN_REPORT")]
            ]);

            // Partner notification
            const partnerLeftMessage = 
`🚫 Partner left the chat

💬 Chat Duration: ${durationText}
💭 Messages Exchanged: ${messageCount}

/next - Find new partner

━━━━━━━━━━━━━━━━━
To report this user:`;

            // User's enhanced exit message
            const userExitMessage = 
`💬 *Chat Ended*

⏱️ *Duration:* ${durationText}
💭 *Messages:* ${messageCount}

━━━━━━━━━━━━━━━━━
How was your chat experience?`;

            // Use sendMessageWithRetry to handle blocked partners
            const notifySent = await sendMessageWithRetry(
                bot,
                partner,
                partnerLeftMessage,
                reportKeyboard
            );

            // If message failed to send, still clean up
            if (!notifySent && partner) {
                cleanupBlockedUser(bot, partner);
            }

            // Send enhanced exit message with rating
            return ctx.reply(
                userExitMessage,
                { parse_mode: "Markdown", ...ratingKeyboard }
            );

        } finally {
            bot.chatMutex.release();
        }
    }
};
