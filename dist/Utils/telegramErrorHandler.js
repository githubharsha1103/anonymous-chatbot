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
exports.isBotBlockedError = isBotBlockedError;
exports.isNotEnoughRightsError = isNotEnoughRightsError;
exports.cleanupBlockedUser = cleanupBlockedUser;
exports.handleTelegramError = handleTelegramError;
exports.safeSendMessage = safeSendMessage;
const db_1 = require("../storage/db");
/**
 * Check if an error is a "bot blocked by user" error (403)
 */
function isBotBlockedError(error) {
    var _a, _b, _c;
    return (((_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.error_code) === 403 &&
        ((_c = (_b = error === null || error === void 0 ? void 0 : error.response) === null || _b === void 0 ? void 0 : _b.description) === null || _c === void 0 ? void 0 : _c.includes("bot was blocked by the user")));
}
/**
 * Check if an error is a "not enough rights" error (400)
 * This happens when user restricted bot or bot was removed from chat
 */
function isNotEnoughRightsError(error) {
    var _a, _b, _c;
    return (((_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.error_code) === 400 &&
        ((_c = (_b = error === null || error === void 0 ? void 0 : error.response) === null || _b === void 0 ? void 0 : _b.description) === null || _c === void 0 ? void 0 : _c.includes("not enough rights")));
}
/**
 * Clean up user state when they block the bot
 * This removes the user from waiting queues, active chats, etc.
 */
function cleanupBlockedUser(bot, userId) {
    let cleanedUp = false;
    // Remove from waiting queue
    const queueIndex = bot.waitingQueue.findIndex(w => w.id === userId);
    if (queueIndex !== -1) {
        bot.waitingQueue.splice(queueIndex, 1);
        cleanedUp = true;
        console.log(`[CLEANUP] - User ${userId} removed from waiting queue (bot blocked)`);
    }
    // Clear waiting if it was this user
    if (bot.waiting === userId) {
        bot.waiting = null;
        cleanedUp = true;
    }
    // Remove from running chats
    const chatIndex = bot.runningChats.indexOf(userId);
    if (chatIndex !== -1) {
        // Get partner before removing
        const partner = bot.getPartner(userId);
        bot.runningChats.splice(chatIndex, 1);
        // Remove the partner entry as well (paired entries)
        const partnerIndex = bot.runningChats.indexOf(partner);
        if (partnerIndex !== -1) {
            bot.runningChats.splice(partnerIndex, 1);
        }
        cleanedUp = true;
        console.log(`[CLEANUP] - User ${userId} removed from running chats (bot blocked)`);
        // Notify partner that user left
        if (partner) {
            console.log(`[CLEANUP] - Notifying partner ${partner} that user ${userId} left`);
        }
    }
    if (cleanedUp) {
        console.log(`[CLEANUP] - Completed cleanup for blocked user ${userId}`);
    }
    // Delete user data from database
    if ((0, db_1.deleteUser)(userId)) {
        console.log(`[CLEANUP] - Deleted user ${userId} data from database`);
    }
}
/**
 * Handle a Telegram error, returning true if it was handled (e.g., bot blocked)
 */
function handleTelegramError(bot, error, userId) {
    var _a, _b;
    if (isBotBlockedError(error)) {
        const blockedUserId = userId || ((_b = (_a = error.on) === null || _a === void 0 ? void 0 : _a.payload) === null || _b === void 0 ? void 0 : _b.chat_id);
        if (blockedUserId) {
            cleanupBlockedUser(bot, blockedUserId);
        }
        console.log(`[HANDLED] - Bot blocked by user ${blockedUserId}`);
        return true;
    }
    // Log other errors but don't crash
    console.error(`[TELEGRAM ERROR] -`, error.message || error);
    return false;
}
/**
 * Safe send message wrapper that handles blocked user errors
 */
function safeSendMessage(bot, chatId, text, extra) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield bot.telegram.sendMessage(chatId, text, extra);
            return true;
        }
        catch (error) {
            if (isBotBlockedError(error)) {
                cleanupBlockedUser(bot, chatId);
                return false;
            }
            if (isNotEnoughRightsError(error)) {
                // User restricted bot or bot was removed from chat
                cleanupBlockedUser(bot, chatId);
                return false;
            }
            throw error;
        }
    });
}
