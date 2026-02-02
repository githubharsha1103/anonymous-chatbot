import { Context, NarrowedContext } from "telegraf";
import { Event } from "../Utils/eventHandler";
import { ExtraTelegraf } from "..";
import { Message, Update } from "telegraf/types";
import { updateUser, getUser, getAllUsers } from "../storage/db";
import { isBotBlockedError, cleanupBlockedUser, isNotEnoughRightsError, isRateLimitError, getRetryDelay, broadcastWithRateLimit } from "../Utils/telegramErrorHandler";
import { waitingForBroadcast } from "../Commands/adminaccess";
import { Markup } from "telegraf";

const backKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🔙 Back", "OPEN_SETTINGS")]
]);

const ageInputKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("⬅️ Cancel", "SETUP_CANCEL")]
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
        // Remove from waiting list
        waitingForBroadcast.delete(ctx.from.id);

        const broadcastText = text || "(No message content)";
        const users = getAllUsers();

        if (users.length === 0) {
            return ctx.reply("📢 *Broadcast Result*\n\n❌ No users to broadcast to.");
        }

        // Send broadcast with rate limiting
        const userIds = users.map(id => Number(id)).filter(id => !isNaN(id));
        const { success, failed } = await broadcastWithRateLimit(bot, userIds, broadcastText);

        return ctx.reply(
            `📢 *Broadcast Result*\n\n✅ Sent: ${success}\n❌ Failed: ${failed}\n\nTotal Users: ${users.length}`,
            { parse_mode: "Markdown" }
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
          updateUser(ctx.from.id, { gender: txt });
          return ctx.reply("Gender updated ✅");
        }

        // ✅ Preference
        if (txt === "any") {
          updateUser(ctx.from.id, { preference: txt });
          return ctx.reply("Preference updated ✅");
        }

        // ✅ Age (13-80)
        if (/^\d+$/.test(txt)) {
          const user = getUser(ctx.from.id);
          const age = Number(txt);
          
          if (age < 13 || age > 80) {
            return ctx.reply("Age must be between 13 and 80 ❌");
          }
          updateUser(ctx.from.id, { age });
          
          // After age is set, ask for state (no back button) - only for new users without state
          if (!user.state && !user.age) {
            const stateKeyboard = Markup.inlineKeyboard([
               [Markup.button.callback("Telangana", "SETUP_STATE_TELANGANA")],
               [Markup.button.callback("Andhra Pradesh", "SETUP_STATE_AP")]
            ]);
            
            await ctx.reply(
               "📝 *Step 3/3:* Select your state:",
               { parse_mode: "Markdown", ...stateKeyboard }
            );
          } else {
            await ctx.reply("Age updated ✅", backKeyboard);
          }
          return;
        }

        // ✅ State (Telangana / Andhra Pradesh)
        if (txt === "telangana" || txt === "andhra pradesh") {
          updateUser(ctx.from.id, { state: txt });
          return ctx.reply("State updated ✅");
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
      const user = getUser(ctx.from.id);
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
    
    // Check if partner exists and is not blocked
    if (!partner) {
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
            `👁️ *Spectator Update*\n\n${senderLabel} (\`${senderId}\`) sent a message:`,
            { parse_mode: "Markdown" }
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
