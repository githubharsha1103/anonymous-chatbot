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
exports.isRateLimitError = isRateLimitError;
exports.getRetryDelay = getRetryDelay;
exports.cleanupBlockedUser = cleanupBlockedUser;
exports.cleanupBlockedUserAsync = cleanupBlockedUserAsync;
exports.endChatDueToError = endChatDueToError;
exports.handleTelegramError = handleTelegramError;
exports.safeSendMessage = safeSendMessage;
exports.sendMessageWithRetry = sendMessageWithRetry;
exports.broadcastWithRateLimit = broadcastWithRateLimit;
const telegraf_1 = require("telegraf");
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
 * This happens when user restricted bot, bot was removed from chat, or no rights to send messages
 */
function isNotEnoughRightsError(error) {
    var _a, _b, _c, _d, _e, _f, _g;
    return (((_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.error_code) === 400 &&
        (((_c = (_b = error === null || error === void 0 ? void 0 : error.response) === null || _b === void 0 ? void 0 : _b.description) === null || _c === void 0 ? void 0 : _c.includes("not enough rights")) ||
            ((_e = (_d = error === null || error === void 0 ? void 0 : error.response) === null || _d === void 0 ? void 0 : _d.description) === null || _e === void 0 ? void 0 : _e.includes("chat not found")) ||
            ((_g = (_f = error === null || error === void 0 ? void 0 : error.response) === null || _f === void 0 ? void 0 : _f.description) === null || _g === void 0 ? void 0 : _g.includes("user is deactivated"))));
}
/**
 * Check if an error is a rate limit error (429)
 */
function isRateLimitError(error) {
    var _a, _b, _c;
    return (((_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.error_code) === 429 ||
        ((_c = (_b = error === null || error === void 0 ? void 0 : error.response) === null || _b === void 0 ? void 0 : _b.description) === null || _c === void 0 ? void 0 : _c.includes("Too Many Requests")));
}
/**
 * Get retry delay from rate limit error (in seconds)
 */
function getRetryDelay(error) {
    var _a, _b;
    const match = (_b = (_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.description) === null || _b === void 0 ? void 0 : _b.match(/retry after (\d+)/);
    if (match) {
        return parseInt(match[1], 10);
    }
    // Default delay if not specified
    return 5;
}
/**
 * Clean up user state when they block the bot or bot loses rights
 * This removes the user from waiting queues, active chats, etc.
 */
function cleanupBlockedUser(bot, userId) {
    let cleanedUp = false;
    // Remove from waiting queue
    const queueIndex = bot.waitingQueue.findIndex(w => w.id === userId);
    if (queueIndex !== -1) {
        bot.waitingQueue.splice(queueIndex, 1);
        cleanedUp = true;
        console.log(`[CLEANUP] - User ${userId} removed from waiting queue`);
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
        // Remove both users from running chats (pair is broken)
        bot.runningChats = bot.runningChats.filter(u => u !== userId);
        if (partner) {
            bot.runningChats = bot.runningChats.filter(u => u !== partner);
        }
        cleanedUp = true;
        console.log(`[CLEANUP] - User ${userId} removed from running chats (partner: ${partner})`);
        // Clean up message maps for both users
        bot.messageMap.delete(userId);
        if (partner) {
            bot.messageMap.delete(partner);
        }
        return; // Partner cleanup handled synchronously
    }
    if (cleanedUp) {
        console.log(`[CLEANUP] - Completed cleanup for user ${userId}`);
    }
    // Note: User data is NOT deleted from database to preserve statistics
}
/**
 * Async version of cleanupBlockedUser that also notifies the partner
 */
function cleanupBlockedUserAsync(bot, userId) {
    return __awaiter(this, void 0, void 0, function* () {
        const partner = bot.getPartner(userId);
        // First notify the partner (best effort)
        if (partner) {
            const reportKeyboard = telegraf_1.Markup.inlineKeyboard([
                [telegraf_1.Markup.button.callback("🚨 Report User", "OPEN_REPORT")]
            ]);
            try {
                yield bot.telegram.sendMessage(partner, "🚫 Partner left the chat\n\n/next - Find new partner\n\n━━━━━━━━━━━━━━━━━\nTo report this chat:", Object.assign({}, reportKeyboard));
                console.log(`[CLEANUP] - Notified partner ${partner} that user ${userId} left`);
            }
            catch (error) {
                console.log(`[CLEANUP] - Could not notify partner ${partner}:`, error);
            }
        }
        // Then perform cleanup
        cleanupBlockedUser(bot, userId);
    });
}
/**
 * End a chat properly when an error occurs with the partner
 */
function endChatDueToError(bot, userId, partnerId) {
    // Remove both users from running chats
    bot.runningChats = bot.runningChats.filter(u => u !== userId && u !== partnerId);
    // Clean up message maps
    bot.messageMap.delete(userId);
    bot.messageMap.delete(partnerId);
    console.log(`[CLEANUP] - Chat ended due to error: user ${userId}, partner ${partnerId}`);
}
/**
 * Handle a Telegram error, returning true if it was handled (e.g., bot blocked)
 * If partnerId is provided, the partner will be notified that the chat ended
 */
function handleTelegramError(bot, error, userId, partnerId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        if (isBotBlockedError(error)) {
            const blockedUserId = userId || ((_b = (_a = error.on) === null || _a === void 0 ? void 0 : _a.payload) === null || _b === void 0 ? void 0 : _b.chat_id);
            if (blockedUserId) {
                yield cleanupBlockedUserAsync(bot, blockedUserId);
            }
            console.log(`[HANDLED] - Bot blocked by user ${blockedUserId}`);
            return true;
        }
        if (isNotEnoughRightsError(error)) {
            const affectedUserId = userId || ((_d = (_c = error.on) === null || _c === void 0 ? void 0 : _c.payload) === null || _d === void 0 ? void 0 : _d.chat_id);
            if (affectedUserId) {
                yield cleanupBlockedUserAsync(bot, affectedUserId);
            }
            console.log(`[HANDLED] - Not enough rights error for user ${affectedUserId}`);
            return true;
        }
        // Log other errors but don't crash
        console.error(`[TELEGRAM ERROR] -`, error.message || error);
        return false;
    });
}
/**
 * Rate limiter to prevent Too Many Requests errors
 */
const messageQueue = [];
let isProcessingQueue = false;
const MIN_DELAY_MS = 1000; // Minimum 1 second between messages
let lastMessageTime = 0;
/**
 * Process the message queue with rate limiting
 */
function processMessageQueue() {
    return __awaiter(this, void 0, void 0, function* () {
        if (isProcessingQueue || messageQueue.length === 0)
            return;
        isProcessingQueue = true;
        while (messageQueue.length > 0) {
            const now = Date.now();
            const timeSinceLastMessage = now - lastMessageTime;
            // Wait if we need to respect rate limits
            if (timeSinceLastMessage < MIN_DELAY_MS) {
                yield new Promise(resolve => setTimeout(resolve, MIN_DELAY_MS - timeSinceLastMessage));
            }
            const item = messageQueue.shift();
            if (!item)
                continue;
            lastMessageTime = Date.now();
            try {
                const bot = require("../index").bot;
                yield bot.telegram.sendMessage(item.chatId, item.text, item.extra);
                item.resolve(true);
            }
            catch (error) {
                if (isBotBlockedError(error)) {
                    cleanupBlockedUserAsync(require("../index").bot, item.chatId);
                    item.resolve(false);
                }
                else if (isNotEnoughRightsError(error)) {
                    cleanupBlockedUserAsync(require("../index").bot, item.chatId);
                    item.resolve(false);
                }
                else if (isRateLimitError(error)) {
                    const delay = getRetryDelay(error) * 1000;
                    console.log(`[RATE LIMIT] - Retrying after ${delay}ms`);
                    // Put the message back at the front of the queue
                    messageQueue.unshift(item);
                    // Wait for the retry delay
                    yield new Promise(resolve => setTimeout(resolve, delay));
                }
                else {
                    console.error(`[SEND ERROR] -`, error.message || error);
                    item.resolve(false);
                }
            }
        }
        isProcessingQueue = false;
    });
}
/**
 * Safe send message wrapper that handles all errors with rate limiting
 */
function safeSendMessage(bot, chatId, text, extra) {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve) => {
            messageQueue.push({ chatId, text, extra, resolve });
            processMessageQueue();
            resolve(true); // Return immediately, actual result handled by queue
        });
    });
}
/**
 * Send message immediately (for critical messages) with retry logic
 */
function sendMessageWithRetry(bot_1, chatId_1, text_1, extra_1) {
    return __awaiter(this, arguments, void 0, function* (bot, chatId, text, extra, maxRetries = 3) {
        var _a, _b, _c, _d;
        // Validate chatId before attempting to send
        if (!chatId || chatId === 0) {
            console.error(`[SEND ERROR] - Invalid chatId: ${chatId}, message not sent`);
            return false;
        }
        let lastError;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                yield bot.telegram.sendMessage(chatId, text, extra);
                return true;
            }
            catch (error) {
                lastError = error;
                // Handle network errors (ECONNRESET, ETIMEDOUT, etc.)
                if (((_a = error.message) === null || _a === void 0 ? void 0 : _a.includes('ECONNRESET')) ||
                    ((_b = error.message) === null || _b === void 0 ? void 0 : _b.includes('ETIMEDOUT')) ||
                    ((_c = error.message) === null || _c === void 0 ? void 0 : _c.includes('network')) ||
                    ((_d = error.message) === null || _d === void 0 ? void 0 : _d.includes('fetch')) ||
                    error.code === 'ECONNREFUSED') {
                    console.log(`[NETWORK ERROR] - Network issue on attempt ${attempt + 1}/${maxRetries}, retrying...`);
                    yield new Promise(resolve => setTimeout(resolve, 2000));
                    continue;
                }
                if (isBotBlockedError(error)) {
                    yield cleanupBlockedUserAsync(bot, chatId);
                    return false;
                }
                if (isNotEnoughRightsError(error)) {
                    yield cleanupBlockedUserAsync(bot, chatId);
                    return false;
                }
                if (isRateLimitError(error)) {
                    const delay = getRetryDelay(error) * 1000;
                    console.log(`[RATE LIMIT] - Retry ${attempt + 1}/${maxRetries} after ${delay}ms`);
                    yield new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
                // For other errors, log and continue
                console.error(`[SEND ERROR] - Attempt ${attempt + 1}/${maxRetries}:`, error.message || error);
            }
        }
        console.error(`[SEND ERROR] - Failed after ${maxRetries} attempts:`, (lastError === null || lastError === void 0 ? void 0 : lastError.message) || lastError);
        return false;
    });
}
/**
 * Broadcast message to multiple users with rate limiting
 */
function broadcastWithRateLimit(bot, userIds, text, onProgress) {
    return __awaiter(this, void 0, void 0, function* () {
        let success = 0;
        let failed = 0;
        for (const userId of userIds) {
            const result = yield sendMessageWithRetry(bot, userId, text);
            if (result) {
                success++;
            }
            else {
                failed++;
            }
            if (onProgress) {
                onProgress(success, failed);
            }
            // Add delay between broadcasts to avoid rate limits
            if (userIds.indexOf(userId) < userIds.length - 1) {
                yield new Promise(resolve => setTimeout(resolve, MIN_DELAY_MS));
            }
        }
        return { success, failed };
    });
}
