import { Context, Telegraf } from "telegraf";
import { Command } from "../Utils/commandHandler";
import { ExtraTelegraf } from "..";
import { getUser, updateUser, updateLastActive, processReferral } from "../storage/db";
import { Markup } from "telegraf";

// Setup step constants
export const SETUP_STEP_GENDER = "gender";
export const SETUP_STEP_AGE = "age";
export const SETUP_STEP_STATE = "state";
export const SETUP_STEP_DONE = "done";

export default {
    name: "start",
    description: "Start the bot",
    execute: async (ctx: Context, bot: Telegraf<Context>) => {
        const userId = ctx.from?.id as number;
        
        // Save user's username if available
        const username = ctx.from?.username || ctx.from?.first_name || "Unknown";
        
        // CRITICAL: Check for referral code FIRST, before any user creation
        // Use ctx.startPayload (Telegraf's built-in) or fallback to message text parsing
        const startPayload = (ctx as any).startPayload;
        const messageText = (ctx.update as any)?.message?.text;
        const startParam = startPayload || (messageText?.split(" ")[1] || null);
        
        console.log(`[START] - User ${userId} (${username}) starting`);
        console.log(`[START] - startPayload (ctx.startPayload): ${startPayload}`);
        console.log(`[START] - parsed startParam: ${startParam}`);
        
        // Get user FIRST - this determines if user is new
        // IMPORTANT: Don't call updateLastActive before this - it creates the user!
        const user = await getUser(userId);
        
        // Check if this is a NEW user (first time ever starting the bot)
        if (user.isNew) {
            // ===== NEW USER FLOW =====
            // Process referral FIRST (if code provided) before finalizing user
            if (startParam && startParam.startsWith("REF")) {
                // processReferral will:
                // 1. Find the referrer by referral code
                // 2. Check for self-referral
                // 3. Check if user was already referred
                // 4. Increment referrer's count
                // 5. Set referredBy on the new user
                const referralSuccess = await processReferral(userId, startParam);
                if (referralSuccess) {
                    console.log(`[START] - Referral processed successfully for user ${userId} with code: ${startParam}`);
                } else {
                    console.log(`[START] - Referral could not be processed for user ${userId} (invalid code or self-referral)`);
                }
            }
            
            // Now create the user with all required fields
            // referredBy is set by processReferral, not here
            const updateData: any = { 
                createdAt: Date.now(), 
                lastActive: Date.now(),
                name: username
            };
            
            await updateUser(userId, updateData);
            (bot as ExtraTelegraf).incrementUserCount();
            
            // New user - show welcome message with WebApp button
            const webAppUrl = process.env.WEBAPP_URL ? process.env.WEBAPP_URL + "/menu" : "https://your-domain.com/menu";
            await ctx.reply(
                "🌟 <b>Welcome to Anonymous Chat!</b> 🌟\n\n" +
                "✨ Connect with strangers anonymously\n" +
                "🔒 Your privacy is protected\n" +
                "💬 Chat freely and safely\n\n" +
                "Tap <b>Get Started</b> to begin!",
                { 
                    parse_mode: "HTML" as const,
                    reply_markup: Markup.inlineKeyboard([
                        Markup.button.webApp("📱 Open Menu", webAppUrl)
                    ]) as any
                }
            );
            return;
        }
        
        // ===== EXISTING USER FLOW =====
        // Update lastActive for returning users (user already exists)
        await updateLastActive(userId);

        // Check if user is in the middle of setup
        const setupStep = (user as any).setupStep;
        
        if (setupStep === SETUP_STEP_AGE) {
            // User needs to enter age
            await ctx.reply(
                "📝 <b>Step 2 of 3</b>\n\n" +
                "🎂 <b>Select your age range:</b>\n" +
                "(This helps us match you with people in similar age groups)",
                { parse_mode: "HTML" }
            );
            return;
        }
        
        if (setupStep === SETUP_STEP_STATE) {
            // User needs to select state
            await ctx.reply(
                "📝 <b>Step 3 of 3</b>\n\n" +
                "📍 <b>Select your location:</b>\n" +
                "(Helps match you with nearby people)",
                { parse_mode: "HTML" }
            );
            return;
        }
        
        // Existing user with complete profile - show main menu with WebApp button
        // Group join is now optional - show invite link but allow access
        const groupInviteLink = process.env.GROUP_INVITE_LINK || "https://t.me/teluguanomychat";
        const webAppUrl = process.env.WEBAPP_URL ? process.env.WEBAPP_URL + "/menu" : "https://your-domain.com/menu";
        await ctx.reply(
            "🌟 <b>Welcome back!</b> 🌟\n\n" +
            "This bot helps you chat anonymously with people worldwide.\n\n" +
            "📢 <b>Join our community group!</b>\n" +
            "Meet more people and stay updated!\n" +
            "👉 " + groupInviteLink + "\n\n" +
            "Use the commands below to navigate:",
            { 
                parse_mode: "HTML" as const,
                reply_markup: Markup.inlineKeyboard([
                    Markup.button.webApp("📱 Open Menu", webAppUrl)
                ]) as any
            }
        );
    }
} as Command;
