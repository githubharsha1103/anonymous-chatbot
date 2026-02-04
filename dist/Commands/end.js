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
exports.default = {
    name: "end",
    execute: (ctx, bot) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const id = (_a = ctx.from) === null || _a === void 0 ? void 0 : _a.id;
        // Check rate limit
        if (bot.isRateLimited(id)) {
            return ctx.reply("⏳ Please wait a few seconds before trying again.");
        }
        // Acquire mutex to prevent race conditions
        yield bot.chatMutex.acquire();
        try {
            if (!bot.runningChats.includes(id)) {
                return ctx.reply("You are not in a chat.");
            }
            const partner = bot.getPartner(id);
            bot.runningChats = bot.runningChats.filter(u => u !== id && u !== partner);
            bot.messageMap.delete(id);
            bot.messageMap.delete(partner);
            // Store partner ID for potential report
            if (partner) {
                yield (0, db_1.updateUser)(id, { reportingPartner: partner });
                yield (0, db_1.updateUser)(partner, { reportingPartner: id });
            }
            // Report keyboard
            const reportKeyboard = telegraf_1.Markup.inlineKeyboard([
                [telegraf_1.Markup.button.callback("🚨 Report User", "OPEN_REPORT")]
            ]);
            // Use sendMessageWithRetry to handle blocked partners
            const notifySent = yield (0, telegramErrorHandler_1.sendMessageWithRetry)(bot, partner, "🚫 Partner left the chat\n\n/next - Find new partner\n\n━━━━━━━━━━━━━━━━━\nTo report this chat:", reportKeyboard);
            // If message failed to send, still clean up
            if (!notifySent && partner) {
                (0, telegramErrorHandler_1.cleanupBlockedUser)(bot, partner);
            }
            return ctx.reply("🚫 Partner left the chat\n\n/next - Find new partner\n\n━━━━━━━━━━━━━━━━━\nTo report this chat:", reportKeyboard);
        }
        finally {
            bot.chatMutex.release();
        }
    })
};
