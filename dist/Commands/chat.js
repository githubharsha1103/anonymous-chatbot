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
// Generate unique chat tag
function generateChatTag() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
exports.default = {
    name: "chat",
    description: "Find a new chat partner",
    execute: (ctx, bot) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const userId = (_a = ctx.from) === null || _a === void 0 ? void 0 : _a.id;
        const gender = (0, db_1.getGender)(userId);
        // End current chat if in one
        if (bot.runningChats.includes(userId)) {
            const partner = bot.getPartner(userId);
            bot.runningChats = bot.runningChats.filter(u => u !== userId && u !== partner);
            bot.messageMap.delete(userId);
            bot.messageMap.delete(partner);
            // Get chat tag for reporting
            const user = (0, db_1.getUser)(userId);
            const chatTag = user.chatTag || "UNKNOWN";
            // Store last partner for potential report
            if (partner) {
                (0, db_1.updateUser)(userId, { reportingPartner: partner });
            }
            // Use safeSendMessage to handle blocked partners
            const exitMessage = `🚫 You left the chat\n\n/chat - Find new partner\n\n━━━━━━━━━━━━━━━━━\n⚠️ Report TAG: ${chatTag}\n\nTo report this chat:\n/report ${chatTag}`;
            yield (0, telegramErrorHandler_1.safeSendMessage)(bot, partner, exitMessage);
        }
        // Remove from queue if already waiting
        const queueIndex = bot.waitingQueue.findIndex(w => w.id === userId);
        if (queueIndex !== -1) {
            bot.waitingQueue.splice(queueIndex, 1);
        }
        // Get user preference
        const user = (0, db_1.getUser)(userId);
        const preference = user.preference || "any";
        const isPremium = user.premium || false;
        // Find a compatible match
        const matchIndex = bot.waitingQueue.findIndex(waiting => {
            const w = waiting;
            const currentUserSatisfied = preference === "any" || preference === w.gender;
            const waitingUserSatisfied = w.preference === "any" || w.preference === gender;
            return currentUserSatisfied && waitingUserSatisfied;
        });
        if (matchIndex !== -1) {
            const match = bot.waitingQueue[matchIndex];
            const matchUser = (0, db_1.getUser)(match.id);
            bot.waitingQueue.splice(matchIndex, 1);
            bot.runningChats.push(match.id, userId);
            // Generate chat tag and store for both users
            const chatTag = generateChatTag();
            (0, db_1.updateUser)(userId, { lastPartner: match.id, chatStartTime: Date.now(), chatTag });
            (0, db_1.updateUser)(match.id, { lastPartner: userId, chatStartTime: Date.now(), chatTag });
            if (bot.waiting === match.id) {
                bot.waiting = null;
            }
            // Increment chat count for new chat
            bot.incrementChatCount();
            // Build partner info message
            const partnerGender = isPremium ? (matchUser.gender ? matchUser.gender.charAt(0).toUpperCase() + matchUser.gender.slice(1) : "Not Set") : "Available with Premium";
            const partnerAge = matchUser.age || "Not Set";
            const userPartnerInfo = `✅ Partner Matched

🔢 Age: ${partnerAge}
👥 Gender: ${partnerGender}
🌍 Country: 🇮🇳 India${matchUser.state ? ` - ${matchUser.state.charAt(0).toUpperCase() + matchUser.state.slice(1)}` : ""}

🚫 Links are restricted
⏱️ Media sharing unlocked after 2 minutes

/exit — Leave the chat`;
            const matchPartnerInfo = `✅ Partner Matched

🔢 Age: ${user.age || "Not Set"}
👥 Gender: ${user.gender ? user.gender.charAt(0).toUpperCase() + user.gender.slice(1) : "Not Set"}
🌍 Country: 🇮🇳 India${user.state ? ` - ${user.state.charAt(0).toUpperCase() + user.state.slice(1)}` : ""}

🚫 Links are restricted
⏱️ Media sharing unlocked after 2 minutes

/exit — Leave the chat`;
            // Use safeSendMessage to handle blocked matches
            yield (0, telegramErrorHandler_1.safeSendMessage)(bot, match.id, matchPartnerInfo);
            return ctx.reply(userPartnerInfo);
        }
        // No match, add to queue
        bot.waitingQueue.push({ id: userId, preference, gender: gender || "any", isPremium });
        bot.waiting = userId;
        return ctx.reply("⏳ Waiting for a partner...");
    })
};
