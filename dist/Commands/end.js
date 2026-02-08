"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const telegraf_1 = require("telegraf");
const telegramErrorHandler_1 = require("../Utils/telegramErrorHandler");
const db_1 = require("../storage/db");
// Rating keyboard with emojis and next button
const ratingKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("😊 Good", "RATE_GOOD"), telegraf_1.Markup.button.callback("😐 Okay", "RATE_OKAY"), telegraf_1.Markup.button.callback("😞 Bad", "RATE_BAD")],
    [telegraf_1.Markup.button.callback("🔍 Find New Partner", "START_SEARCH")],
    [telegraf_1.Markup.button.callback("🚨 Report User", "OPEN_REPORT")]
]);
// Main menu keyboard after chat ends
const mainMenuKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("🔍 Find New Partner", "START_SEARCH")],
    [telegraf_1.Markup.button.callback("⚙️ Settings", "OPEN_SETTINGS")],
    [telegraf_1.Markup.button.callback("❓ Help", "START_HELP")]
]);
// Helper function to format duration
function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    }
    else if (minutes > 0) {
        return `${minutes} min${minutes > 1 ? 's' : ''}`;
    }
    else {
        return `${seconds}s`;
    }
}
exports.default = {
    name: "end",
    execute: (ctx, bot) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const id = (_a = ctx.from) === null || _a === void 0 ? void 0 : _a.id;
        // Check rate limit
        if (bot.isRateLimited(id)) {
            return ctx.reply("⏳ Please wait a moment before trying again.");
        }
        // Acquire mutex to prevent race conditions
        yield bot.chatMutex.acquire();
        try {
            if (!bot.runningChats.includes(id)) {
                return ctx.reply("You are not in a chat. Use /search to find a partner!");
            }
            const partner = bot.getPartner(id);
            // Calculate chat duration
            const user = yield (0, db_1.getUser)(id);
            const chatStartTime = user.chatStartTime;
            const duration = chatStartTime ? Date.now() - chatStartTime : 0;
            const durationText = formatDuration(duration);
            // Get message count
            const messageCount = bot.messageCountMap.get(id) || 0;
            // Clean up chat state
            const usersToRemove = [id];
            if (partner)
                usersToRemove.push(partner);
            bot.runningChats = bot.runningChats.filter(u => !usersToRemove.includes(u));
            bot.messageMap.delete(id);
            if (partner)
                bot.messageMap.delete(partner);
            // Clean up message count
            bot.messageCountMap.delete(id);
            if (partner) {
                bot.messageCountMap.delete(partner);
            }
            // Store partner ID for potential report
            if (partner) {
                yield (0, db_1.updateUser)(id, { reportingPartner: partner });
                yield (0, db_1.updateUser)(partner, { reportingPartner: id });
            }
            // Clear chat start time and increment chat count
            yield (0, db_1.updateUser)(id, { chatStartTime: null });
            if (partner) {
                yield (0, db_1.updateUser)(partner, { chatStartTime: null });
                // Increment total chats for both users
                yield (0, db_1.incUserTotalChats)(id);
                yield (0, db_1.incUserTotalChats)(partner);
            }
            // Common exit message for both users
            const exitMessage = `🚫 Partner left the chat

💬 Chat Duration: ${durationText}
💭 Messages Exchanged: ${messageCount}

━━━━━━━━━━━━━━━━━
How was your chat experience?`;
            // Use sendMessageWithRetry to handle blocked partners
            const notifySent = partner ? yield (0, telegramErrorHandler_1.sendMessageWithRetry)(bot, partner, exitMessage, ratingKeyboard) : false;
            // If message failed to send, still clean up
            if (!notifySent && partner) {
                (0, telegramErrorHandler_1.cleanupBlockedUser)(bot, partner);
            }
            // Send exit message with rating and buttons to user who ended chat
            return ctx.reply(exitMessage, Object.assign({ parse_mode: "HTML" }, ratingKeyboard));
        }
        finally {
            bot.chatMutex.release();
        }
    })
};
