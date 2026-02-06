import { Context, Telegraf, Markup } from "telegraf";
import { Command } from "../Utils/commandHandler";
import { getUser, updateUser, updateLastActive, getReferralCount } from "../storage/db";

const REFERRAL_GOAL = 30;
const PREMIUM_DAYS = 7;

export default {
    name: "referral",
    description: "View your referral stats and invite friends",
    execute: async (ctx: Context, bot: Telegraf<Context>) => {
        const userId = ctx.from?.id as number;
        
        // Update user activity
        await updateLastActive(userId);
        
        // Get user data
        const user = await getUser(userId);
        
        // Get or create referral code for user
        let referralCode = (user as any).referralCode;
        if (!referralCode) {
            referralCode = `REF${userId}${Date.now().toString().slice(-6)}`;
            await updateUser(userId, { referralCode });
        }
        
        // Get referral count
        const referralCount = await getReferralCount(userId);
        const hasPremium = user.premium;
        
        // Check if premium was already granted from referral
        const premiumFromReferral = (user as any).premiumFromReferral || false;
        
        // Calculate progress percentage
        const progressPercent = Math.min(100, Math.round((referralCount / REFERRAL_GOAL) * 100));
        
        // Generate referral link
        const botUsername = (ctx as any).me || process.env.BOT_USERNAME || "anonymouschatbot";
        const referralLink = `https://t.me/${botUsername}?start=${referralCode}`;
        
        // Create progress bar
        const progressBar = createProgressBar(progressPercent);
        
        // Build text based on status
        let text = "";
        let buttonText = "";
        let buttonAction = "";
        
        if (hasPremium && premiumFromReferral) {
            text = `🎁 *Referral Rewards* ✨\n\n` +
                `👥 Friends Invited: *${referralCount}*/${REFERRAL_GOAL}\n` +
                `${progressBar}\n\n` +
                `🎉 Premium Unlocked!\n` +
                `🔗 ${referralLink}`;
            
            buttonText = "📋 Copy Link";
            buttonAction = "COPY_REFERRAL_LINK";
        } else if (referralCount >= REFERRAL_GOAL) {
            // Grant premium for first time
            await updateUser(userId, { 
                premium: true,
                premiumFromReferral: true,
                premiumExpiry: Date.now() + (PREMIUM_DAYS * 24 * 60 * 60 * 1000)
            });
            
            text = `🎉 *Congratulations!* 🎉\n\n` +
                `👥 Friends Invited: *${referralCount}*/${REFERRAL_GOAL}\n` +
                `${progressBar}\n\n` +
                `✨ Premium Unlocked! (7 Days)\n` +
                `🔗 ${referralLink}`;
            
            buttonText = "📋 Copy Link";
            buttonAction = "COPY_REFERRAL_LINK";
        } else {
            const remaining = REFERRAL_GOAL - referralCount;
            text = `🎁 *Referral Rewards* 🎁\n\n` +
                `👥 Friends Invited: *${referralCount}*/${REFERRAL_GOAL}\n` +
                `${progressBar}\n` +
                `${remaining} more to unlock Premium!\n\n` +
                `🔗 ${referralLink}`;
            
            buttonText = "📋 Copy Link";
            buttonAction = "COPY_REFERRAL_LINK";
        }
        
        await ctx.reply(
            text,
            { 
                parse_mode: "Markdown", 
                ...Markup.inlineKeyboard([
                    [Markup.button.callback(buttonText, buttonAction)]
                ])
            }
        );
    }
} as Command;

// Helper function to create ASCII progress bar
function createProgressBar(percent: number): string {
    const filled = Math.round(percent / 10);
    const empty = 10 - filled;
    const bar = "▓".repeat(filled) + "░".repeat(empty);
    return `\`${bar}\` ${percent}%`;
}

// Export action handlers
export function initReferralActions(bot: Telegraf<Context>) {
    // Copy referral link
    bot.action("COPY_REFERRAL_LINK", async (ctx) => {
        if (!ctx.from) return;
        
        const userId = ctx.from.id;
        const user = await getUser(userId);
        let referralCode = (user as any).referralCode;
        
        if (!referralCode) {
            referralCode = `REF${userId}${Date.now().toString().slice(-6)}`;
            await updateUser(userId, { referralCode });
        }
        
        const botUsername = process.env.BOT_USERNAME || "anonymouschatbot";
        const referralLink = `https://t.me/${botUsername}?start=${referralCode}`;
        
        await ctx.answerCbQuery();
        
        // Send link in a way that's easy to copy
        await ctx.reply(
            `📋 *Your Referral Link*\n\n` +
            `Long press and select "Copy":\n\n` +
            `\`${referralLink}\``,
            { parse_mode: "Markdown" }
        );
    });
}

// Export constants
export { REFERRAL_GOAL, PREMIUM_DAYS };
