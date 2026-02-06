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
        const remaining = Math.max(0, REFERRAL_GOAL - referralCount);
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
        let buttons: any[][] = [];
        
        if (hasPremium && premiumFromReferral) {
            text = `🎁 <b>Referral Rewards</b> ✨\n\n` +
                `👥 Friends Invited: ${referralCount}/${REFERRAL_GOAL}\n` +
                `${progressBar}\n\n` +
                `🎉 You've already unlocked Premium!\n` +
                `Share your link to invite more friends!\n\n` +
                `🔗 Your Referral Link:\n` +
                `<code>${referralLink}</code>`;
            
            buttons = [
                [Markup.button.url("📤 Share", `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent("Join me on Anonymous Chat! 🌟")}`)],
                [Markup.button.callback("🔙 Main Menu", "BACK_MAIN_MENU")]
            ];
        }
        else if (referralCount >= REFERRAL_GOAL) {
            // Grant premium for first time
            await updateUser(userId, { 
                premium: true,
                premiumFromReferral: true,
                premiumExpiry: Date.now() + (PREMIUM_DAYS * 24 * 60 * 60 * 1000)
            });
            
            text = `🎉 <b>Congratulations!</b> 🎉\n\n` +
                `You've invited ${REFERRAL_GOAL} friends!\n\n` +
                `✨ Premium Unlocked! ✨\n` +
                `🎁 7 Days of Premium Features\n\n` +
                `👥 Total Invited: ${referralCount}\n\n` +
                `🔗 Your Referral Link:\n` +
                `<code>${referralLink}</code>`;
            
            buttons = [
                [Markup.button.url("📤 Share", `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent("Join me on Anonymous Chat! 🌟")}`)],
                [Markup.button.callback("🚀 Start Chatting", "START_SEARCH")]
            ];
        }
        else {
            const premiumStatus = remaining === 0 ? "🎁 Unlocking Soon!" : `${remaining} more to unlock`;
            text = `🎁 <b>Referral Rewards</b> 🎁\n\n` +
                `Invite friends to unlock <b>7 days FREE Premium!</b>\n\n` +
                `👥 Friends: ${referralCount}/${REFERRAL_GOAL}\n` +
                `${progressBar}\n` +
                `${premiumStatus}\n\n` +
                `🔗 Your Referral Link:\n` +
                `<code>${referralLink}</code>\n\n` +
                `📋 <b>How it works:</b>\n` +
                `1. Copy your link\n` +
                `2. Share with friends\n` +
                `3. Get rewarded at ${REFERRAL_GOAL} invites!`;
            
            buttons = [
                [Markup.button.url("📤 Share on Telegram", `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent("Join me on Anonymous Chat! 🌟")}`)],
                [Markup.button.callback("🔙 Main Menu", "BACK_MAIN_MENU")]
            ];
        }
        
        await ctx.reply(text, { 
            parse_mode: "HTML", 
            ...Markup.inlineKeyboard(buttons)
        });
    }
} as Command;

// Helper function to create ASCII progress bar
function createProgressBar(percent: number): string {
    const filled = Math.round(percent / 10);
    const empty = 10 - filled;
    const bar = "▓".repeat(filled) + "░".repeat(empty);
    return `<code>${bar}</code> ${percent}%`;
}

// Export action handlers
export function initReferralActions(bot: Telegraf<Context>) {
    // Back to main menu
    bot.action("BACK_MAIN_MENU", async (ctx) => {
        await ctx.answerCbQuery();
        const mainMenuKeyboard = Markup.inlineKeyboard([
            [Markup.button.callback("🔍 Search", "START_SEARCH")],
            [Markup.button.callback("⚙️ Settings", "OPEN_SETTINGS")],
            [Markup.button.callback("❓ Help", "START_HELP")]
        ]);
        
        await ctx.editMessageText(
            "🌟 <b>Welcome back!</b> 🌟\n\nThis bot helps you chat anonymously with people worldwide.\n\nUse the menu below to navigate:", 
            { parse_mode: "HTML", ...mainMenuKeyboard }
        );
    });
}

// Export constants
export { REFERRAL_GOAL, PREMIUM_DAYS };
