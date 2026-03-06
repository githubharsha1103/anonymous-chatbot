import { Context } from "telegraf";
import { ExtraTelegraf } from "..";
import { sendMessageWithRetry, cleanupBlockedUser, cleanupUserMaps } from "../Utils/telegramErrorHandler";
import { updateUser, getUser, incUserTotalChats } from "../storage/db";

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
            return ctx.reply("⏳ Please wait a moment before trying again.");
        }

        // Acquire mutex to prevent race conditions
        await bot.chatMutex.acquire();

        try {
            if (!bot.runningChats.has(id)) {
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

            // Clean up chat state using Map delete
            bot.runningChats.delete(id);
            if (partner) bot.runningChats.delete(partner);

            bot.messageMap.delete(id);
            if (partner) bot.messageMap.delete(partner);

            // Clean up message count
            bot.messageCountMap.delete(id);
            if (partner) {
                bot.messageCountMap.delete(partner);
            }
            
            // Clean up rate limit entries to prevent memory growth
            bot.rateLimitMap.delete(id);
            if (partner) {
                bot.rateLimitMap.delete(partner);
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

            // Common exit message for both users
            const exitMessage = 
`🚫 Partner left the chat

💬 Chat Duration: ${durationText}
💭 Messages Exchanged: ${messageCount}

How was your chat experience?

Use /next to find a new partner.`;

            // Use sendMessageWithRetry to handle blocked partners (without keyboard)
            const notifySent = partner ? await sendMessageWithRetry(
                bot,
                partner,
                exitMessage
            ) : false;

            // If message failed to send, still clean up
            if (!notifySent && partner) {
                cleanupBlockedUser(bot, partner);
            }

            // Send exit message to user who ended chat (without keyboard)
            return ctx.reply(
                exitMessage,
                { parse_mode: "HTML" }
            );

        } finally {
            bot.chatMutex.release();
        }
    }
};
