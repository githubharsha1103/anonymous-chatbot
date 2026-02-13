import { Context, Telegraf, Markup } from "telegraf";
import { Command } from "../Utils/commandHandler";
import { ExtraTelegraf } from "..";
import { getUser, updateUser, updateLastActive, processReferral } from "../storage/db";

// Setup step constants
export const SETUP_STEP_GENDER = "gender";
export const SETUP_STEP_AGE = "age";
export const SETUP_STEP_STATE = "state";
export const SETUP_STEP_DONE = "done";

// Welcome keyboard with Get Started button
const welcomeKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🌟 Get Started", "SETUP_GENDER_MALE")]
]);

// Gender selection - NO BACK/CANCEL option (must complete setup)
const genderKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("👨 Male", "SETUP_GENDER_MALE")],
    [Markup.button.callback("👩 Female", "SETUP_GENDER_FEMALE")]
]);

// Age selection - NO BACK/CANCEL option (must complete setup)
const ageKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("13-17", "SETUP_AGE_13_17")],
    [Markup.button.callback("18-25", "SETUP_AGE_18_25")],
    [Markup.button.callback("26-40", "SETUP_AGE_26_40")],
    [Markup.button.callback("40+", "SETUP_AGE_40_PLUS")],
    [Markup.button.callback("📝 Type Age", "SETUP_AGE_MANUAL")]
]);

// State selection - NO BACK/CANCEL option (must complete setup)
const stateKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🟢 Telangana", "SETUP_STATE_TELANGANA")],
    [Markup.button.callback("🔵 Andhra Pradesh", "SETUP_STATE_AP")],
    [Markup.button.callback("🇮🇳 Other Indian State", "SETUP_STATE_OTHER")],
    [Markup.button.callback("🌍 Outside India", "SETUP_COUNTRY_OTHER")]
]);

// Age manual input keyboard
const ageManualKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("⬅️ Back", "SETUP_BACK_AGE")]
]);

// Main menu keyboard
const mainMenuKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🔍 Search", "START_SEARCH")],
    [Markup.button.callback("⚙️ Settings", "OPEN_SETTINGS")],
    [Markup.button.callback("❓ Help", "START_HELP")]
]);

// Group join keyboard
const GROUP_INVITE_LINK = process.env.GROUP_INVITE_LINK || "https://t.me/teluguanomychat";
const groupJoinKeyboard = Markup.inlineKeyboard([
    [Markup.button.url("📢 Join Our Group", GROUP_INVITE_LINK)],
    [Markup.button.callback("✅ I've Joined", "VERIFY_GROUP_JOIN")]
]);

export default {
    name: "start",
    description: "Start the bot",
    execute: async (ctx: Context, bot: Telegraf<Context>) => {
        const userId = ctx.from?.id as number;
        
        // Save user's username if available
        const username = ctx.from?.username || ctx.from?.first_name || "Unknown";
        
        // Update user activity
        await updateLastActive(userId);
        
        // Check if user is new and increment user count
        const user = await getUser(userId);
        
        // Check for referral code in start parameter
        const startParam = (ctx as any).startPayload || (ctx.update as any)?.message?.text?.split(" ")[1];
        
        console.log(`[START] - User ${userId} (${username}) starting`);
        console.log(`[START] - startPayload: ${(ctx as any).startPayload}`);
        console.log(`[START] - message text: ${(ctx.update as any)?.message?.text}`);
        console.log(`[START] - parsed startParam: ${startParam}`);
        
        // Initialize new user
        if (user.isNew) {
            // Build update data
            const updateData: any = { 
                createdAt: Date.now(), 
                lastActive: Date.now(),
                name: username
            };
            
            // Set referredBy if referral code provided
            if (startParam && startParam.startsWith("REF")) {
                updateData.referredBy = startParam;
            }
            
            await updateUser(userId, updateData);
            (bot as ExtraTelegraf).incrementUserCount();
            
            // Process referral after user is created
            if (startParam && startParam.startsWith("REF")) {
                await processReferral(userId, startParam);
                console.log(`[START] - User ${userId} started with referral code: ${startParam}`);
            }
            
            // New user - show welcome with Get Started button
            await ctx.reply(
                "🌟 <b>Welcome to Anonymous Chat!</b> 🌟\n\n" +
                "✨ Connect with strangers anonymously\n" +
                "🔒 Your privacy is protected\n" +
                "💬 Chat freely and safely\n\n" +
                "Tap <b>Get Started</b> to begin!",
                { parse_mode: "HTML", ...welcomeKeyboard }
            );
            return;
        }
        
        // Update lastActive for returning users
        await updateLastActive(userId);

        // Check if user is in the middle of setup
        const setupStep = (user as any).setupStep;
        
        if (setupStep === SETUP_STEP_AGE) {
            // User needs to enter age - show age range buttons (NO BACK - must complete setup)
            await ctx.reply(
                "📝 <b>Step 2 of 3</b>\n\n" +
                "🎂 <b>Select your age range:</b>\n" +
                "(This helps us match you with people in similar age groups)",
                { parse_mode: "HTML", ...ageKeyboard }
            );
            return;
        }
        
        if (setupStep === SETUP_STEP_STATE) {
            // User needs to select state (NO BACK - must complete setup)
            await ctx.reply(
                "📝 <b>Step 3 of 3</b>\n\n" +
                "📍 <b>Select your location:</b>\n" +
                "(Helps match you with nearby people)",
                { parse_mode: "HTML", ...stateKeyboard }
            );
            return;
        }
        
        // Check if user has joined the required group
        if (user.hasJoinedGroup !== true) {
            await ctx.reply(
                "📢 <b>Group Membership Required</b>\n\n" +
                "🔒 You must join our group to use the bot.\n\n" +
                "📢 Click the button below to join:",
                { parse_mode: "HTML", ...groupJoinKeyboard }
            );
            return;
        }
        
        // Existing user with complete profile - show main menu
        await ctx.reply(
            "🌟 <b>Welcome back!</b> 🌟\n\n" +
            "This bot helps you chat anonymously with people worldwide.\n\n" +
            "Use the menu below to navigate:",
            { parse_mode: "HTML", ...mainMenuKeyboard }
        );
    }
} as Command;

// Export keyboards for action handlers
export { mainMenuKeyboard, genderKeyboard, ageKeyboard, stateKeyboard, ageManualKeyboard };
