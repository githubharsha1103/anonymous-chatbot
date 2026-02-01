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
const db_1 = require("../storage/db");
const telegramErrorHandler_1 = require("../Utils/telegramErrorHandler");
const adminaccess_1 = require("../Commands/adminaccess");
const telegraf_1 = require("telegraf");
const backKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("🔙 Back", "OPEN_SETTINGS")]
]);
const ageInputKeyboard = telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("⬅️ Cancel", "SETUP_CANCEL")]
]);
exports.default = {
    type: "message",
    execute: (ctx, bot) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        // SAFETY: ctx.from may be undefined
        if (!ctx.from)
            return;
        // Block polls
        if ("poll" in ctx.message) {
            return ctx.reply("🚫 Polls are not allowed in chat.");
        }
        const text = "text" in ctx.message ? ctx.message.text : undefined;
        // Skip commands (messages starting with /)
        if (text === null || text === void 0 ? void 0 : text.startsWith("/"))
            return;
        /* ================================
           ADMIN BROADCAST HANDLER
        ================================= */
        // Check if admin is waiting to broadcast
        if (adminaccess_1.waitingForBroadcast.has(ctx.from.id)) {
            // Remove from waiting list
            adminaccess_1.waitingForBroadcast.delete(ctx.from.id);
            const broadcastText = text || "(No message content)";
            const users = (0, db_1.getAllUsers)();
            if (users.length === 0) {
                return ctx.reply("📢 *Broadcast Result*\n\n❌ No users to broadcast to.");
            }
            let successCount = 0;
            let failCount = 0;
            // Send broadcast to all users
            for (const id of users) {
                const userId = Number(id);
                if (isNaN(userId)) {
                    failCount++;
                    continue;
                }
                try {
                    yield ctx.telegram.sendMessage(userId, broadcastText);
                    successCount++;
                }
                catch (error) {
                    if ((0, telegramErrorHandler_1.isBotBlockedError)(error)) {
                        (0, telegramErrorHandler_1.cleanupBlockedUser)(bot, userId);
                    }
                    failCount++;
                }
            }
            return ctx.reply(`📢 *Broadcast Result*\n\n✅ Sent: ${successCount}\n❌ Failed: ${failCount}\n\nTotal Users: ${users.length}`, { parse_mode: "Markdown" });
        }
        /* ================================
           PROFILE INPUT HANDLER
        ================================= */
        /* ================================
        LINK FILTER
       ================================ */
        if (text) {
            const linkPattern = /(https?:\/\/|www\.|t\.me\/|telegram\.me\/)/i;
            if (linkPattern.test(text)) {
                return ctx.reply("🚫 Links are not allowed for safety reasons.");
            }
        }
        /* ================================
           LINK / USERNAME FILTER
        ================================ */
        if (text) {
            const blockedPattern = /(https?:\/\/|www\.|t\.me\/|telegram\.me\/|@\w+|\b[a-z0-9-]+\.(com|net|org|in|io|me|gg|co|app)\b)/i;
            if (blockedPattern.test(text)) {
                return ctx.reply("🚫 Links and usernames are not allowed for safety reasons.");
            }
        }
        if (text) {
            const txt = text.toLowerCase();
            // ✅ Gender
            if (txt === "male" || txt === "female") {
                (0, db_1.updateUser)(ctx.from.id, { gender: txt });
                return ctx.reply("Gender updated ✅");
            }
            // ✅ Preference
            if (txt === "any") {
                (0, db_1.updateUser)(ctx.from.id, { preference: txt });
                return ctx.reply("Preference updated ✅");
            }
            // ✅ Age (13-80) - Only process if user is in chat or setting up profile
            if (/^\d+$/.test(txt)) {
                const user = (0, db_1.getUser)(ctx.from.id);
                // If user already has age set and is not in a chat, skip age processing
                if (user.age && !bot.runningChats.includes(ctx.from.id)) {
                    // Let it fall through to chat forwarding check
                }
                else {
                    const age = Number(txt);
                    if (age < 13 || age > 80) {
                        return ctx.reply("Age must be between 13 and 80 ❌");
                    }
                    (0, db_1.updateUser)(ctx.from.id, { age });
                    // After age is set, ask for state (no back button) - only for new users
                    if (!user.state) {
                        const stateKeyboard = telegraf_1.Markup.inlineKeyboard([
                            [telegraf_1.Markup.button.callback("Telangana", "SETUP_STATE_TELANGANA")],
                            [telegraf_1.Markup.button.callback("Andhra Pradesh", "SETUP_STATE_AP")]
                        ]);
                        yield ctx.reply("📝 *Step 3/3:* Select your state:", Object.assign({ parse_mode: "Markdown" }, stateKeyboard));
                    }
                    else {
                        yield ctx.reply("Age updated ✅", backKeyboard);
                    }
                    return;
                }
            }
            // ✅ State (Telangana / Andhra Pradesh)
            if (txt === "telangana" || txt === "andhra pradesh") {
                (0, db_1.updateUser)(ctx.from.id, { state: txt });
                return ctx.reply("State updated ✅");
            }
        }
        /* ================================
           CHAT FORWARDING
        ================================= */
        if (!bot.runningChats.includes(ctx.from.id)) {
            // Check if user is in waiting queue
            if (bot.waiting === ctx.from.id) {
                return ctx.reply("⏳ Waiting for a partner...\n\nUse /end to stop searching.");
            }
            return ctx.reply("You are not in a chat...\n\nUse /next to find a new partner or /end to end searching.");
        }
        /* =================================
           MEDIA RESTRICTION (2 minutes)
        ================================= */
        // Check if message is media
        const isMedia = "photo" in ctx.message ||
            "video" in ctx.message ||
            "audio" in ctx.message ||
            "document" in ctx.message ||
            "voice" in ctx.message ||
            "video_note" in ctx.message ||
            "sticker" in ctx.message;
        if (isMedia) {
            const user = (0, db_1.getUser)(ctx.from.id);
            const chatStartTime = user.chatStartTime;
            if (chatStartTime) {
                const elapsed = (Date.now() - chatStartTime) / 1000; // in seconds
                const twoMinutes = 2 * 60;
                if (elapsed < twoMinutes) {
                    const remaining = Math.ceil(twoMinutes - elapsed);
                    return ctx.reply(`⏱️ Media sharing is locked for the first 2 minutes.\n\nPlease wait ${remaining} seconds before sending photos, videos, or other media.`);
                }
            }
        }
        /* =================================
           LINK DETECTION & BLOCKING
        ================================= */
        const urlRegex = /(https?:\/\/)?(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi;
        if (text && urlRegex.test(text)) {
            return ctx.reply("🚫 Links are not allowed in chat for your safety.\n\nPlease share information verbally instead.");
        }
        const partner = bot.getPartner(ctx.from.id);
        // Check if partner exists and is not blocked
        if (!partner) {
            return; // Partner not found
        }
        try {
            let sent;
            if ("reply_to_message" in ctx.message) {
                const messageId = (_a = ctx.message.reply_to_message) === null || _a === void 0 ? void 0 : _a.message_id;
                const messageMap = bot.messageMap.get(partner);
                if (messageMap && messageId) {
                    const replyMessageId = messageMap[messageId];
                    if (replyMessageId) {
                        sent = yield ctx.copyMessage(partner, {
                            reply_parameters: { message_id: replyMessageId }
                        });
                    }
                    else {
                        sent = yield ctx.copyMessage(partner);
                    }
                }
                else {
                    sent = yield ctx.copyMessage(partner);
                }
            }
            else {
                sent = yield ctx.copyMessage(partner);
            }
            if (sent) {
                let userMap = bot.messageMap.get(ctx.from.id) || {};
                userMap[sent.message_id] = ctx.message.message_id;
                bot.messageMap.set(ctx.from.id, userMap);
                let partnerMap = bot.messageMap.get(partner) || {};
                partnerMap[ctx.message.message_id] = sent.message_id;
                bot.messageMap.set(partner, partnerMap);
            }
            // Update chat activity timestamps for both users
            bot.updateChatActivity(ctx.from.id);
            bot.updateChatActivity(partner);
            /* =================================
               FORWARD TO SPECTATORS
            ================================= */
            // Check if any admin is spectating this chat
            const spectatorInfo = bot.getSpectatorChatForUser(ctx.from.id);
            if (spectatorInfo) {
                const { adminId, chat } = spectatorInfo;
                // Determine which user sent the message
                const senderId = ctx.from.id;
                const senderLabel = senderId === chat.user1 ? "User 1" : "User 2";
                // Forward the message to the admin
                try {
                    yield bot.telegram.sendMessage(adminId, `👁️ *Spectator Update*\n\n${senderLabel} (\`${senderId}\`) sent a message:`, { parse_mode: "Markdown" });
                    // Forward the actual message
                    yield ctx.forwardMessage(adminId);
                }
                catch (error) {
                    // Admin might have exited spectator mode, remove from spectating chats
                    console.log(`[SPECTATOR] - Admin ${adminId} no longer available, removing spectator`);
                    bot.spectatingChats.delete(adminId);
                }
            }
        }
        catch (error) {
            // Check if the partner blocked the bot
            if ((0, telegramErrorHandler_1.isBotBlockedError)(error)) {
                console.log(`[CHAT] - Partner ${partner} blocked the bot, ending chat`);
                // Clean up the chat state
                (0, telegramErrorHandler_1.cleanupBlockedUser)(bot, partner);
                // Also remove current user from running chats
                bot.runningChats = bot.runningChats.filter(u => u !== ctx.from.id);
                // Clean up message maps
                bot.messageMap.delete(ctx.from.id);
                bot.messageMap.delete(partner);
                // Report keyboard
                const reportKeyboard = telegraf_1.Markup.inlineKeyboard([
                    [telegraf_1.Markup.button.callback("🚨 Report User", "OPEN_REPORT")]
                ]);
                return ctx.reply("🚫 Partner left the chat\n\n/next - Find new partner\n\n━━━━━━━━━━━━━━━━━\nTo report this chat:", reportKeyboard);
            }
            // Re-throw other errors to be handled by the event handler
            throw error;
        }
    })
};
