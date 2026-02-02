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
exports.default = {
    name: "search",
    description: "Search for a chat",
    execute: (ctx, bot) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const userId = (_a = ctx.from) === null || _a === void 0 ? void 0 : _a.id;
        const gender = (0, db_1.getGender)(userId);
        if (!gender) {
            return ctx.reply("Set gender first using /setgender");
        }
        if (bot.runningChats.includes(userId)) {
            return ctx.reply("You are already in a chat!\n\nUse /end to leave the chat or use /next to skip the current chat.");
        }
        // Check if already in queue
        if (bot.waitingQueue.some(w => w.id === userId)) {
            return ctx.reply("You are already in the queue!");
        }
        // Get user info and preference
        const user = (0, db_1.getUser)(userId);
        const preference = user.preference || "any";
        const isPremium = user.premium || false;
        // Find a compatible match from the queue
        const matchIndex = bot.waitingQueue.findIndex(waiting => {
            const w = waiting;
            // If current user has preference, check if waiting user's gender matches
            const currentUserSatisfied = preference === "any" || preference === w.gender;
            // If waiting user has preference, check if current user's gender matches
            const waitingUserSatisfied = w.preference === "any" || w.preference === gender;
            // Premium user preference takes priority:
            // If current user is premium with a specific preference, match even if waiting user has no preference
            const premiumPriority = isPremium && preference !== "any" && preference === w.gender;
            // If waiting user is premium with a specific preference, match even if current user has no preference
            const waitingPremiumPriority = w.isPremium && w.preference !== "any" && w.preference === gender;
            return (currentUserSatisfied && waitingUserSatisfied) || premiumPriority || waitingPremiumPriority;
        });
        if (matchIndex !== -1) {
            const match = bot.waitingQueue[matchIndex];
            const matchUser = (0, db_1.getUser)(match.id);
            bot.waitingQueue.splice(matchIndex, 1);
            bot.runningChats.push(match.id, userId);
            // Store last partner for both users
            (0, db_1.updateUser)(userId, { lastPartner: match.id });
            (0, db_1.updateUser)(match.id, { lastPartner: userId });
            // Store chat start time for media restriction (2 minutes)
            const chatStartTime = Date.now();
            (0, db_1.updateUser)(userId, { chatStartTime });
            (0, db_1.updateUser)(match.id, { chatStartTime });
            // Clear waiting if it was this user
            if (bot.waiting === match.id) {
                bot.waiting = null;
            }
            // Increment chat count
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

/end — Leave the chat`;
            const matchPartnerInfo = `✅ Partner Matched

🔢 Age: ${user.age || "Not Set"}
👥 Gender: ${user.gender ? user.gender.charAt(0).toUpperCase() + user.gender.slice(1) : "Not Set"}
🌍 Country: 🇮🇳 India${user.state ? ` - ${user.state.charAt(0).toUpperCase() + user.state.slice(1)}` : ""}

🚫 Links are restricted
⏱️ Media sharing unlocked after 2 minutes

/end — Leave the chat`;
            // Use sendMessageWithRetry to handle blocked partners
            const matchSent = yield (0, telegramErrorHandler_1.sendMessageWithRetry)(bot, match.id, matchPartnerInfo);
            // If message failed to send (partner blocked/removed bot), end the chat
            if (!matchSent) {
                (0, telegramErrorHandler_1.endChatDueToError)(bot, userId, match.id);
                return ctx.reply("🚫 Could not connect to partner. They may have left or restricted the bot.");
            }
            return ctx.reply(userPartnerInfo);
        }
        // No match found, add to queue
        bot.waitingQueue.push({ id: userId, preference, gender, isPremium });
        bot.waiting = userId;
        return ctx.reply("⏳ Waiting for a partner...");
    })
};
