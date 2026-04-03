import * as fs from "fs";
import * as path from "path";
import { bot, ExtraTelegraf } from "../index";
import { Context, Telegraf } from "telegraf";
import { Markup } from "telegraf";
import { updateUser, getUser, getReferralCount, banUser, isBanned, createReport, blockUserForUser, getBlockedUsers, unblockUserForUser, tempBanUser } from "../storage/db";
import { handleTelegramError } from "./telegramErrorHandler";
import { isAdmin, ADMINS } from "./adminAuth";
import { safeAnswerCbQuery as safeAnswerCbQueryShared, safeEditMessageText as safeEditMessageTextShared, getErrorMessage } from "./telegramUi";
import searchCommand from "../Commands/search";
import referralCommand from "../Commands/referral";
import endCommand from "../Commands/end";
import {
    getSetupCompleteText,
    indianLocationOptions,
    locationValues,
    settingsStateKeyboard,
    setupStateKeyboardPage1 as sharedSetupStateKeyboard
} from "./setupFlow";
import { showPremiumPurchaseMenu, isPremium } from "./starsPayments";
import { isModerationEnabled, getAutoWarnThreshold, getAutoTempBanThreshold, getAutoBanThreshold, getTempBanDurationMs } from "../admin/moderationSettings";
import { updateUserPreferenceInQueue } from "../admin/queueMonitor";

// Valid preference options
export const genderOptions = ["male", "female", "any"] as const;
export type GenderPreference = typeof genderOptions[number];

// Valid gender options
export const userGenderOptions = ["male", "female"] as const;
export type UserGender = typeof userGenderOptions[number];

// Valid state options
export const stateOptions = locationValues;
export type UserState = string;

// Because it doesn't know that ctx has a match property. by default, Context<Update> doesn't include match, but telegraf adds it dynamically when using regex triggers.
export interface ActionContext extends Context {
    match?: RegExpMatchArray;
}

export interface Action {
    name: string | RegExp;
    execute: (ctx: ActionContext, bot: Telegraf<Context>) => Promise<unknown>;
    disabled?: boolean;
}

type TelegramEditError = {
  description?: string;
  message?: string;
};

function asTelegramEditError(error: unknown): TelegramEditError {
  return typeof error === "object" && error !== null ? error as TelegramEditError : {};
}

// ==================== Search UI Functions ====================

// Search animation messages
const SEARCH_MESSAGES = [
  "🔎 Searching for a partner…",
  "🔎 Finding best match…",
  "🔎 Almost there…"
];

/**
 * Global cleanup function - removes user from ALL states
 * Prevents: ghost users, stuck matches, memory leaks
 * FIX #1: Now removes from queues and runningChats
 */
export function removeUserEverywhere(bot: ExtraTelegraf, userId: number): void {
  // 1. Clear search map and interval
  const searchData = bot.userSearchMap.get(userId);
  if (searchData?.interval) {
    clearInterval(searchData.interval);
    console.log(`[CLEANUP] Cleared interval for user ${userId}`);
  }
  bot.userSearchMap.delete(userId);
  
  // 2. Remove from regular queue (safety net)
  const queueIdx = bot.waitingQueue.findIndex(u => u.id === userId);
  if (queueIdx !== -1) {
    bot.waitingQueue.splice(queueIdx, 1);
    bot.queueSet.delete(userId);
    console.log(`[CLEANUP] Removed user ${userId} from waiting queue`);
  }
  
  // 3. Remove from premium queue (safety net)
  const premiumIdx = bot.premiumQueue.findIndex(u => u.id === userId);
  if (premiumIdx !== -1) {
    bot.premiumQueue.splice(premiumIdx, 1);
    bot.premiumQueueSet.delete(userId);
    console.log(`[CLEANUP] Removed user ${userId} from premium queue`);
  }
  
  // 4. Remove from running chats (safety net)
  if (bot.runningChats.has(userId)) {
    bot.runningChats.delete(userId);
    console.log(`[CLEANUP] Removed user ${userId} from running chats`);
  }

  // Re-sync queue structures/maps after direct array/set mutations
  bot.syncQueueState();
  
  console.log(`[CLEANUP] Fully cleaned user ${userId} from all states`);
}

/**
 * Start searching - show "Searching..." message with Stop button and animation
 * FIX #2: Prevent duplicate search - check if already searching
 * FIX #3: Prevent interval duplication - clear existing interval first
 */
export async function startSearch(ctx: ActionContext, bot: ExtraTelegraf, userId: number): Promise<void> {
  // FIX #2: Prevent duplicate searches
  if (bot.userSearchMap.has(userId)) {
    console.log(`[startSearch] User ${userId} already searching, ignoring`);
    return;
  }
  
  // FIX #3: Clear any existing interval before creating new one
  const existing = bot.userSearchMap.get(userId);
  if (existing?.interval) {
    clearInterval(existing.interval);
    console.log(`[startSearch] Cleared existing interval for user ${userId}`);
  }
  
  const stopKeyboard = {
    inline_keyboard: [
      [{ text: "⛔ Stop", callback_data: "stop_search" }]
    ]
  };
  
  try {
    const sentMessage = await ctx.reply(SEARCH_MESSAGES[0], {
      reply_markup: stopKeyboard
    });
    
    if (sentMessage && 'message_id' in sentMessage) {
      // Start animation interval
      let messageIndex = 0;
      const interval = setInterval(async () => {
        // FIX #8: INTERVAL SAFETY - Check if user still in search map
        if (!bot.userSearchMap.has(userId)) {
          clearInterval(interval);
          return;
        }
        
        // Check if user was matched
        if (bot.runningChats.has(userId)) {
          clearInterval(interval);
          return;
        }
        
        messageIndex = (messageIndex + 1) % SEARCH_MESSAGES.length;
        try {
          await bot.telegram.editMessageText(
            sentMessage.chat.id,
            sentMessage.message_id,
            undefined,
            SEARCH_MESSAGES[messageIndex],
            { reply_markup: stopKeyboard }
          );
        } catch (err: unknown) {
          const telegramError = asTelegramEditError(err);
          // FIX #10: IMPROVED ERROR LOGGING
          if (!telegramError.description?.includes("message is not modified")) {
            console.error(`[ANIMATION] Error editing message for user ${userId}:`, telegramError.message || err);
            clearInterval(interval);
          }
        }
      }, 2500); // Rotate every 2.5 seconds
      
      // Store message info with interval
      bot.userSearchMap.set(userId, {
        chatId: sentMessage.chat.id,
        messageId: sentMessage.message_id,
        interval
      });
      
      console.log(`[SEARCH] User ${userId} started searching with animation`);
    }
  } catch (error) {
    console.error(`[startSearch] Failed to send search message for user ${userId}:`, error);
  }
}

/**
 * Stop searching - uses global cleanup for memory safety
 */
export async function stopSearch(bot: ExtraTelegraf, userId: number): Promise<void> {
  const searchInfo = bot.userSearchMap.get(userId);
  
  if (!searchInfo) {
    console.log(`[stopSearch] No search message found for user ${userId}`);
    return;
  }
  
  // Clear animation interval
  if (searchInfo.interval) {
    clearInterval(searchInfo.interval);
  }
  
  // Remove from all queues (ensure complete cleanup)
  try {
    await bot.removeFromQueue(userId);
    await bot.removeFromPremiumQueue(userId);
  } catch (error) {
    console.error(`[stopSearch] Error removing user ${userId} from queue:`, error);
  }
  
  // Use removeUserEverywhere for safety net cleanup
  removeUserEverywhere(bot, userId);
  await updateUser(userId, { queueStatus: "removed", queueJoinedAt: null });
  
  try {
    // Edit message to remove keyboard and show "stopped"
    await bot.telegram.editMessageText(
      searchInfo.chatId,
      searchInfo.messageId,
      undefined,
      "🚫 Search cancelled\n👉 Use /next to find a new partner",
      { reply_markup: { inline_keyboard: [] } }
    );
    console.log(`[stopSearch] Updated message for user ${userId}`);
  } catch (err: unknown) {
    const telegramError = asTelegramEditError(err);
    // SAFE ERROR LOGGING: Log meaningful errors
    if (!telegramError.description?.includes("message is not modified") && 
        !telegramError.description?.includes("message to edit not found")) {
      console.error(`[stopSearch] Error for user ${userId}:`, telegramError.message || err);
    }
  }
  
  // Clean up
  bot.userSearchMap.delete(userId);
}

/**
 * On match found - with delay for human-like UX
 * Uses global cleanup for memory safety
 */
export async function onMatchFound(bot: ExtraTelegraf, userId: number): Promise<void> {
  const searchInfo = bot.userSearchMap.get(userId);
  
  if (!searchInfo) {
    // No search message to update - this can happen if user was matched immediately
    console.log(`[onMatchFound] No search message for user ${userId} (immediate match?)`);
    return;
  }
  
  // Clear animation interval
  if (searchInfo.interval) {
    clearInterval(searchInfo.interval);
  }
  
  try {
    // Edit message to show "Partner found!" and remove keyboard
    await bot.telegram.editMessageText(
      searchInfo.chatId,
      searchInfo.messageId,
      undefined,
      "🎉 Partner found!\n⏳ Connecting...",
      { reply_markup: { inline_keyboard: [] } }
    );
    console.log(`[onMatchFound] Updated message for user ${userId}`);
  } catch (err: unknown) {
    const telegramError = asTelegramEditError(err);
    // SAFE ERROR LOGGING
    if (!telegramError.description?.includes("message is not modified") && 
        !telegramError.description?.includes("message to edit not found")) {
      console.error(`[onMatchFound] Error for user ${userId}:`, telegramError.message || err);
    }
  }
  
  // Clean up
  bot.userSearchMap.delete(userId);
}

/**
 * Send connection message after match - with delay for human-like UX
 * Called after onMatchFound with 1.2s delay
 */
export async function sendConnectionMessage(bot: ExtraTelegraf, userId: number): Promise<void> {
  try {
    await bot.telegram.sendMessage(userId, "💬 You are now connected. Say hi!");
    console.log(`[Connection] Sent to user ${userId}`);
  } catch (err: unknown) {
    const telegramError = asTelegramEditError(err);
    // User might have blocked bot - that's okay, but log it
    if (!telegramError.description?.includes("bot was blocked")) {
      console.error(`[Connection] Error sending to user ${userId}:`, telegramError.message || err);
    }
  }
}

// ==================== Action Handlers ====================

/**
 * Stop Search button handler - uses global cleanup for memory safety
 */
bot.action("stop_search", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  
  try {
    await ctx.answerCbQuery();
  } catch {
    // Ignore callback query errors
  }
  
  // Check if user was already matched (ignore if so)
  if (bot.runningChats.has(userId)) {
    return; // User was already matched, ignore stop action
  }
  
  console.log("STOP BUTTON CLICKED:", userId);
  
  // Use stopSearch to properly clean up - updates message, clears interval, removes from queues
  await stopSearch(bot, userId);
});

export function loadActions() {
    try {
        // Check dist/Commands first (for production), then src/Commands (for development)
        let commandsDir = path.join(process.cwd(), "dist/Commands");
        if (process.env.NODE_ENV === "test" || !fs.existsSync(commandsDir)) {
            commandsDir = path.join(process.cwd(), "src/Commands");
        }
        
        const Files: string[] = [];
        const loadErrors: string[] = [];
        
        // Recursively get all .js files in Commands directory
        function getAllFiles(dir: string): void {
            if (!fs.existsSync(dir)) return;
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    getAllFiles(fullPath);
                } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.ts'))) {
                    Files.push(fullPath);
                }
            }
        }
        getAllFiles(commandsDir);

        for (const file of Files) {
            // Ensure absolute path for require
            const absolutePath = path.resolve(file);
            const actionFile = require(absolutePath).default;
            
            // Skip if not a valid action (command files don't have 'execute' as async action handler)
            if (!actionFile || typeof actionFile !== 'object') continue;
            
            const action = actionFile as Action;

            if (action.disabled) continue;

            const actionName = action.name;
            if (!actionName || typeof actionName === 'string' && (actionName === 'start' || actionName === 'help' || actionName === 'search' || actionName === 'next' || actionName === 'end' || actionName === 'settings' || actionName === 'report' || actionName === 'adminaccess' || actionName === 'ping' || actionName === 'find' || actionName === 'setgender' || actionName === 'ban' || actionName === 'broadcast' || actionName === 'active')) continue;

            try {
                bot.action(actionName, async (ctx) => {
                    try {
                        await action.execute(ctx, bot);
                    } catch (err) {
                        const userId = ctx.from?.id;
                        handleTelegramError(bot, err, userId);
                    }
                });
            } catch (error) {
                console.error(`[ActionHandler] -`, error);
                const message = error instanceof Error ? error.message : String(error);
                loadErrors.push(`${path.basename(file)}: ${message}`);
            }
        }

        if (loadErrors.length > 0) {
            throw new Error(`Failed to load actions:\n${loadErrors.join("\n")}`);
        }

        console.info(`[INFO] - Actions Loaded`);
    } catch (err) {
        console.error(`[ActionHandler] -`, err);
        throw err;
    }
}

const premiumPreferenceMessage =
"*Gender Preference - Premium Feature*\n\n" +
"Setting gender preference is available only for Premium users.\n\n" +
"✨ *Premium Features:*\n" +
"• Set gender preference (Male/Female)\n" +
"• See partner's gender\n" +
"• Better matching control\n" +
"• Block list access\n\n" +
"💎 Buy Premium: /premium\n" +
"🎁 Or earn free Premium via /settings -> Referrals!\n\n" +
"💳 *Payment Issues?* Contact @demonhunter1511";

const premiumBlockMessage =
"*Premium Feature*\n\n" +
"Block list is available only for Premium users.\n\n" +
"To buy Premium: open /settings and tap *Premium*.";

const genderKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("👨 Male", "GENDER_MALE")],
    [Markup.button.callback("👩 Female", "GENDER_FEMALE")],
    [Markup.button.callback("🔙 Back", "OPEN_SETTINGS")]
]);
const stateKeyboard = settingsStateKeyboard;
const backKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🔙 Main Menu", "BACK_MAIN_MENU")]
]);
const preferenceKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("Any", "PREF_ANY")],
    [Markup.button.callback("Male", "PREF_MALE")],
    [Markup.button.callback("Female", "PREF_FEMALE")],
    [Markup.button.callback("🔙 Back", "OPEN_SETTINGS")]
]);
const mainMenuKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🔍 Find Partner", "START_SEARCH")],
    [Markup.button.callback("⚙️ Settings", "OPEN_SETTINGS")],
    [Markup.button.callback("🎁 Referrals", "OPEN_REFERRAL")],
    [Markup.button.callback("❓ Help", "START_HELP")]
]);

// Group verification settings
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID || "-1001234567890";
const GROUP_INVITE_LINK = process.env.GROUP_INVITE_LINK || "https://t.me/teluguanomychat";

// Check if user is a member of the group
async function isUserGroupMember(userId: number): Promise<boolean> {
    try {
        // Use GROUP_CHAT_ID directly - Telegram API requires numeric chat ID
        const chatId = GROUP_CHAT_ID;
        const chatMember = await bot.telegram.getChatMember(chatId, userId);
        // Member status: 'creator', 'administrator', 'member', 'restricted' are valid
        const validStatuses = ['creator', 'administrator', 'member', 'restricted'];
        return validStatuses.includes(chatMember.status);
    } catch (error) {
        console.error(`[GroupCheck] - Error checking group membership for user ${userId}:`, error);
        return false;
    }
}

// Safe answerCallbackQuery helper
async function safeAnswerCbQuery(ctx: ActionContext, text?: string) {
    await safeAnswerCbQueryShared(ctx, text);
}

// Check and apply action cooldown - returns true if action should be blocked
function checkAndApplyCooldown(ctx: ActionContext, action: string): boolean {
    const userId = ctx.from?.id;
    if (!userId) return false;

    if (bot.isActionOnCooldown(userId, action)) {
        return true;
    }
    bot.setActionCooldown(userId, action);
    return false;
}

// Safe editMessageText helper - handles all errors with fallback to reply
// This prevents UI freeze when message can't be edited (too old, deleted, etc.)
async function safeEditMessageText(ctx: ActionContext, text: string, extra?: Parameters<Context["reply"]>[1]) {
    try {
        await safeEditMessageTextShared(ctx, text, extra);
    } catch (error: unknown) {
        // Send user feedback on failure
        console.error("[safeEditMessageText] Failed to edit/reply:", getErrorMessage(error));
        try {
            await safeAnswerCbQueryShared(ctx, "Something went wrong. Please try again.");
        } catch {
            // Ignore
        }
    }
}

// Function to show settings menu - exported for use by /settings command
export async function showSettings(ctx: ActionContext) {
    if (!ctx.from) return;
    const u = await getUser(ctx.from.id);
    const referralCount = await getReferralCount(ctx.from.id);

    const genderDisplay = u.gender ?? "Not Set";

    const text =
    `⚙️ Settings
 
 👤 Gender: ${genderDisplay}
 🎂 Age: ${u.age ?? "Not Set"}
 📍 State: ${u.state ?? "Not Set"}
 💕 Preference: ${u.premium ? (u.preference === "any" ? "Any" : u.preference === "male" ? "Male" : "Female") : "🔒 Premium Only"}
 💎 Premium: ${u.premium ? "Yes ✅" : "No ❌"}
 🚫 Blocked Users: ${(u.blockedUsers || []).length}
  💬 Chats: Unlimited
 👥 Referrals: ${referralCount}/30

 Use buttons below to update:`;

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback("👤 Gender", "SET_GENDER")],
        [Markup.button.callback("🎂 Age", "SET_AGE")],
        [Markup.button.callback("📍 State", "SET_STATE")],
        [Markup.button.callback("💕 Preference", "SET_PREFERENCE")],
        [Markup.button.callback("🚫 Blocked Users", "OPEN_BLOCKED_USERS")],
        [Markup.button.callback("🎁 Referrals", "OPEN_REFERRAL")],
        [Markup.button.callback("⭐ Premium", "BUY_PREMIUM")]
    ]);

    // Use edit for callback queries, reply for regular commands
    if (ctx.callbackQuery) {
        await safeEditMessageText(ctx, text, { parse_mode: "Markdown", ...keyboard });
    } else {
        await ctx.reply(text, { parse_mode: "Markdown", ...keyboard });
    }
}

function buildBlockedUsersView(blockedUsers: number[]) {
    const MAX_VISIBLE = 40;
    const visibleUsers = blockedUsers.slice(0, MAX_VISIBLE);
    const hiddenCount = blockedUsers.length - visibleUsers.length;

    if (blockedUsers.length === 0) {
        return {
            text: "You have not blocked anyone yet.",
            keyboard: Markup.inlineKeyboard([[Markup.button.callback("Back", "OPEN_SETTINGS")]])
        };
    }

    const lines = visibleUsers.map((id, index) => `${index + 1}. User ${id}`);
    const rows = visibleUsers.map((id) => [Markup.button.callback(`Unblock ${id}`, `UNBLOCK_USER_${id}`)]);
    rows.push([Markup.button.callback("Back", "OPEN_SETTINGS")]);

    const hiddenText = hiddenCount > 0 ? `\n\n+${hiddenCount} more not shown` : "";

    return {
        text: `Blocked users: ${blockedUsers.length}\n\n${lines.join("\n")}${hiddenText}\n\nTap a user button below to unblock.`,
        keyboard: Markup.inlineKeyboard(rows)
    };
}

async function showBlockedUsersMenu(ctx: ActionContext) {
    if (!ctx.from) return;

    const user = await getUser(ctx.from.id);
    // Use isPremium to check both premium flag AND expiry
    if (!isPremium(user)) {
        await safeEditMessageText(
            ctx,
            premiumBlockMessage,
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([[Markup.button.callback("Open Settings", "OPEN_SETTINGS")]])
            }
        );
        return;
    }

    const blockedUsers = await getBlockedUsers(ctx.from.id);
    const view = buildBlockedUsersView(blockedUsers);
    await safeEditMessageText(ctx, view.text, view.keyboard);
}

// Open settings
bot.action("OPEN_SETTINGS", async (ctx) => {
    // Check cooldown to prevent button spamming
    if (checkAndApplyCooldown(ctx, "OPEN_SETTINGS")) {
        await safeAnswerCbQuery(ctx);
        return;
    }
    
    // Clean up waitingForAge if user backed out from age input
    if (ctx.from) {
        waitingForAge.delete(ctx.from.id);
    }
    
    await safeAnswerCbQuery(ctx);
    await showSettings(ctx);
});

// Start menu actions
bot.action("START_SEARCH", async (ctx) => {
    // Check cooldown to prevent button spamming
    if (checkAndApplyCooldown(ctx, "START_SEARCH")) {
        await safeAnswerCbQuery(ctx, "Please wait a moment...");
        return;
    }
    await safeAnswerCbQuery(ctx);
    // Trigger search command
    await searchCommand.execute(ctx, bot);
});

bot.action("START_HELP", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    await ctx.reply(
        "📚 *Available Commands:*\n\n" +
        "/start - Start the bot\n" +
        "/search - Find a chat partner\n" +
        "/next - Skip current chat and find new partner\n" +
        "/end - End the current chat\n" +
        "/settings - Open settings menu\n" +
        "/report - Report a user\n" +
        "/help - Show this help message",
        { parse_mode: "Markdown" }
    );
});

// ==============================
// NEW USER SETUP HANDLERS
// ==============================

// Setup age manual input keyboard (NO BACK/CANCEL - must complete)
const setupAgeManualKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("⬅️ Back", "SETUP_BACK_AGE")]
]);

// Welcome back handler
bot.action("WELCOME_BACK", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await safeEditMessageText(ctx,
        "🌟 *Welcome to Anonymous Chat!* 🌟\n\n" +
        "✨ Connect with strangers anonymously\n" +
        "🔒 Your privacy is protected\n" +
        "💬 Chat freely and safely\n\n" +
        "Tap *Get Started* to begin!",
        { parse_mode: "Markdown", ...Markup.inlineKeyboard([
            [Markup.button.callback("🌟 Get Started", "SETUP_BACK_GENDER")]
        ]) }
    );
});

// Setup gender keyboard with NO BACK/CANCEL - must complete setup
const setupGenderKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("👨 Male", "SETUP_GENDER_MALE")],
    [Markup.button.callback("👩 Female", "SETUP_GENDER_FEMALE")]
]);

// Setup age keyboard with ranges and manual input option (NO BACK/CANCEL)
const setupAgeKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("15", "SETUP_AGE_13_17")],
    [Markup.button.callback("22", "SETUP_AGE_18_25")],
    [Markup.button.callback("33", "SETUP_AGE_26_40")],
    [Markup.button.callback("45", "SETUP_AGE_40_PLUS")],
    [Markup.button.callback("📝 Type Age", "SETUP_AGE_MANUAL")]
]);

// Setup state keyboard - Page 1 with regions (NO BACK/CANCEL - must complete)
const setupStateKeyboardPage1 = Markup.inlineKeyboard([
    [Markup.button.callback("📍 North India", "SETUP_STATE_NORTH")],
    [Markup.button.callback("📍 South India", "SETUP_STATE_SOUTH")],
    [Markup.button.callback("📍 East India", "SETUP_STATE_EAST")],
    [Markup.button.callback("📍 West India", "SETUP_STATE_WEST")],
    [Markup.button.callback("📍 Central India", "SETUP_STATE_CENTRAL")],
    [Markup.button.callback("📍 North-East India", "SETUP_STATE_NORTHEAST")],
    [Markup.button.callback("📍 Union Territories", "SETUP_STATE_UT")],
    [Markup.button.callback("🌍 Outside India", "SETUP_COUNTRY_OTHER")]
]);

const setupStateNorthKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🟢 Delhi", "SETUP_STATE_DELHI")],
    [Markup.button.callback("🟢 Haryana", "SETUP_STATE_HARYANA")],
    [Markup.button.callback("🟢 Himachal Pradesh", "SETUP_STATE_HIMACHAL")],
    [Markup.button.callback("🟢 Jammu & Kashmir", "SETUP_STATE_JAMMU")],
    [Markup.button.callback("🟢 Punjab", "SETUP_STATE_PUNJAB")],
    [Markup.button.callback("🟢 Rajasthan", "SETUP_STATE_RAJASTHAN")],
    [Markup.button.callback("🟢 Uttarakhand", "SETUP_STATE_UTTARAKHAND")],
    [Markup.button.callback("🟢 Uttar Pradesh", "SETUP_STATE_UTTARPRADESH")],
    [Markup.button.callback("⬅️ Back", "SETUP_BACK_STATE_P1")]
]);

const setupStateSouthKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🔵 Andhra Pradesh", "SETUP_STATE_AP")],
    [Markup.button.callback("🔵 Karnataka", "SETUP_STATE_KARNATAKA")],
    [Markup.button.callback("🔵 Kerala", "SETUP_STATE_KERALA")],
    [Markup.button.callback("🔵 Tamil Nadu", "SETUP_STATE_TAMILNADU")],
    [Markup.button.callback("🔵 Telangana", "SETUP_STATE_TELANGANA")],
    [Markup.button.callback("⬅️ Back", "SETUP_BACK_STATE_P1")]
]);

const setupStateEastKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🟠 Bihar", "SETUP_STATE_BIHAR")],
    [Markup.button.callback("🟠 Jharkhand", "SETUP_STATE_JHARKHAND")],
    [Markup.button.callback("🟠 Odisha", "SETUP_STATE_ODISHA")],
    [Markup.button.callback("🟠 West Bengal", "SETUP_STATE_WESTBENGAL")],
    [Markup.button.callback("⬅️ Back", "SETUP_BACK_STATE_P1")]
]);

const setupStateWestKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🟣 Goa", "SETUP_STATE_GOA")],
    [Markup.button.callback("🟣 Gujarat", "SETUP_STATE_GUJARAT")],
    [Markup.button.callback("🟣 Maharashtra", "SETUP_STATE_MAHARASHTRA")],
    [Markup.button.callback("⬅️ Back", "SETUP_BACK_STATE_P1")]
]);

const setupStateCentralKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🟤 Chhattisgarh", "SETUP_STATE_CHHATTISGARH")],
    [Markup.button.callback("🟤 Madhya Pradesh", "SETUP_STATE_MADHYAPRADESH")],
    [Markup.button.callback("⬅️ Back", "SETUP_BACK_STATE_P1")]
]);

const setupStateNortheastKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🟢 Arunachal Pradesh", "SETUP_STATE_ARUNACHAL")],
    [Markup.button.callback("🟢 Assam", "SETUP_STATE_ASSAM")],
    [Markup.button.callback("🟢 Manipur", "SETUP_STATE_MANIPUR")],
    [Markup.button.callback("🟢 Meghalaya", "SETUP_STATE_MEGHALAYA")],
    [Markup.button.callback("🟢 Mizoram", "SETUP_STATE_MIZORAM")],
    [Markup.button.callback("🟢 Nagaland", "SETUP_STATE_NAGALAND")],
    [Markup.button.callback("🟢 Sikkim", "SETUP_STATE_SIKKIM")],
    [Markup.button.callback("🟢 Tripura", "SETUP_STATE_TRIPURA")],
    [Markup.button.callback("⬅️ Back", "SETUP_BACK_STATE_P1")]
]);

const setupStateUTKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🟠 Chandigarh", "SETUP_STATE_CHANDIGARH")],
    [Markup.button.callback("🟠 Delhi", "SETUP_STATE_DELHI")],
    [Markup.button.callback("🟠 Jammu & Kashmir", "SETUP_STATE_JAMMU")],
    [Markup.button.callback("🟠 Ladakh", "SETUP_STATE_LADAKH")],
    [Markup.button.callback("🟠 Puducherry", "SETUP_STATE_PUDUCHERRY")],
    [Markup.button.callback("🟠 Andaman & Nicobar", "SETUP_STATE_ANDAMAN")],
    [Markup.button.callback("⬅️ Back", "SETUP_BACK_STATE_P1")]
]);

const setupStateKeyboardFull = sharedSetupStateKeyboard;

// Gender selected - move to age input
bot.action("SETUP_GENDER_MALE", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { gender: "male", setupStep: "age" });
    await safeEditMessageText(ctx,
        "📝 *Step 2 of 3*\n\n" +
        "🎂 *Select your age:*\n" +
        "(Choose the option closest to your age)",
        { parse_mode: "Markdown", ...setupAgeKeyboard }
    );
});

bot.action("SETUP_GENDER_FEMALE", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { gender: "female", setupStep: "age" });
    await safeEditMessageText(ctx,
        "📝 *Step 2 of 3*\n\n" +
        "🎂 *Select your age:*\n" +
        "(Choose the option closest to your age)",
        { parse_mode: "Markdown", ...setupAgeKeyboard }
    );
});

// Age range selected - ask for state (show new regional selection)
const ageToGenderMap: Record<string, string> = {
    "SETUP_AGE_13_17": "15",
    "SETUP_AGE_18_25": "22",
    "SETUP_AGE_26_40": "33",
    "SETUP_AGE_40_PLUS": "45"
};

for (const [action, ageLabel] of Object.entries(ageToGenderMap)) {
    bot.action(action, async (ctx) => {
        if (!ctx.from) return;
        await safeAnswerCbQuery(ctx);
        await updateUser(ctx.from.id, { age: ageLabel, setupStep: "state" });
        await safeEditMessageText(ctx,
            "📝 *Step 3 of 3*\n\n" +
            "📍 *Select your location:*\n" +
            "(Choose your Indian state/territory)",
            { parse_mode: "Markdown", ...setupStateKeyboardFull }
        );
    });
}

// Manual age input - ask user to type their age
bot.action("SETUP_AGE_MANUAL", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await safeEditMessageText(ctx,
        "📝 *Enter your age:*\n\n" +
        "Please type a number between 13 and 80\n" +
        "(e.g., 21)",
        { parse_mode: "Markdown", ...setupAgeManualKeyboard }
    );
});

// Region selected - show respective state keyboard
bot.action("SETUP_STATE_NORTH", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await safeEditMessageText(ctx,
        "📍 *North India*\n\nSelect your state:",
        { parse_mode: "Markdown", ...setupStateNorthKeyboard }
    );
});

bot.action("SETUP_STATE_SOUTH", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await safeEditMessageText(ctx,
        "📍 *South India*\n\nSelect your state:",
        { parse_mode: "Markdown", ...setupStateSouthKeyboard }
    );
});

bot.action("SETUP_STATE_EAST", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await safeEditMessageText(ctx,
        "📍 *East India*\n\nSelect your state:",
        { parse_mode: "Markdown", ...setupStateEastKeyboard }
    );
});

bot.action("SETUP_STATE_WEST", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await safeEditMessageText(ctx,
        "📍 *West India*\n\nSelect your state:",
        { parse_mode: "Markdown", ...setupStateWestKeyboard }
    );
});

bot.action("SETUP_STATE_CENTRAL", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await safeEditMessageText(ctx,
        "📍 *Central India*\n\nSelect your state:",
        { parse_mode: "Markdown", ...setupStateCentralKeyboard }
    );
});

bot.action("SETUP_STATE_NORTHEAST", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await safeEditMessageText(ctx,
        "📍 *North-East India*\n\nSelect your state:",
        { parse_mode: "Markdown", ...setupStateNortheastKeyboard }
    );
});

bot.action("SETUP_STATE_UT", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await safeEditMessageText(ctx,
        "📍 *Union Territories*\n\nSelect your UT:",
        { parse_mode: "Markdown", ...setupStateUTKeyboard }
    );
});

// Back to region selection
bot.action("SETUP_BACK_STATE_P1", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await safeEditMessageText(ctx,
        "📝 *Step 3 of 3*\n\n" +
        "📍 *Select your location:*\n" +
        "(Choose your Indian state/territory)",
        { parse_mode: "Markdown", ...setupStateKeyboardFull }
    );
});

// North India States
bot.action("SETUP_STATE_DELHI", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Delhi", setupStep: "done" });
    await showSetupComplete(ctx);
});

bot.action("SETUP_STATE_HARYANA", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Haryana", setupStep: "done" });
    await showSetupComplete(ctx);
});

bot.action("SETUP_STATE_HIMACHAL", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Himachal Pradesh", setupStep: "done" });
    await showSetupComplete(ctx);
});

bot.action("SETUP_STATE_JAMMU", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Jammu & Kashmir", setupStep: "done" });
    await showSetupComplete(ctx);
});

bot.action("SETUP_STATE_PUNJAB", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Punjab", setupStep: "done" });
    await showSetupComplete(ctx);
});

bot.action("SETUP_STATE_RAJASTHAN", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Rajasthan", setupStep: "done" });
    await showSetupComplete(ctx);
});

bot.action("SETUP_STATE_UTTARAKHAND", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Uttarakhand", setupStep: "done" });
    await showSetupComplete(ctx);
});

bot.action("SETUP_STATE_UTTARPRADESH", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Uttar Pradesh", setupStep: "done" });
    await showSetupComplete(ctx);
});

// South India States
bot.action("SETUP_STATE_KARNATAKA", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Karnataka", setupStep: "done" });
    await showSetupComplete(ctx);
});

bot.action("SETUP_STATE_KERALA", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Kerala", setupStep: "done" });
    await showSetupComplete(ctx);
});

bot.action("SETUP_STATE_TAMILNADU", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Tamil Nadu", setupStep: "done" });
    await showSetupComplete(ctx);
});

// East India States
bot.action("SETUP_STATE_BIHAR", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Bihar", setupStep: "done" });
    await showSetupComplete(ctx);
});

bot.action("SETUP_STATE_JHARKHAND", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Jharkhand", setupStep: "done" });
    await showSetupComplete(ctx);
});

bot.action("SETUP_STATE_ODISHA", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Odisha", setupStep: "done" });
    await showSetupComplete(ctx);
});

bot.action("SETUP_STATE_WESTBENGAL", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "West Bengal", setupStep: "done" });
    await showSetupComplete(ctx);
});

// West India States
bot.action("SETUP_STATE_GOA", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Goa", setupStep: "done" });
    await showSetupComplete(ctx);
});

bot.action("SETUP_STATE_GUJARAT", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Gujarat", setupStep: "done" });
    await showSetupComplete(ctx);
});

bot.action("SETUP_STATE_MAHARASHTRA", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Maharashtra", setupStep: "done" });
    await showSetupComplete(ctx);
});

// Central India States
bot.action("SETUP_STATE_CHHATTISGARH", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Chhattisgarh", setupStep: "done" });
    await showSetupComplete(ctx);
});

bot.action("SETUP_STATE_MADHYAPRADESH", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Madhya Pradesh", setupStep: "done" });
    await showSetupComplete(ctx);
});

// North-East India States
bot.action("SETUP_STATE_ARUNACHAL", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Arunachal Pradesh", setupStep: "done" });
    await showSetupComplete(ctx);
});

bot.action("SETUP_STATE_ASSAM", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Assam", setupStep: "done" });
    await showSetupComplete(ctx);
});

bot.action("SETUP_STATE_MANIPUR", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Manipur", setupStep: "done" });
    await showSetupComplete(ctx);
});

bot.action("SETUP_STATE_MEGHALAYA", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Meghalaya", setupStep: "done" });
    await showSetupComplete(ctx);
});

bot.action("SETUP_STATE_MIZORAM", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Mizoram", setupStep: "done" });
    await showSetupComplete(ctx);
});

bot.action("SETUP_STATE_NAGALAND", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Nagaland", setupStep: "done" });
    await showSetupComplete(ctx);
});

bot.action("SETUP_STATE_SIKKIM", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Sikkim", setupStep: "done" });
    await showSetupComplete(ctx);
});

bot.action("SETUP_STATE_TRIPURA", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Tripura", setupStep: "done" });
    await showSetupComplete(ctx);
});

// Union Territories
bot.action("SETUP_STATE_CHANDIGARH", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Chandigarh", setupStep: "done" });
    await showSetupComplete(ctx);
});

bot.action("SETUP_STATE_LADAKH", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Ladakh", setupStep: "done" });
    await showSetupComplete(ctx);
});

bot.action("SETUP_STATE_PUDUCHERRY", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Puducherry", setupStep: "done" });
    await showSetupComplete(ctx);
});

bot.action("SETUP_STATE_ANDAMAN", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Andaman & Nicobar", setupStep: "done" });
    await showSetupComplete(ctx);
});

// Keep Telangana and AP for backward compatibility (some existing callbacks may reference these)
bot.action("SETUP_STATE_TELANGANA", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Telangana", setupStep: "done" });
    await showSetupComplete(ctx);
});

bot.action("SETUP_STATE_AP", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Andhra Pradesh", setupStep: "done" });
    await showSetupComplete(ctx);
});

// Outside India
bot.action("SETUP_COUNTRY_OTHER", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    await updateUser(ctx.from.id, { state: "Other", setupStep: "done" });
    await showSetupComplete(ctx);
});

for (const option of indianLocationOptions) {
    if (option.code === "AP") continue;

    bot.action(`SETUP_STATE_${option.code}`, async (ctx) => {
        if (!ctx.from) return;
        await safeAnswerCbQuery(ctx);
        await updateUser(ctx.from.id, { state: option.storedValue, setupStep: "done" });
        await showSetupComplete(ctx);
    });
}

// Back actions
bot.action("SETUP_BACK_GENDER", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    await safeEditMessageText(ctx,
        "📝 *Step 1 of 3*\n" +
        "👤 *Select your gender:*",
        { parse_mode: "Markdown", ...setupGenderKeyboard }
    );
});

bot.action("SETUP_BACK_AGE", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    await safeEditMessageText(ctx,
        "📝 *Step 2 of 3*\n\n" +
        "🎂 *Select your age:*\n" +
        "(Choose the option closest to your age)",
        { parse_mode: "Markdown", ...setupAgeKeyboard }
    );
});

bot.action("SETUP_BACK_STATE", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    await safeEditMessageText(ctx,
        "📝 *Step 3 of 3*\n\n" +
        "📍 *Select your location:*\n" +
        "(Choose your Indian state/territory)",
        { parse_mode: "Markdown", ...setupStateKeyboardFull }
    );
});

// Cancel setup - redirect to complete setup instead of allowing cancel
bot.action("SETUP_CANCEL", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    const user = await getUser(ctx.from.id);
    
    // Check which step they're missing and redirect
    if (!user.gender) {
        await safeEditMessageText(ctx,
            "📝 *Setup Required*\n\n" +
            "⚠️ You must complete your profile before using the bot.\n\n" +
            "👤 *Step 1 of 3*\n" +
            "Select your gender:",
            { parse_mode: "Markdown", ...setupGenderKeyboard }
        );
    } else if (!user.age) {
        await safeEditMessageText(ctx,
            "📝 *Setup Required*\n\n" +
            "⚠️ You must complete your profile before using the bot.\n\n" +
            "👤 *Step 2 of 3*\n" +
            "🎂 *Select your age:*\n" +
            "(Choose the option closest to your age)",
            { parse_mode: "Markdown", ...setupAgeKeyboard }
        );
    } else if (!user.state) {
        await safeEditMessageText(ctx,
            "📝 *Setup Required*\n\n" +
            "⚠️ You must complete your profile before using the bot.\n\n" +
            "👤 *Step 3 of 3*\n" +
            "📍 *Select your location:*\n" +
            "(Choose your Indian state/territory)",
            { parse_mode: "Markdown", ...setupStateKeyboardFull }
        );
    } else {
        // Setup complete - show main menu
        await safeEditMessageText(ctx,
            "🌟 *Welcome back!* 🌟\n\n" +
            "This bot helps you chat anonymously with people worldwide.\n\n" +
            "Use the menu below to navigate:",
            { parse_mode: "Markdown", ...mainMenuKeyboard }
        );
    }
});

// ==============================
// SETTINGS ACTIONS
// ==============================

// Gender actions
bot.action("SET_GENDER", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    await safeEditMessageText(ctx, "Select your gender:", genderKeyboard);
});

bot.action("GENDER_MALE", async (ctx) => {
    if (!ctx.from) return;
    
    // Validate gender value
    const gender: UserGender = "male";
    if (!userGenderOptions.includes(gender)) {
        await safeAnswerCbQuery(ctx, "Invalid gender value");
        return;
    }
    
    await updateUser(ctx.from.id, { gender });
    await safeAnswerCbQuery(ctx, "Gender set to Male ✅");
    await showSettings(ctx);
});

bot.action("GENDER_FEMALE", async (ctx) => {
    if (!ctx.from) return;
    
    // Validate gender value
    const gender: UserGender = "female";
    if (!userGenderOptions.includes(gender)) {
        await safeAnswerCbQuery(ctx, "Invalid gender value");
        return;
    }
    
    await updateUser(ctx.from.id, { gender });
    await safeAnswerCbQuery(ctx, "Gender set to Female ✅");
    await showSettings(ctx);
});

// Age selection keyboard for settings
// Track users waiting for age input
export const waitingForAge: Set<number> = new Set();

const ageBackKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🔙 Back", "OPEN_SETTINGS")]
]);

// Age actions
bot.action("SET_AGE", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    
    // Add user to waiting list
    if (ctx.from) {
        waitingForAge.add(ctx.from.id);
    }
    
    await safeEditMessageText(
        ctx, 
        "🎂 *Enter Your Age*\n\n" +
        "Please enter your age as a number (e.g., 18, 25, 35)\n\n" +
        "📝 Age must be between 13 and 99\n" +
        "❌ Use /cancel to go back",
        { parse_mode: "Markdown", ...ageBackKeyboard }
    );
});

// State actions
bot.action("SET_STATE", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    await safeEditMessageText(ctx, "Select your state:", stateKeyboard);
});

bot.action("STATE_TELANGANA", async (ctx) => {
    if (!ctx.from) return;
    
    // Validate state value
    const state: UserState = "Telangana";
    if (!stateOptions.includes(state)) {
        await safeAnswerCbQuery(ctx, "Invalid state value");
        return;
    }
    
    await updateUser(ctx.from.id, { state });
    await safeAnswerCbQuery(ctx, "State set to Telangana ✅");
    await showSettings(ctx);
});

bot.action("STATE_AP", async (ctx) => {
    if (!ctx.from) return;
    
    // Validate state value
    const state: UserState = "Andhra Pradesh";
    if (!stateOptions.includes(state)) {
        await safeAnswerCbQuery(ctx, "Invalid state value");
        return;
    }
    
    await updateUser(ctx.from.id, { state });
    await safeAnswerCbQuery(ctx, "State set to Andhra Pradesh ✅");
    await showSettings(ctx);
});

for (const option of indianLocationOptions) {
    if (option.code === "AP") continue;

    bot.action(`STATE_${option.code}`, async (ctx) => {
        if (!ctx.from) return;

        const state: UserState = option.storedValue;
        if (!stateOptions.includes(state)) {
            await safeAnswerCbQuery(ctx, "Invalid state value");
            return;
        }

        await updateUser(ctx.from.id, { state });
        await safeAnswerCbQuery(ctx, `State set to ${option.storedValue} ✅`);
        await showSettings(ctx);
    });
}

// Preference action - check premium status and show appropriate message
bot.action("SET_PREFERENCE", async (ctx) => {
    if (!ctx.from) return;
    const user = await getUser(ctx.from.id);
    
    // Use isPremium to check both premium flag AND expiry
    if (!isPremium(user)) {
        // Show premium message for non-premium users
        await safeAnswerCbQuery(ctx);
        return ctx.reply(
            "💕 *Gender Preference - Premium Only*\n\n" +
            "This feature is available for Premium users only.\n\n" +
            "✨ *Premium Benefits:*\n" +
            "• Set gender preference (Male/Female)\n" +
            "• See partner's gender\n" +
            "• Better profile control\n" +
            "• And more!\n\n" +
            "📞 Contact admin @demonhunter1511 to purchase\n" +
            "🎁 Or use /settings → Referrals to earn free Premium!\n\n" +
            "💳 *Payment Issues?* Contact @demonhunter1511",
            { parse_mode: "Markdown" }
        );
    }
    
    await safeAnswerCbQuery(ctx);
    await safeEditMessageText(ctx, "Select your gender preference:", preferenceKeyboard);
});

// Premium check for preference selection
bot.action("PREF_MALE", async (ctx) => {
    if (!ctx.from) return;
    const user = await getUser(ctx.from.id);
    
    // Use isPremium to check both premium flag AND expiry
    if (!isPremium(user)) {
        await safeAnswerCbQuery(ctx);
        return ctx.reply(premiumPreferenceMessage, { parse_mode: "Markdown" });
    }
    
    // Validate preference value
    const preference: GenderPreference = "male";
    if (!genderOptions.includes(preference)) {
        await safeAnswerCbQuery(ctx, "Invalid preference value");
        return;
    }
    
    await safeAnswerCbQuery(ctx, "Preference saved: Male ✅");
    await updateUser(ctx.from.id, { preference });
    
    // Update preference in queue (memory) to reflect latest value
    updateUserPreferenceInQueue(bot, ctx.from.id, preference);
    console.log(`[queueMonitor] User ${ctx.from.id} updated preference to: ${preference}`);
    
    await showSettings(ctx);
});

bot.action("PREF_ANY", async (ctx) => {
    if (!ctx.from) return;
    const user = await getUser(ctx.from.id);
    
    // Use isPremium to check both premium flag AND expiry
    if (!isPremium(user)) {
        await safeAnswerCbQuery(ctx);
        return ctx.reply(premiumPreferenceMessage, { parse_mode: "Markdown" });
    }
    
    // Validate preference value
    const preference: GenderPreference = "any";
    if (!genderOptions.includes(preference)) {
        await safeAnswerCbQuery(ctx, "Invalid preference value");
        return;
    }
    
    await safeAnswerCbQuery(ctx, "Preference saved: Any ✅");
    await updateUser(ctx.from.id, { preference });
    
    // Update preference in queue (memory) to reflect latest value
    updateUserPreferenceInQueue(bot, ctx.from.id, preference);
    console.log(`[queueMonitor] User ${ctx.from.id} updated preference to: ${preference}`);
    
    await showSettings(ctx);
});

bot.action("PREF_FEMALE", async (ctx) => {
    if (!ctx.from) return;
    const user = await getUser(ctx.from.id);
    
    // Use isPremium to check both premium flag AND expiry
    if (!isPremium(user)) {
        await safeAnswerCbQuery(ctx);
        return ctx.reply(premiumPreferenceMessage, { parse_mode: "Markdown" });
    }
    
    // Validate preference value
    const preference: GenderPreference = "female";
    if (!genderOptions.includes(preference)) {
        await safeAnswerCbQuery(ctx, "Invalid preference value");
        return;
    }
    
    await safeAnswerCbQuery(ctx, "Preference saved: Female ✅");
    await updateUser(ctx.from.id, { preference });
    
    // Update preference in queue (memory) to reflect latest value
    updateUserPreferenceInQueue(bot, ctx.from.id, preference);
    console.log(`[queueMonitor] User ${ctx.from.id} updated preference to: ${preference}`);
    
    await showSettings(ctx);
});

// Buy premium action
bot.action("BUY_PREMIUM", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    await showPremiumPurchaseMenu(ctx);
});

// Open referral command
bot.action("OPEN_REFERRAL", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    await referralCommand.execute(ctx, bot);
});

// Block last chat partner (premium only)
bot.action("BLOCK_LAST_PARTNER", async (ctx) => {
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);

    const user = await getUser(ctx.from.id);
    // Use isPremium to check both premium flag AND expiry
    if (!isPremium(user)) {
        return ctx.reply(premiumBlockMessage, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([[Markup.button.callback("Open Settings", "OPEN_SETTINGS")]])
        });
    }

    const partnerId = user.reportingPartner || user.lastPartner;
    if (!partnerId) {
        return safeEditMessageText(
            ctx,
            "No recent partner found to block.",
            Markup.inlineKeyboard([[Markup.button.callback("Find Partner", "START_SEARCH")]])
        );
    }

    const result = await blockUserForUser(ctx.from.id, partnerId);
    const blockedUsers = await getBlockedUsers(ctx.from.id);

    const text =
        `${result.message}\n\n` +
        `Blocked users: ${blockedUsers.length}\n\n` +
        "You will not be matched with this user again.";

    return safeEditMessageText(
        ctx,
        text,
        Markup.inlineKeyboard([
            [Markup.button.callback("Blocked Users", "OPEN_BLOCKED_USERS")],
            [Markup.button.callback("Find New Partner", "START_SEARCH")],
            [Markup.button.callback("Main Menu", "BACK_MAIN_MENU")]
        ])
    );
});

// Open blocked users list from settings (premium only)
bot.action("OPEN_BLOCKED_USERS", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    await showBlockedUsersMenu(ctx);
});

// Unblock user action
bot.action(/UNBLOCK_USER_(\d+)/, async (ctx) => {
    if (!ctx.match || !ctx.from) return;
    await safeAnswerCbQuery(ctx);

    const user = await getUser(ctx.from.id);
    // Use isPremium to check both premium flag AND expiry
    if (!isPremium(user)) {
        return ctx.reply(premiumBlockMessage, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([[Markup.button.callback("Open Settings", "OPEN_SETTINGS")]])
        });
    }

    const targetUserId = Number(ctx.match[1]);
    if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
        return safeEditMessageText(
            ctx,
            "Invalid user selected.",
            Markup.inlineKeyboard([[Markup.button.callback("Back", "OPEN_BLOCKED_USERS")]])
        );
    }

    const removed = await unblockUserForUser(ctx.from.id, targetUserId);
    if (!removed) {
        await safeAnswerCbQuery(ctx, "User is not in your blocked list.");
    } else {
        await safeAnswerCbQuery(ctx, `User ${targetUserId} unblocked`);
    }

    await showBlockedUsersMenu(ctx);
});

// ==============================
// REPORT SYSTEM
// ==============================

const reportReasons = Markup.inlineKeyboard([
    [Markup.button.callback("🎭 Impersonating", "REPORT_IMPERSONATING")],
    [Markup.button.callback("🔞 Sexual content", "REPORT_SEXUAL")],
    [Markup.button.callback("💰 Fraud", "REPORT_FRAUD")],
    [Markup.button.callback("😠 Insulting", "REPORT_INSULTING")],
    [Markup.button.callback("🔙 Cancel", "REPORT_CANCEL")]
]);

const confirmKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("✅ Confirm Report", "REPORT_CONFIRM")],
    [Markup.button.callback("🔙 Cancel", "REPORT_CANCEL")]
]);

// Show report reasons
bot.action("OPEN_REPORT", async (ctx) => {
    // Check cooldown to prevent button spamming
    if (checkAndApplyCooldown(ctx, "OPEN_REPORT")) {
        await safeAnswerCbQuery(ctx);
        return;
    }
    await safeAnswerCbQuery(ctx);
    if (!ctx.from) return;
    
    const user = await getUser(ctx.from.id);
    const partnerId = user.reportingPartner || user.lastPartner;
    const message = "Select a reason to report:";

    if (!partnerId) {
        return safeEditMessageText(ctx, "No user to report. Start a chat first.", backKeyboard);
    }

    // Store the partner ID for reporting
    await updateUser(ctx.from.id, { reportingPartner: partnerId });

    return safeEditMessageText(ctx, message, reportReasons);
});

// Report reason handlers
const reportReasonsMap: Record<string, string> = {
    "REPORT_IMPERSONATING": "Impersonating",
    "REPORT_SEXUAL": "Sexual content",
    "REPORT_FRAUD": "Fraud",
    "REPORT_INSULTING": "Insulting"
};

function getAutoWarningMessage(reason: string): string {
    const warningMap: Record<string, string> = {
        "Impersonating": "Impersonation is not allowed on this platform.",
        "Sexual content": "Sharing inappropriate or sexual content is not allowed.",
        "Fraud": "Fraud or suspicious activity is a serious violation.",
        "Insulting": "Insulting or harassing other users is not allowed."
    };

    return warningMap[reason] || "You have been reported for violating community guidelines.";
}

for (const [action, reason] of Object.entries(reportReasonsMap)) {
    bot.action(action, async (ctx) => {
        await safeAnswerCbQuery(ctx);
        if (!ctx.from) return;
        
        const user = await getUser(ctx.from.id);
        const partnerId = user.reportingPartner;
        
        if (!partnerId) {
            return safeEditMessageText(ctx, "No user to report.", backKeyboard);
        }
        
        // Store the report reason temporarily
        await updateUser(ctx.from.id, { reportReason: reason });
        
        return safeEditMessageText(
            ctx,
            `Report reason: ${reason}\n\nAre you sure you want to report this user?`,
            confirmKeyboard
        );
    });
}

// Confirm report
bot.action("REPORT_CONFIRM", async (ctx) => {
    // Check cooldown to prevent report abuse
    if (checkAndApplyCooldown(ctx, "REPORT_CONFIRM")) {
        await safeAnswerCbQuery(ctx, "Please wait...");
        return;
    }
    await safeAnswerCbQuery(ctx);
    if (!ctx.from) return;
    
    const user = await getUser(ctx.from.id);
    const partnerId = user.reportingPartner;
    const reportReason = user.reportReason;
    
    if (!partnerId || !reportReason) {
        return safeEditMessageText(ctx, "Report cancelled.", backKeyboard);
    }
    
    // Check if user has already reported this partner
    if (user.reportedUsers?.includes(partnerId)) {
        return safeEditMessageText(ctx, "⚠️ You have already reported this user.", backKeyboard);
    }
    
    // Create report in the reports collection and return latest total.
    const newReportCount = await createReport(partnerId, ctx.from.id, reportReason);
    
    // Track that this user has reported this partner
    await updateUser(ctx.from.id, {
        reportedUsers: [...(user.reportedUsers || []), partnerId]
    });

    // Auto warn/temp-ban/ban based on configured thresholds
    if (isModerationEnabled()) {
        const warnThreshold = getAutoWarnThreshold();
        const tempBanThreshold = getAutoTempBanThreshold();
        const banThreshold = getAutoBanThreshold();
        const tempBanDurationMs = getTempBanDurationMs();
        
        // Defensive: ensure thresholds are in valid order to prevent conflicting auto-actions
        if (!(warnThreshold < tempBanThreshold && tempBanThreshold < banThreshold)) {
            console.error(
                `[AUTO_MODERATION] Invalid threshold configuration: warn=${warnThreshold}, tempBan=${tempBanThreshold}, ban=${banThreshold}. Skipping auto-actions.`
            );
        } else {
            const currentlyBanned = await isBanned(partnerId);

            if (newReportCount >= banThreshold && !currentlyBanned) {
                try {
                    await banUser(partnerId, `Auto-banned for reaching ${newReportCount} reports`);
                    await ctx.telegram.sendMessage(
                        partnerId,
                        `🚫 *Banned*\n\nYou have been banned due to accumulating ${newReportCount} reports.\n\nThis is an automatic action based on community reports.`,
                        { parse_mode: "Markdown" }
                    );
                    console.log(`[AUTO_MODERATION] User ${partnerId} auto-banned for reaching ${newReportCount} reports`);
                } catch (error) {
                    console.error(`[AUTO_MODERATION] Failed to ban user ${partnerId}:`, error);
                }
            } else if (newReportCount >= tempBanThreshold && !currentlyBanned) {
                try {
                    const hours = Math.round(tempBanDurationMs / (1000 * 60 * 60));
                    await tempBanUser(
                        partnerId,
                        tempBanDurationMs,
                        `Auto temp-banned for reaching ${newReportCount} reports`
                    );
                    await ctx.telegram.sendMessage(
                        partnerId,
                        `⏱️ *Temporary Ban*\n\nYou have been temporarily banned for ${hours} hours due to ${newReportCount} reports.\n\nThis is an automatic action based on community reports.`,
                        { parse_mode: "Markdown" }
                    );
                    console.log(`[AUTO_MODERATION] User ${partnerId} auto temp-banned for ${hours} hours at ${newReportCount} reports`);
                } catch (error) {
                    console.error(`[AUTO_MODERATION] Failed to temp-ban user ${partnerId}:`, error);
                }
            }

            // Auto warn when reaching warn threshold
            if (newReportCount === warnThreshold) {
                const warningText =
                    `⚠️ *Warning*\n\n` +
                    `You were reported for: *${reportReason}*\n\n` +
                    `${getAutoWarningMessage(reportReason)}\n\n` +
                    `You have received ${warnThreshold} reports. If this continues, you may be banned.\n\n` +
                    `Please chat safely and respect others.`;

                try {
                    await ctx.telegram.sendMessage(partnerId, warningText, { parse_mode: "Markdown" });
                } catch (error) {
                    console.error(`[AUTO_WARN] Failed to send warning to user ${partnerId}:`, error);
                }
            }
        }
    } else {
        // Fallback: auto warn at 2 reports when moderation is disabled (legacy behavior)
        if (newReportCount === 2) {
            const warningText =
                `⚠️ *Warning*\n\n` +
                `You were reported for: *${reportReason}*\n\n` +
                `${getAutoWarningMessage(reportReason)}\n\n` +
                `You have received 2 reports. If this continues, you may be banned.\n\n` +
                `Please chat safely and respect others.`;

            try {
                await ctx.telegram.sendMessage(partnerId, warningText, { parse_mode: "Markdown" });
            } catch (error) {
                console.error(`[AUTO_WARN] Failed to send warning to user ${partnerId}:`, error);
            }
        }
    }

    // Notify the reporter
    await safeEditMessageText(ctx, "Thank you for reporting! 🙏", backKeyboard);
    
    // Notify admins on every report
    const adminIds = ADMINS.map(id => parseInt(id));
    for (const adminId of adminIds) {
        try {
            await ctx.telegram.sendMessage(
                adminId,
                `🚨 *User Reported*\n\n` +
                `👤 Reported User: ${partnerId}\n` +
                `📊 Total Reports: ${newReportCount}\n` +
                `📝 Reason: ${reportReason}\n` +
                `🙋 Reported By: ${ctx.from.id}`,
                {
                    parse_mode: "Markdown",
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: "🚫 Ban User",
                                    callback_data: `ADMIN_QUICK_BAN_${partnerId}`
                                },
                                {
                                    text: "⚠️ Warn User",
                                    callback_data: `ADMIN_WARN_USER_${partnerId}`
                                }
                            ],
                            [
                                {
                                    text: "❌ Ignore",
                                    callback_data: "ADMIN_IGNORE_REPORT"
                                }
                            ]
                        ]
                    }
                }
            );
        } catch {
            // Admin might not exist, ignore
        }
    }
    
    // Clear report data
    await updateUser(ctx.from.id, { reportingPartner: null, reportReason: null });
});

// Cancel report
bot.action("REPORT_CANCEL", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    if (!ctx.from) return;
    
    // Clear report data
    await updateUser(ctx.from.id, { reportingPartner: null, reportReason: null });
    
    return safeEditMessageText(ctx, "Report cancelled.", backKeyboard);
});

// Quick ban from report notification
bot.action(/ADMIN_QUICK_BAN_(\d+)/, async (ctx) => {
    // Safety check for ctx.match
    if (!ctx.match) return;
    
    // Verify admin authorization
    if (!ctx.from || !isAdmin(ctx.from.id)) {
        await ctx.answerCbQuery("Unauthorized");
        return;
    }
    await ctx.answerCbQuery("User banned ✅");

    const userId = parseInt(ctx.match[1]);

    try {
        // Check if user is already banned
        const alreadyBanned = await isBanned(userId);
        if (alreadyBanned) {
            await ctx.editMessageText(
                `⚠️ *User Already Banned*\n\nUser ID: ${userId} is already banned.`,
                { parse_mode: "Markdown" }
            );
            return;
        }

        // Add to bans collection
        await banUser(userId);
        
        // Update user's banned field and ban reason
        await updateUser(userId, { 
            banned: true, 
            banReason: "Banned by admin via report notification" 
        });

        await ctx.editMessageText(
            `🚫 *User Banned Successfully*\n\nUser ID: ${userId} has been banned.`,
            { parse_mode: "Markdown" }
        );

        // Optionally notify banned user
        try {
            await ctx.telegram.sendMessage(
                userId,
                `🚫 *You Have Been Banned*\n\n` +
                `You were banned due to a report violation.`,
                { parse_mode: "Markdown" }
            );
        } catch {
            // User may have blocked bot
        }

    } catch (error) {
        console.error("[ERROR] Quick ban failed:", error);
        await ctx.answerCbQuery("Ban failed. Try again.");
    }
});

// Ignore report
bot.action("ADMIN_IGNORE_REPORT", async (ctx) => {
    // Verify admin authorization
    if (!ctx.from || !isAdmin(ctx.from.id)) {
        await ctx.answerCbQuery("Unauthorized");
        return;
    }
    await ctx.answerCbQuery("Ignored");
    await ctx.editMessageText("❌ Report ignored.");
});


// Show improved setup complete message with summary
async function showSetupComplete(ctx: ActionContext) {
    if (!ctx.from) return;
    const user = await getUser(ctx.from.id);
    const keyboard = mainMenuKeyboard;
    const text = getSetupCompleteText(user, GROUP_INVITE_LINK);

    // Use safeEditMessageText to prevent UI freeze
    await safeEditMessageText(ctx, text, { parse_mode: "Markdown", ...keyboard });
}

// Setup done - show main menu (same as setup complete)
bot.action("SETUP_DONE", async (ctx) => {
    await safeAnswerCbQuery(ctx);
    await showSetupComplete(ctx);
});

// ========================================
// GROUP VERIFICATION SYSTEM
// ========================================

// User clicks "I've Joined" button - verify group membership
bot.action("VERIFY_GROUP_JOIN", async (ctx) => {
    console.log("[GroupCheck] - VERIFY_GROUP_JOIN action triggered by user:", ctx.from?.id);
    if (!ctx.from) return;
    await safeAnswerCbQuery(ctx);
    
    const userId = ctx.from.id;
    console.log("[GroupCheck] - Checking membership for user:", userId);
    
    // Check if user is actually a member of the group
    const isMember = await isUserGroupMember(userId);
    console.log("[GroupCheck] - User", userId, "is member:", isMember);
    
    if (isMember) {
        // User joined - update database and show main menu
        await updateUser(userId, { hasJoinedGroup: true });
        await safeAnswerCbQuery(ctx, "✅ Welcome to the group! You can now start chatting!");
        await showSetupComplete(ctx);
    } else {
        // User hasn't joined - show error
        await safeAnswerCbQuery(ctx, "❌ You haven't joined the group yet! Please click the link to join.");
        // Re-show the group join message
        await showSetupComplete(ctx);
    }
});

// ========================================
// CHAT RATING SYSTEM
// ========================================

const ratingThankYouKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🔍 Find New Partner", "START_SEARCH")],
    [Markup.button.callback("⚙️ Settings", "OPEN_SETTINGS")]
]);

// Rate chat as Good
bot.action("RATE_GOOD", async (ctx) => {
    await safeAnswerCbQuery(ctx, "We're glad you had a good experience! 😊");
    if (!ctx.from) return;
    
    const user = await getUser(ctx.from.id);
    
    const text =
        `😊 *Thanks for your feedback!*\n\n` +
        `Great to hear you had a positive chat experience!\n\n` +
        `Your feedback helps us make the community better.`;
    
    await safeEditMessageText(ctx, text, { parse_mode: "Markdown", ...ratingThankYouKeyboard });
    
    const partnerId = user.lastPartner;
    if (partnerId) {
        await updateUser(partnerId, { chatRating: 5 });
    }
});

// Rate chat as Bad
bot.action("RATE_BAD", async (ctx) => {
    await safeAnswerCbQuery(ctx, "Thanks for your feedback. We'll use it to improve.");
    if (!ctx.from) return;
    
    const user = await getUser(ctx.from.id);
    
    const text =
        `📝 *Thanks for your feedback!*\n\n` +
        `Sorry to hear your chat experience wasn't great.\n\n` +
        `Your feedback helps us make the community better.`;
    
    await safeEditMessageText(ctx, text, { parse_mode: "Markdown", ...ratingThankYouKeyboard });
    
    const partnerId = user.lastPartner;
    if (partnerId) {
        await updateUser(partnerId, { chatRating: 1 });
    }
});

// Rate chat as Medium
bot.action("RATE_MEDIUM", async (ctx) => {
    await safeAnswerCbQuery(ctx, "Thanks for your feedback!");
    if (!ctx.from) return;
    
    const user = await getUser(ctx.from.id);
    
    const text =
        `📝 *Thanks for your feedback!*\n\n` +
        `We appreciate your honesty.\n\n` +
        `Your feedback helps us make the community better.`;
    
    await safeEditMessageText(ctx, text, { parse_mode: "Markdown", ...ratingThankYouKeyboard });
    
    const partnerId = user.lastPartner;
    if (partnerId) {
        await updateUser(partnerId, { chatRating: 3 });
    }
});

// ==============================
// NEW CHAT BUTTON HANDLERS
// ==============================

// End chat button - triggers /end command
bot.action("END_CHAT", async (ctx) => {
    // Check cooldown to prevent button spamming
    if (checkAndApplyCooldown(ctx, "END_CHAT")) {
        await safeAnswerCbQuery(ctx, "Please wait a moment...");
        return;
    }
    await safeAnswerCbQuery(ctx);
    // Trigger end command
    await endCommand.execute(ctx, bot);
});

// Back to main menu button
bot.action("BACK_MAIN_MENU", async (ctx) => {
    // Check cooldown to prevent button spamming
    if (checkAndApplyCooldown(ctx, "BACK_MAIN_MENU")) {
        await safeAnswerCbQuery(ctx);
        return;
    }
    await safeAnswerCbQuery(ctx);
    
    const mainMenuKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback("🔍 Find Partner", "START_SEARCH")],
        [Markup.button.callback("⚙️ Settings", "OPEN_SETTINGS")],
        [Markup.button.callback("🎁 Referrals", "OPEN_REFERRAL")],
        [Markup.button.callback("❓ Help", "START_HELP")]
    ]);
    
    await safeEditMessageText(
        ctx,
        "🌟 <b>Main Menu</b> 🌟\n\nThis bot helps you chat anonymously with people worldwide.\n\nUse the menu below to navigate:",
        { parse_mode: "HTML", ...mainMenuKeyboard }
    );
});

// Cancel search button
bot.action("CANCEL_SEARCH", async (ctx) => {
    // Check cooldown to prevent button spamming
    if (checkAndApplyCooldown(ctx, "CANCEL_SEARCH")) {
        await safeAnswerCbQuery(ctx, "Please wait...");
        return;
    }
    await safeAnswerCbQuery(ctx);
    
    const userId = ctx.from?.id;
    if (!userId) return;
    
    await bot.removeFromQueue(userId);
    
    const mainMenuKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback("🔍 Find Partner", "START_SEARCH")],
        [Markup.button.callback("⚙️ Settings", "OPEN_SETTINGS")],
        [Markup.button.callback("🎁 Referrals", "OPEN_REFERRAL")],
        [Markup.button.callback("❓ Help", "START_HELP")]
    ]);
    
    await safeEditMessageText(
        ctx,
        "🔍 <b>Search Cancelled</b>\n\nYou have been removed from the waiting queue.",
        { parse_mode: "HTML", ...mainMenuKeyboard }
    );
});

// Rate chat as Okay (RATE_OKAY)
bot.action("RATE_OKAY", async (ctx) => {
    await safeAnswerCbQuery(ctx, "Thanks for your feedback!");
    if (!ctx.from) return;
    
    const user = await getUser(ctx.from.id);
    
    const text =
        `📝 <b>Thanks for your feedback!</b>\n\n` +
        `We appreciate your input.\n\n` +
        `Your feedback helps us make the community better.`;
    
    const ratingThankYouKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback("🔍 Find New Partner", "START_SEARCH")],
        [Markup.button.callback("🚨 Report User", "OPEN_REPORT")],
        [Markup.button.callback("🔙 Main Menu", "BACK_MAIN_MENU")]
    ]);
    
    await safeEditMessageText(ctx, text, { parse_mode: "HTML", ...ratingThankYouKeyboard });
    
    const partnerId = user.lastPartner;
    if (partnerId) {
        await updateUser(partnerId, { chatRating: 3 });
    }
});
