import { Context, Telegraf, Markup } from "telegraf";
import { Command } from "../Utils/commandHandler";
import { getUser, updateUser, updateLastActive, getReferralStats } from "../storage/db";

interface ReferralTier {
    count: number;
    reward: string;
    premiumDays: number;
    badge?: string;
    description: string;
}

const REFERRAL_TIERS: ReferralTier[] = [
    { count: 3, reward: "Starter", premiumDays: 1, badge: "🌱", description: "Get 1 day Premium" },
    { count: 7, reward: "Growing", premiumDays: 3, badge: "🌿", description: "Get 3 days Premium" },
    { count: 15, reward: "Popular", premiumDays: 7, badge: "🔥", description: "Get 7 days Premium" },
    { count: 30, reward: "Influencer", premiumDays: 14, badge: "⭐", description: "Get 14 days Premium + VIP Badge" },
    { count: 50, reward: "Super Star", premiumDays: 30, badge: "👑", description: "Get 30 days Premium + Gold Badge" },
];

type CooldownBot = {
    isActionOnCooldown: (userId: number, action: string) => boolean;
    setActionCooldown: (userId: number, action: string) => void;
};

function getBotUsername(ctx: Context): string {
    const extendedCtx = ctx as Context & { me?: string };
    return extendedCtx.me || process.env.BOT_USERNAME || "anonymouschatbot";
}

function getErrorMessage(error: unknown): string {
    if (typeof error === "object" && error !== null) {
        const errorLike = error as { description?: string; message?: string };
        return errorLike.description || errorLike.message || "Unknown error";
    }
    return String(error);
}

export default {
    name: "referral",
    description: "View your referral stats and invite friends",
    execute: async (ctx: Context) => {
        if (!ctx.from) {
            await ctx.reply("⚠️ Could not identify your account. Please try again.");
            return;
        }
        const userId = ctx.from.id;
        
        // Update user activity
        await updateLastActive(userId);
        
        // Get user data
        const user = await getUser(userId);
        
        // Get or create referral code
        let referralCode = user.referralCode;
        if (!referralCode) {
            referralCode = `REF${userId}${Date.now().toString().slice(-6)}`;
            await updateUser(userId, { referralCode });
        }
        
        // Get detailed referral stats
        const referralStats = await getReferralStats(userId);
        const referralCount = referralStats.total;
        const activeReferrals = referralStats.active;
        const premiumDaysEarned = referralStats.premiumDaysEarned;
        
        // Get next tier to achieve
        const nextTier = getNextTier(referralCount);
        
        // Generate referral link
        const botUsername = getBotUsername(ctx);
        const referralLink = `https://t.me/${botUsername}?start=${referralCode}`;
        
        // Build progress message
        let text = `🎁 <b>Referral Rewards</b>\n\n`;
        
        // Show stats
        text += `📊 <b>Your Stats:</b>\n`;
        text += `   👥 Total Invited: ${referralCount}\n`;
        text += `   ✅ Active Friends: ${activeReferrals}\n`;
        text += `   🏆 Premium Earned: ${premiumDaysEarned} days\n\n`;
        
        // Show progress to next tier
        if (nextTier) {
            const progress = Math.min(100, Math.round((referralCount / nextTier.count) * 100));
            const remaining = nextTier.count - referralCount;
            text += `🎯 <b>Next Reward:</b> ${nextTier.badge} ${nextTier.reward}\n`;
            text += `${createProgressBar(progress)} ${remaining} more to go!\n\n`;
        } else {
            text += `🎉 <b>Max Level Reached!</b> 🎉\n\n`;
        }
        
        // Show tier progress
        text += `🏅 <b>Your Tiers:</b>\n`;
        for (const tier of REFERRAL_TIERS) {
            const achieved = referralCount >= tier.count;
            const status = achieved ? "✅" : "○";
            text += `${status} ${tier.badge} ${tier.reward} (${tier.count}): ${tier.description}\n`;
        }
        
        text += `\n🔗 <b>Your Referral Link:</b>\n`;
        text += `<code>${referralLink}</code>\n\n`;
        
        text += `📋 <b>How to earn rewards:</b>\n`;
        text += `1. Copy your link above\n`;
        text += `2. Share with friends on Telegram\n`;
        text += `3. Friends get bonus too!\n`;
        text += `4. Unlock all tiers for maximum rewards!\n\n`;
        
        text += `💡 <b>Tips:</b>\n`;
        text += `• Share in groups (but avoid spam!)\n`;
        text += `• Tell friends about the bot features\n`;
        text += `• Each active referral counts!\n`;
        
        // Create inline keyboard with share button
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent("🌟 Join me on Anonymous Chat! Chat with strangers anonymously. Use my link:")}`;
        
        const buttons = [
            [Markup.button.url("📤 Share on Telegram", shareUrl)],
            [Markup.button.callback("🔄 Refresh Stats", "REFRESH_REFERRAL")],
            [Markup.button.callback("🔙 Main Menu", "BACK_MAIN_MENU")]
        ];
        
        await ctx.reply(text, { 
            parse_mode: "HTML", 
            ...Markup.inlineKeyboard(buttons)
        });
    },
    initActions: (bot: Telegraf<Context>) => initReferralActions(bot)
} as Command & { initActions: (bot: Telegraf<Context>) => void };

// Helper function to create ASCII progress bar
function createProgressBar(percent: number): string {
    const filled = Math.round(percent / 10);
    const empty = 10 - filled;
    const bar = "▓".repeat(filled) + "░".repeat(empty);
    return `<code>${bar}</code> ${percent}%`;
}

// Get next tier to achieve
function getNextTier(count: number): ReferralTier | null {
    for (const tier of REFERRAL_TIERS) {
        if (count < tier.count) {
            return tier;
        }
    }
    return null;
}

// Export for action handlers
export function initReferralActions(bot: Telegraf<Context>) {
    // Safe answer callback query helper
    async function safeAnswerCbQuery(ctx: Context, text?: string) {
        try {
            if (ctx.callbackQuery?.id) {
                await ctx.answerCbQuery(text);
            }
        } catch {
            // Ignore errors
        }
    }
    
    // Check and apply action cooldown - returns true if action should be blocked
    function checkAndApplyCooldown(ctx: Context, action: string): boolean {
        const userId = ctx.from?.id;
        if (!userId) return false;
        
        const botInstance = (require("../index") as { bot: CooldownBot }).bot;
        if (botInstance.isActionOnCooldown(userId, action)) {
            return true;
        }
        botInstance.setActionCooldown(userId, action);
        return false;
    }
    
    // Safe editMessageText helper - handles errors and falls back to reply
    // This prevents UI freeze when message can't be edited
    async function safeEditMessageText(ctx: Context, text: string, extra?: Record<string, unknown>) {
        try {
            await ctx.editMessageText(text, extra);
        } catch (error: unknown) {
            // Check for "message not modified" - this is not an error
            if (getErrorMessage(error).includes("message is not modified")) {
                return;
            }
            // For all other errors, try to reply instead to prevent UI freeze
            console.log("[Referral safeEditMessageText] Falling back to reply:", getErrorMessage(error));
            try {
                await ctx.reply(text, extra);
                return; // Exit after successful fallback
            } catch (replyError: unknown) {
                console.error("[Referral safeEditMessageText] Failed to reply:", getErrorMessage(replyError));
            }
        }
    }
    
    // Refresh referral stats
    bot.action("REFRESH_REFERRAL", async (ctx) => {
        // Check cooldown to prevent button spamming
        if (checkAndApplyCooldown(ctx, "REFRESH_REFERRAL")) {
            await safeAnswerCbQuery(ctx, "Please wait a moment...");
            return;
        }
        await safeAnswerCbQuery(ctx);
        const userId = ctx.from?.id;
        if (!userId) {
            return;
        }
        
        const user = await getUser(userId);
        let referralCode = user.referralCode;
        if (!referralCode) {
            referralCode = `REF${userId}${Date.now().toString().slice(-6)}`;
            await updateUser(userId, { referralCode });
        }
        
        const referralStats = await getReferralStats(userId);
        const referralCount = referralStats.total;
        const activeReferrals = referralStats.active;
        const premiumDaysEarned = referralStats.premiumDaysEarned;
        
        const botUsername = getBotUsername(ctx);
        const referralLink = `https://t.me/${botUsername}?start=${referralCode}`;
        
        const nextTier = getNextTier(referralCount);
        let progressText = `🔄 <b>Updated Stats:</b>\n\n`;
        progressText += `📊 Total: ${referralCount} | Active: ${activeReferrals} | Premium: ${premiumDaysEarned} days\n\n`;
        
        if (nextTier) {
            const progress = Math.min(100, Math.round((referralCount / nextTier.count) * 100));
            const remaining = nextTier.count - referralCount;
            progressText += `🎯 Next: ${nextTier.badge} ${nextTier.reward} - ${remaining} more needed\n`;
            progressText += `${createProgressBar(progress)}\n\n`;
        }
        
        progressText += `🔗 ${referralLink}`;
        
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent("🌟 Join me on Anonymous Chat! Use my link:")}`;
        
        const buttons = [
            [Markup.button.url("📤 Share", shareUrl)],
            [Markup.button.callback("🔙 Back", "BACK_REFERRAL_MENU")]
        ];
        
        await safeEditMessageText(ctx, progressText, { 
            parse_mode: "HTML", 
            ...Markup.inlineKeyboard(buttons)
        });
    });
    
    // Back to referral menu
    bot.action("BACK_REFERRAL_MENU", async (ctx) => {
        // Check cooldown to prevent button spamming
        if (checkAndApplyCooldown(ctx, "BACK_REFERRAL_MENU")) {
            await safeAnswerCbQuery(ctx);
            return;
        }
        await safeAnswerCbQuery(ctx);
        
        const userId = ctx.from?.id;
        if (!userId) {
            return;
        }
        const user = await getUser(userId);
        let referralCode = user.referralCode;
        if (!referralCode) {
            referralCode = `REF${userId}${Date.now().toString().slice(-6)}`;
            await updateUser(userId, { referralCode });
        }
        
        const referralStats = await getReferralStats(userId);
        const referralCount = referralStats.total;
        const activeReferrals = referralStats.active;
        const premiumDaysEarned = referralStats.premiumDaysEarned;
        
        const nextTier = getNextTier(referralCount);
        
        const botUsername = getBotUsername(ctx);
        const referralLink = `https://t.me/${botUsername}?start=${referralCode}`;
        
        let text = `🎁 <b>Referral Rewards</b>\n\n`;
        text += `📊 <b>Your Stats:</b>\n`;
        text += `   👥 Total Invited: ${referralCount}\n`;
        text += `   ✅ Active Friends: ${activeReferrals}\n`;
        text += `   🏆 Premium Earned: ${premiumDaysEarned} days\n\n`;
        
        if (nextTier) {
            const progress = Math.min(100, Math.round((referralCount / nextTier.count) * 100));
            const remaining = nextTier.count - referralCount;
            text += `🎯 <b>Next Reward:</b> ${nextTier.badge} ${nextTier.reward}\n`;
            text += `${createProgressBar(progress)} ${remaining} more to go!\n\n`;
        } else {
            text += `🎉 <b>Max Level Reached!</b> 🎉\n\n`;
        }
        
        text += `🏅 <b>Tiers:</b>\n`;
        for (const tier of REFERRAL_TIERS) {
            const achieved = referralCount >= tier.count;
            const status = achieved ? "✅" : "○";
            text += `${status} ${tier.badge} ${tier.reward} (${tier.count})\n`;
        }
        
        text += `\n🔗 <code>${referralLink}</code>`;
        
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent("🌟 Join me on Anonymous Chat! Use my link:")}`;
        
        const buttons = [
            [Markup.button.url("📤 Share", shareUrl)],
            [Markup.button.callback("🔄 Refresh", "REFRESH_REFERRAL")],
            [Markup.button.callback("🔙 Main Menu", "BACK_MAIN_MENU")]
        ];
        
        await safeEditMessageText(ctx, text, { 
            parse_mode: "HTML", 
            ...Markup.inlineKeyboard(buttons)
        });
    });
    
    // NOTE:
    // "BACK_MAIN_MENU" and "OPEN_REFERRAL" are registered in actionHandler.ts.
    // Avoid duplicate handlers here to prevent duplicate responses/edits.
}

// Export constants
export { REFERRAL_TIERS };
