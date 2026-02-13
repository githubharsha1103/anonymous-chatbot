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
const db_1 = require("../storage/db");
const telegramErrorHandler_1 = require("../Utils/telegramErrorHandler");
exports.default = {
    name: "next",
    description: "Skip current chat and find new partner",
    execute: (ctx, bot) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const userId = (_a = ctx.from) === null || _a === void 0 ? void 0 : _a.id;
        // Check rate limit
        if (bot.isRateLimited(userId)) {
            return ctx.reply("⏳ Please wait a moment before trying again.");
        }
        // Acquire mutex to prevent race conditions
        yield bot.chatMutex.acquire();
        try {
            const gender = yield (0, db_1.getGender)(userId);
            // End current chat if in one
            if (bot.runningChats.includes(userId)) {
                const partner = bot.getPartner(userId);
                // Remove users from running chats (handle null partner)
                const usersToRemove = [userId];
                if (partner)
                    usersToRemove.push(partner);
                bot.runningChats = bot.runningChats.filter(u => !usersToRemove.includes(u));
                // Clean up message maps
                bot.messageMap.delete(userId);
                if (partner)
                    bot.messageMap.delete(partner);
                // Clean up message count
                bot.messageCountMap.delete(userId);
                if (partner)
                    bot.messageCountMap.delete(partner);
                // Store partner ID for potential report (both ways)
                if (partner) {
                    yield (0, db_1.updateUser)(userId, { reportingPartner: partner, chatStartTime: null });
                    yield (0, db_1.updateUser)(partner, { reportingPartner: userId, chatStartTime: null });
                }
                // Report keyboard
                const reportKeyboard = telegraf_1.Markup.inlineKeyboard([
                    [telegraf_1.Markup.button.callback("🚨 Report User", "OPEN_REPORT")]
                ]);
                // Use sendMessageWithRetry to handle blocked partners
                const notifySent = partner ? yield (0, telegramErrorHandler_1.sendMessageWithRetry)(bot, partner, "🚫 Partner left the chat\n\n/next - Find new partner\n\n━━━━━━━━━━━━━━━━━\nTo report this chat:", reportKeyboard) : false;
                // If message failed to send, end the chat properly
                if (!notifySent && partner) {
                    (0, telegramErrorHandler_1.cleanupBlockedUser)(bot, partner);
                    (0, telegramErrorHandler_1.endChatDueToError)(bot, userId, partner);
                    return ctx.reply("🚫 Partner left the chat");
                }
                return ctx.reply("🚫 Partner left the chat\n\n/next - Find new partner\n\n━━━━━━━━━━━━━━━━━\nTo report this chat:", reportKeyboard);
            }
            // Remove from queue if already waiting
            const queueIndex = bot.waitingQueue.findIndex(w => w.id === userId);
            if (queueIndex !== -1) {
                bot.waitingQueue.splice(queueIndex, 1);
            }
            // Get user preference
            const user = yield (0, db_1.getUser)(userId);
            const preference = user.preference || "any";
            const isPremium = user.premium || false;
            // SIMPLIFIED MATCHING LOGIC:
            // - Normal users (non-premium): preference is locked to "any" → match with BOTH genders randomly
            // - Premium users: can set preference → match ONLY with preferred gender
            // If user is premium AND has specific preference, match only with that gender
            // Otherwise (free user or "any" preference), match with anyone
            const matchPreference = (isPremium && preference !== "any") ? preference : null;
            // Find a compatible match
            // Bidirectional matching: both users must be compatible
            // We fetch fresh user data from DB to ensure preferences are up-to-date
            let matchIndex = -1;
            for (let i = 0; i < bot.waitingQueue.length; i++) {
                const w = bot.waitingQueue[i];
                // Fetch fresh user data for the waiting user
                const waitingUserData = yield (0, db_1.getUser)(w.id);
                // Check if waiting user's gender matches current user's preference
                const genderMatches = !matchPreference || (waitingUserData.gender || "any") === matchPreference;
                // Check if current user's gender matches waiting user's preference
                const waitingPref = waitingUserData.preference || "any";
                const preferenceMatches = waitingPref === "any" || waitingPref === gender;
                if (genderMatches && preferenceMatches) {
                    matchIndex = i;
                    break;
                }
            }
            if (matchIndex !== -1) {
                const match = bot.waitingQueue[matchIndex];
                const matchUser = yield (0, db_1.getUser)(match.id);
                bot.waitingQueue.splice(matchIndex, 1);
                bot.runningChats.push(match.id, userId);
                // Store last partner and chat start time
                yield (0, db_1.updateUser)(userId, { lastPartner: match.id, chatStartTime: Date.now() });
                yield (0, db_1.updateUser)(match.id, { lastPartner: userId, chatStartTime: Date.now() });
                // Initialize message count for both users
                bot.messageCountMap.set(userId, 0);
                bot.messageCountMap.set(match.id, 0);
                if (bot.waiting === match.id) {
                    bot.waiting = null;
                }
                // Increment chat count for new chat
                bot.incrementChatCount();
                // Build partner info message - hide gender for non-premium users
                const partnerGender = isPremium
                    ? (matchUser.gender ? matchUser.gender.charAt(0).toUpperCase() + matchUser.gender.slice(1) : "Not Set")
                    : "🔒 Hidden";
                const partnerAge = matchUser.age || "Not Set";
                const userPartnerInfo = `✅ Partner Matched

🔢 Age: ${partnerAge}
👥 Gender: ${partnerGender}
🌍 Country: 🇮🇳 India${matchUser.state ? ` - ${matchUser.state.charAt(0).toUpperCase() + matchUser.state.slice(1)}` : ""}

🚫 Links are restricted
⏱️ Media sharing unlocked after 2 minutes

/end — Leave the chat`;
                // For match user - also hide gender if they're not premium
                const matchUserGender = user.premium
                    ? (user.gender ? user.gender.charAt(0).toUpperCase() + user.gender.slice(1) : "Not Set")
                    : "🔒 Hidden";
                const matchPartnerInfo = `✅ Partner Matched

🔢 Age: ${user.age || "Not Set"}
👥 Gender: ${matchUserGender}
🌍 Country: 🇮🇳 India${user.state ? ` - ${user.state.charAt(0).toUpperCase() + user.state.slice(1)}` : ""}

🚫 Links are restricted
⏱️ Media sharing unlocked after 2 minutes

/end — Leave the chat`;
                // Use sendMessageWithRetry to handle blocked matches
                const matchSent = yield (0, telegramErrorHandler_1.sendMessageWithRetry)(bot, match.id, matchPartnerInfo);
                // If message failed to send, check if partner is still in running chats
                if (!matchSent) {
                    // Check if partner is still in running chats (they haven't left)
                    const partnerStillThere = bot.runningChats.includes(match.id);
                    if (partnerStillThere) {
                        // Partner is still there - maybe network issue, try to notify and let them continue waiting
                        yield (0, telegramErrorHandler_1.sendMessageWithRetry)(bot, match.id, "⚠️ Connection issue. Please wait...", { parse_mode: "Markdown" });
                        // Add current user back to queue to find another partner
                        const currentGender = yield (0, db_1.getGender)(userId);
                        bot.waitingQueue.push({ id: userId, preference, gender: currentGender || "any", isPremium });
                        return ctx.reply("⚠️ Temporary connection issue with partner. You've been added back to the queue...\n⏳ Waiting for a new partner...");
                    }
                    else {
                        // Partner has actually left
                        (0, telegramErrorHandler_1.endChatDueToError)(bot, userId, match.id);
                        return ctx.reply("🚫 Could not connect to partner. They may have left or restricted the bot.");
                    }
                }
                return ctx.reply(userPartnerInfo);
            }
            // No match, add to queue
            bot.waitingQueue.push({ id: userId, preference, gender: gender || "any", isPremium });
            bot.waiting = userId;
            return ctx.reply("⏳ Waiting for a partner...");
        }
        finally {
            bot.chatMutex.release();
        }
    })
};
