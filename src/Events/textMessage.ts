import { Context, NarrowedContext } from "telegraf";
import { Event } from "../Utils/eventHandler";
import { ExtraTelegraf } from "..";
import { Message, Update } from "telegraf/types";
import { updateUser, getUser, getAllUsers } from "../storage/db";
import { isBotBlockedError, cleanupBlockedUser, isNotEnoughRightsError, isRateLimitError, getRetryDelay, broadcastWithRateLimit } from "../Utils/telegramErrorHandler";
import { waitingForBroadcast } from "../Commands/adminaccess";
import { Markup } from "telegraf";

// Setup step constants (must match start.ts)
const SETUP_STEP_AGE = "age";
const SETUP_STEP_STATE = "state";

// Setup keyboards
const setupStateKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🟢 Telangana", "SETUP_STATE_TELANGANA")],
    [Markup.button.callback("🔵 Andhra Pradesh", "SETUP_STATE_AP")],
    [Markup.button.callback("🇮🇳 Other Indian State", "SETUP_STATE_OTHER")],
    [Markup.button.callback("🌍 Outside India", "SETUP_COUNTRY_OTHER")]
]);

const backKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🔙 Back", "OPEN_SETTINGS")]
]);

const cancelKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("⬅️ Cancel", "SETUP_CANCEL")]
]);

const mainMenuKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🔍 Search", "START_SEARCH")],
    [Markup.button.callback("⚙️ Settings", "OPEN_SETTINGS")],
    [Markup.button.callback("❓ Help", "START_HELP")]
]);

export default {
  type: "message",
  execute: async (
    ctx: NarrowedContext<Context<Update>, Update.MessageUpdate<Message>>,
    bot: ExtraTelegraf
  ) => {

    // SAFETY: ctx.from may be undefined
    if (!ctx.from) return;

    // Block polls
    if ("poll" in ctx.message) {
      return ctx.reply("🚫 Polls are not allowed in chat.");
    }

    const text = "text" in ctx.message ? ctx.message.text : undefined;

    // Skip commands (messages starting with /)
    if (text?.startsWith("/")) return;

    /* ================================
       ADMIN BROADCAST HANDLER
     ================================= */

    // Check if admin is waiting to broadcast
    if (waitingForBroadcast.has(ctx.from.id)) {
        console.log(`[BROADCAST] - Admin ${ctx.from.id} is broadcasting...`);
        
        // Remove from waiting list immediately
        waitingForBroadcast.delete(ctx.from.id);

        const broadcastText = text || "(No message content)";
        const users = await getAllUsers();

        if (users.length === 0) {
            return ctx.reply("📢 *Broadcast Result*\n\n❌ No users to broadcast to.");
        }

        // Send broadcast with rate limiting
        const userIds = users.map(id => Number(id)).filter(id => !isNaN(id));
        const { success, failed } = await broadcastWithRateLimit(bot, userIds, broadcastText);

        console.log(`[BROADCAST] - Completed: Sent ${success}, Failed ${failed}`);
        
        // Clear any inline keyboards by using removeKeyboard
        return ctx.reply(
            `📢 *Broadcast Result*\n\n✅ Sent: ${success}\n❌ Failed: ${failed}\n\nTotal Users: ${users.length}`,
            { parse_mode: "Markdown", ...Markup.removeKeyboard() }
        );
    }

      /* ================================
        CHAT FORWARDING CHECK
        Only process profile inputs if user is NOT in a chat
      ================================= */

    if (!bot.runningChats.includes(ctx.from.id)) {
      // Check if user is in waiting queue
      if (bot.waiting === ctx.from.id) {
        return ctx.reply(
          "⏳ Waiting for a partner...\n\nUse /end to stop searching."
        );
      }

      /* ================================
         PROFILE INPUT HANDLER (only for non-chat users)
      ================================= */

      if (text) {
        const txt = text.toLowerCase();

        // ✅ Gender
        if (txt === "male" || txt === "female") {
          await updateUser(ctx.from.id, { gender: txt });
          return ctx.reply("Gender updated ✅");
        }

        // ✅ Preference
        if (txt === "any") {
          await updateUser(ctx.from.id, { preference: txt });
          return ctx.reply("Preference updated ✅");
        }

        // ✅ Age (13-80) - Handle manual age input
        if (/^\d+$/.test(txt)) {
          const user = await getUser(ctx.from.id);
          const age = Number(txt);
          
          if (age < 13 || age > 80) {
            return ctx.reply("🎂 *Age must be between 13 and 80*\n\nPlease try again:", 
              { parse_mode: "Markdown", ...cancelKeyboard });
          }
          
          await updateUser(ctx.from.id, { age: String(age) });
          
          // After manual age input, ask for state with back button
          await ctx.reply(
            "📝 *Step 3 of 3*\n\n" +
            "📍 *Select your location:*\n" +
            "(Helps match you with nearby people)",
            { parse_mode: "Markdown", ...setupStateKeyboard }
          );
          return;
        }

        // ✅ State (for setup phase - when user types state name)
        if (txt === "telangana" || txt === "andhra pradesh" || txt === "karnataka" || 
            txt === "tamil nadu" || txt === "maharashtra" || txt === "other") {
          const user = await getUser(ctx.from.id);
          
          // Only process as setup if user is in setup phase
          if (user.setupStep === "state" || !user.state) {
            await updateUser(ctx.from.id, { state: txt });
            
            // Show setup complete message
            await ctx.reply(
              `✨ *Profile Complete!* ✨\n\n` +
              `Your profile has been set up successfully!\n\n` +
              `🎉 Ready to start chatting? Use /search to find a partner!`,
              { parse_mode: "Markdown", ...mainMenuKeyboard }
            );
            return;
          }
        }
      }

      return ctx.reply(
        "You are not in a chat...\n\nUse /next to find a new partner or /end to end searching."
      );
    }

    /* =================================
       CHAT FORWARDING
    ================================= */

    /* =================================
       MEDIA RESTRICTION (2 minutes)
    ================================= */
    
    // Check if message is media
    const isMedia = "photo" in ctx.message || 
                   "video" in ctx.message || 
                   "audio" in ctx.message || 
                   "document" in ctx.message || 
                   "voice" in ctx.message || 
                   "video_note" in ctx.message ||
                   "sticker" in ctx.message;
    
    if (isMedia) {
      const user = await getUser(ctx.from.id);
      const chatStartTime = user.chatStartTime;
      
      if (chatStartTime) {
        const elapsed = (Date.now() - chatStartTime) / 1000; // in seconds
        const twoMinutes = 2 * 60;
        
        if (elapsed < twoMinutes) {
          const remaining = Math.ceil(twoMinutes - elapsed);
          return ctx.reply(
            `⏱️ Media sharing is locked for the first 2 minutes.\n\nPlease wait ${remaining} seconds before sending photos, videos, or other media.`
          );
        }
      }
    }

    /* =================================
       LINK DETECTION & BLOCKING
    ================================= */

    const urlRegex = /(https?:\/\/)?(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi;
    if (text && urlRegex.test(text)) {
      return ctx.reply(
        "🚫 Links are not allowed in chat for your safety.\n\nPlease share information verbally instead."
      );
    }

    const partner = bot.getPartner(ctx.from.id);
    
    // Check if partner exists and is valid
    if (!partner) {
      console.log(`[CHAT] - User ${ctx.from.id} tried to send message but has no valid partner`);
      return; // Partner not found
    }

    try {
      let sent;

      if ("reply_to_message" in ctx.message) {
        const messageId = ctx.message.reply_to_message?.message_id;
        const messageMap = bot.messageMap.get(partner);

        if (messageMap && messageId) {
          const replyMessageId = messageMap[messageId];
          if (replyMessageId) {
            sent = await ctx.copyMessage(partner, {
              reply_parameters: { message_id: replyMessageId }
            });
          } else {
            sent = await ctx.copyMessage(partner);
          }
        } else {
          sent = await ctx.copyMessage(partner);
        }
      } else {
        sent = await ctx.copyMessage(partner);
      }

      if (sent) {
        let userMap = bot.messageMap.get(ctx.from.id) || {};
        userMap[sent.message_id] = ctx.message.message_id;
        bot.messageMap.set(ctx.from.id, userMap);

        let partnerMap = bot.messageMap.get(partner) || {};
        partnerMap[ctx.message.message_id] = sent.message_id;
        bot.messageMap.set(partner, partnerMap);

        // Increment message count for both users
        const currentCount = bot.messageCountMap.get(ctx.from.id) || 0;
        bot.messageCountMap.set(ctx.from.id, currentCount + 1);
        
        const partnerCount = bot.messageCountMap.get(partner) || 0;
        bot.messageCountMap.set(partner, partnerCount + 1);
      }

      /* =================================
         FORWARD TO SPECTATORS
      ================================= */

      // Check if any admin is spectating this chat
      const spectatorInfo = bot.getSpectatorChatForUser(ctx.from.id);
      if (spectatorInfo) {
        const { adminId, chat } = spectatorInfo;
        
        // Determine which user sent the message
        const senderId = ctx.from.id;
        const senderLabel = senderId === chat.user1 ? "User 1" : "User 2";
        
        // Forward the message to the admin
        try {
          await bot.telegram.sendMessage(
            adminId,
            `<b>👁️ Spectator Update</b>\n\n${senderLabel} (<code>${senderId}</code>) sent a message:`,
            { parse_mode: "HTML" }
          );
          
          // Forward the actual message
          await ctx.forwardMessage(adminId);
        } catch (error) {
          // Admin might have exited spectator mode, remove from spectating chats
          console.log(`[SPECTATOR] - Admin ${adminId} no longer available, removing spectator`);
          bot.spectatingChats.delete(adminId);
        }
      }
    } catch (error: any) {
      // Check if the partner blocked the bot
      if (isBotBlockedError(error)) {
        console.log(`[CHAT] - Partner ${partner} blocked the bot, ending chat`);
        
        // Clean up the chat state
        cleanupBlockedUser(bot, partner);
        
        // Also remove current user from running chats
        bot.runningChats = bot.runningChats.filter(u => u !== ctx.from.id);
        
        // Clean up message maps
        bot.messageMap.delete(ctx.from.id);
        bot.messageMap.delete(partner);
        
        // Report keyboard
        const reportKeyboard = Markup.inlineKeyboard([
            [Markup.button.callback("🚨 Report User", "OPEN_REPORT")]
        ]);
        
        return ctx.reply(
          "🚫 Partner left the chat\n\n/next - Find new partner\n\n━━━━━━━━━━━━━━━━━\nTo report this chat:",
          reportKeyboard
        );
      }
      
      // Check if partner restricted the bot (not enough rights)
      if (isNotEnoughRightsError(error)) {
        console.log(`[CHAT] - Partner ${partner} restricted bot, ending chat`);
        
        // Clean up the chat state
        cleanupBlockedUser(bot, partner);
        
        // Also remove current user from running chats
        bot.runningChats = bot.runningChats.filter(u => u !== ctx.from.id);
        
        // Clean up message maps
        bot.messageMap.delete(ctx.from.id);
        bot.messageMap.delete(partner);
        
        // Report keyboard
        const reportKeyboard = Markup.inlineKeyboard([
            [Markup.button.callback("🚨 Report User", "OPEN_REPORT")]
        ]);
        
        return ctx.reply(
          "🚫 Partner left the chat\n\n/next - Find new partner\n\n━━━━━━━━━━━━━━━━━\nTo report this chat:",
          reportKeyboard
        );
      }
      
      // Handle rate limit errors gracefully
      if (isRateLimitError(error)) {
        const delay = getRetryDelay(error);
        console.log(`[CHAT] - Rate limited, retrying after ${delay}s`);
        
        // Add delay before retry
        await new Promise(resolve => setTimeout(resolve, delay * 1000));
        
        // Retry the message send once
        try {
          await ctx.copyMessage(partner);
          return;
        } catch (retryError: any) {
          // If retry also fails, check if it's a block/not enough rights error
          if (isBotBlockedError(retryError) || isNotEnoughRightsError(retryError)) {
            cleanupBlockedUser(bot, partner);
            bot.runningChats = bot.runningChats.filter(u => u !== ctx.from.id);
            bot.messageMap.delete(ctx.from.id);
            bot.messageMap.delete(partner);
            
            const reportKeyboard = Markup.inlineKeyboard([
                [Markup.button.callback("🚨 Report User", "OPEN_REPORT")]
            ]);
            
            return ctx.reply(
              "🚫 Partner left the chat\n\n/next - Find new partner\n\n━━━━━━━━━━━━━━━━━\nTo report this chat:",
              reportKeyboard
            );
          }
          
          console.error(`[CHAT] - Retry failed:`, retryError?.message || retryError);
        }
      }
      
      // Log other errors but don't crash the chat
      console.error(`[CHAT ERROR] -`, error?.message || error);
    }
  }
} as Event;
