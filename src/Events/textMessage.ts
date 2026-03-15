import { Context, NarrowedContext } from "telegraf";
import { Event } from "../Utils/eventHandler";
import { ExtraTelegraf } from "..";
import { Message, Update, ChatAction } from "telegraf/types";
import { updateUser, getUser, getAllUsers, updateLastActive } from "../storage/db";
import { isBotBlockedError, cleanupBlockedUser, isNotEnoughRightsError, isRateLimitError, getRetryDelay, broadcastWithRateLimit } from "../Utils/telegramErrorHandler";
import { waitingForBroadcast, waitingForUserId } from "../Commands/adminaccess";
import { showUserDetails } from "../Commands/adminaccess";
import { waitingForAge } from "../Utils/actionHandler";
import { getSetupCompleteText, getSetupStepPrompt } from "../Utils/setupFlow";
import { buildPartnerLeftMessage, exitChatKeyboard } from "../Utils/chatFlow";
import { handleSuccessfulPaymentMessage } from "../Utils/starsPayments";

// Pre-compiled regex for URL detection (performance optimization)
const urlRegex = /(https?:\/\/)?(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_.+~#?&//=]*)/i;

export default {
  type: "message",
  execute: async (
    ctx: NarrowedContext<Context<Update>, Update.MessageUpdate<Message>>,
    bot: ExtraTelegraf
  ) => {

    // SAFETY: ctx.from may be undefined
    if (!ctx.from) return;

    // Update user's last active time
    await updateLastActive(ctx.from.id).catch(err => 
        console.error("[textMessage] - Error updating lastActive:", err)
    );

    // Handle Telegram Stars successful payment updates before regular message flow.
    const paymentHandled = await handleSuccessfulPaymentMessage(ctx);
    if (paymentHandled) {
      return;
    }

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
        
        // Note: We no longer delete users who failed to receive broadcast
        // Users remain in the system even if they blocked the bot or are deactivated
        
        return ctx.reply(
            `📢 *Broadcast Result*\n\n✅ Sent: ${success}\n❌ Failed: ${failed}\n\nTotal Users: ${users.length}`,
            { parse_mode: "Markdown" }
        );
    }

    /* ================================
       ADMIN SEARCH USER BY ID HANDLER (WITH VALIDATION)
     ================================= */

    // Check if admin is waiting to search by user ID
    if (waitingForUserId.has(ctx.from.id)) {
        console.log(`[SEARCH_BY_ID] - Admin ${ctx.from.id} is searching for user...`);
        
        const userIdText = text?.trim();
        
        // Validate input - must be only digits
        if (!userIdText) {
            return ctx.reply(
                "❌ Invalid User ID. Please enter a numeric ID.",
                { parse_mode: "Markdown" }
            );
        }
        
        // Validate using regex - only numbers allowed
        const userIdRegex = /^\d+$/;
        if (!userIdRegex.test(userIdText)) {
            return ctx.reply(
                "❌ Invalid User ID. Please enter a numeric ID.",
                { parse_mode: "Markdown" }
            );
        }
        
        // Check for max length (15 digits for Telegram IDs)
        if (userIdText.length > 15) {
            return ctx.reply(
                "❌ Invalid User ID. Please enter a numeric ID.",
                { parse_mode: "Markdown" }
            );
        }
        
        // Safely parse the user ID
        const userId = parseInt(userIdText, 10);
        if (isNaN(userId) || userId <= 0) {
            return ctx.reply(
                "❌ Invalid User ID. Please enter a numeric ID.",
                { parse_mode: "Markdown" }
            );
        }
        
        // Get user data to check if exists
        const user = await getUser(userId);
        
        // Remove from waiting list AFTER successful validation
        waitingForUserId.delete(ctx.from.id);
        
        if (!user || user.isNew) {
            return ctx.reply(
                "User not found.",
                { parse_mode: "Markdown" }
            );
        }
        
        // User exists - show full details with action buttons
        return showUserDetails(ctx, userId);
    }

    /* ==============================
       AGE INPUT HANDLER
     ============================== */

    // Check if user is waiting to enter age
    if (waitingForAge.has(ctx.from.id)) {
        const ageText = text?.trim();
        
        // Remove from waiting list
        waitingForAge.delete(ctx.from.id);
        
        // Validate input
        if (!ageText) {
            return ctx.reply(
                "❌ Please enter a valid age.",
                { parse_mode: "Markdown" }
            );
        }
        
        // Parse age as number
        const age = parseInt(ageText, 10);
        
        // Validate age is a number
        if (isNaN(age)) {
            return ctx.reply(
                "❌ Invalid age. Please enter a number (e.g., 18, 25, 35).",
                { parse_mode: "Markdown" }
            );
        }
        
        // Validate age range (13-99)
        if (age < 13 || age > 99) {
            return ctx.reply(
                "❌ Age must be between 13 and 99 years.",
                { parse_mode: "Markdown" }
            );
        }
        
        // Update user's age
        await updateUser(ctx.from.id, { age: age.toString() });
        
        return ctx.reply(
            `🎂 Age set to ${age} years! ✅`,
            { parse_mode: "Markdown" }
        );
    }

      /* ================================
        CHAT FORWARDING CHECK
        Only process profile inputs if user is NOT in a chat
      ================================= */

    if (!bot.runningChats.has(ctx.from.id)) {
      // Check if user is in waiting queue
      if (bot.queueSet.has(ctx.from.id)) {
        return ctx.reply(
          "⏳ Waiting for a partner...\n\nUse /end to cancel."
        );
      }

      /* ================================
         PROFILE INPUT HANDLER (only for non-chat users)
      ================================= */

      if (text) {
        const txt = text.toLowerCase();
        const userForInput = await getUser(ctx.from.id);

        // Only accept free-form profile updates when the user is actively in a setup/edit step.
        if (userForInput.setupStep === "age" || userForInput.setupStep === "age_manual") {
          if (/^\d+$/.test(txt)) {
            const age = Number(txt);

            if (age < 13 || age > 80) {
              return ctx.reply("🎂 *Age must be between 13 and 80*\n\nPlease try again:",
                { parse_mode: "Markdown" });
            }

            await updateUser(ctx.from.id, { age: String(age), setupStep: "state" });

            const statePrompt = getSetupStepPrompt("state");
            if (statePrompt) {
              await ctx.reply(statePrompt.text, { parse_mode: "Markdown", ...(statePrompt.keyboard || {}) });
            }
            return;
          }
        }

        if (userForInput.setupStep === "state" || userForInput.setupStep === "state_other" || !userForInput.state) {
          const validStates = ["telangana", "andhra pradesh", "karnataka", "tamil nadu", "maharashtra", "other"];
          if (validStates.includes(txt)) {
            const formattedState = txt.split(" ").map(word =>
                word.charAt(0).toUpperCase() + word.slice(1)
            ).join(" ");

            await updateUser(ctx.from.id, { state: formattedState, setupStep: "done" });

            await ctx.reply(
              getSetupCompleteText(
                { gender: userForInput.gender, age: userForInput.age, state: formattedState },
                process.env.GROUP_INVITE_LINK || "https://t.me/teluguanomychat"
              ),
              { parse_mode: "Markdown" }
            );
            return;
          }
        }
      }

      return ctx.reply(
        "You are not in a chat...\n\nUse /next to find a new partner or /end to end searching."
      );
    }

    // Fallback: Check if user has an active chat in database (in case of bot restart)
    const userFromDb = await getUser(ctx.from.id);
    if (userFromDb.lastPartner && userFromDb.chatStartTime) {
      // User has a lastPartner in DB - try to verify if partner is still active
      const partnerId = userFromDb.lastPartner;
      const partnerFromDb = await getUser(partnerId);
      
      // If partner also has this user as lastPartner and has recent chatStartTime, restore the chat
      if (partnerFromDb.lastPartner === ctx.from.id && partnerFromDb.chatStartTime) {
        // Only restore if not already in memory (prevent duplicate logs)
        if (!bot.runningChats.has(ctx.from.id)) {
          // Restore runtime chat state
          bot.runningChats.set(ctx.from.id, partnerId);
          bot.runningChats.set(partnerId, ctx.from.id);
          
          // Initialize message tracking for both users if not already present
          if (!bot.messageMap.has(ctx.from.id)) {
            bot.messageMap.set(ctx.from.id, {});
          }
          if (!bot.messageMap.has(partnerId)) {
            bot.messageMap.set(partnerId, {});
          }
          if (!bot.messageCountMap.has(ctx.from.id)) {
            bot.messageCountMap.set(ctx.from.id, 0);
          }
          if (!bot.messageCountMap.has(partnerId)) {
            bot.messageCountMap.set(partnerId, 0);
          }
          
          console.log(`[textMessage] Restored chat session for user ${ctx.from.id} with partner ${partnerId}`);
        }
        // Continue to message forwarding - do NOT block!
      }
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

    // Use pre-compiled regex for URL detection
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

    // Helper function to get chat action based on message type
    const getChatAction = (): ChatAction => {
      if ("photo" in ctx.message) return "upload_photo" as ChatAction;
      if ("video" in ctx.message) return "upload_video" as ChatAction;
      if ("audio" in ctx.message) return "upload_audio" as ChatAction;
      if ("voice" in ctx.message) return "upload_voice" as ChatAction;
      if ("document" in ctx.message) return "upload_document" as ChatAction;
      if ("sticker" in ctx.message) return "choose_sticker" as ChatAction;
      if ("video_note" in ctx.message) return "upload_video_note" as ChatAction;
      return "typing" as ChatAction; // Default for text messages
    };

    // Send typing indicator to partner before forwarding
    const sendTypingIndicator = async () => {
      try {
        await ctx.telegram.sendChatAction(partner, getChatAction());
        // Add delay to simulate natural typing
        await new Promise(resolve => setTimeout(resolve, 1500));
      } catch {
        // Partner might have left, ignore typing indicator errors
        console.log(`[CHAT] - Could not send typing indicator to ${partner}`);
      }
    };
    
    // Timeout wrapper for Telegram API calls (15 seconds max)
    const withTimeout = async <T>(promise: Promise<T>, ms: number = 15000): Promise<T> => {
      const timeout = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error("Telegram API timeout")), ms)
      );
      return Promise.race([promise, timeout]) as Promise<T>;
    };

    try {
      let sent;

      if ("reply_to_message" in ctx.message) {
        const messageId = ctx.message.reply_to_message?.message_id;
        const messageMap = bot.messageMap.get(partner);

        // Send typing indicator before forwarding
        await sendTypingIndicator();
        
        try {
          if (messageMap && messageId) {
            const replyMessageId = messageMap[messageId];
            if (replyMessageId) {
              sent = await withTimeout(ctx.copyMessage(partner, {
                reply_parameters: { message_id: replyMessageId }
              }));
            } else {
              sent = await withTimeout(ctx.copyMessage(partner));
            }
          } else {
            sent = await withTimeout(ctx.copyMessage(partner));
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error("[CHAT] - Message forwarding failed:", errorMessage);
          return; // Exit gracefully on timeout
        }
      } else {
        // Send typing indicator before forwarding regular message
        await sendTypingIndicator();
        
        try {
          sent = await withTimeout(ctx.copyMessage(partner));
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error("[CHAT] - Message forwarding failed:", errorMessage);
          return; // Exit gracefully on timeout
        }
      }

      if (sent) {
        const userMap = bot.messageMap.get(ctx.from.id) || {};
        userMap[sent.message_id] = ctx.message.message_id;
        bot.messageMap.set(ctx.from.id, userMap);

        const partnerMap = bot.messageMap.get(partner) || {};
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

      // Check if any admin is spectating this chat (supports multiple spectators)
      const spectators = bot.getSpectatorsForUser(ctx.from.id);
      if (spectators.length > 0) {
        // Determine which user sent the message
        const senderId = ctx.from.id;
        
        for (const { adminId, chat } of spectators) {
          const senderLabel = senderId === chat.user1 ? "User 1" : "User 2";
          
          // Forward the message to each admin spectator
          try {
            // Timeout wrapper for spectator messages
            const withTimeout = async <T>(promise: Promise<T>, ms: number = 10000): Promise<T> => {
              const timeout = new Promise<never>((_, reject) => 
                setTimeout(() => reject(new Error("Telegram API timeout")), ms)
              );
              return Promise.race([promise, timeout]) as Promise<T>;
            };
            
            await withTimeout(bot.telegram.sendMessage(
              adminId,
              `<b>👁️ Spectator Update</b>\n\n${senderLabel} (<code>${senderId}</code>) sent a message:`,
              { parse_mode: "HTML" }
            ));
            
            // Forward the actual message
            await withTimeout(ctx.forwardMessage(adminId));
          } catch {
            // Admin might have exited spectator mode, remove from spectating chats
            console.log(`[SPECTATOR] - Admin ${adminId} no longer available, removing spectator`);
            bot.removeSpectator(adminId);
          }
        }
      }
    } catch (error: unknown) {
      // Check if the partner blocked the bot
      if (isBotBlockedError(error)) {
        console.log(`[CHAT] - Partner ${partner} blocked the bot, ending chat`);
        
        // Clean up the chat state (cleanupBlockedUser handles runningChats deletion)
        cleanupBlockedUser(bot, partner);
        
        // Clean up message maps
        bot.messageMap.delete(ctx.from.id);
        bot.messageMap.delete(partner);
        
        await updateUser(ctx.from.id, { chatStartTime: null, reportingPartner: partner });
        await updateUser(partner, { chatStartTime: null, reportingPartner: ctx.from.id });

        return ctx.reply(
          buildPartnerLeftMessage(),
          exitChatKeyboard
        );
      }
      
      // Check if partner restricted the bot (not enough rights)
      if (isNotEnoughRightsError(error)) {
        console.log(`[CHAT] - Partner ${partner} restricted bot, ending chat`);
        
        // Clean up the chat state (cleanupBlockedUser handles runningChats deletion)
        await cleanupBlockedUser(bot, partner);
        
        // Clean up message maps
        bot.messageMap.delete(ctx.from.id);
        bot.messageMap.delete(partner);
        
        await updateUser(ctx.from.id, { chatStartTime: null, reportingPartner: partner });
        await updateUser(partner, { chatStartTime: null, reportingPartner: ctx.from.id });

        return ctx.reply(
          buildPartnerLeftMessage(),
          exitChatKeyboard
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
          // Send typing indicator before retry
          await sendTypingIndicator();
          await withTimeout(ctx.copyMessage(partner));
          return;
        } catch (retryError: unknown) {
          // If retry also fails, check if it's a block/not enough rights error
          if (isBotBlockedError(retryError) || isNotEnoughRightsError(retryError)) {
            await cleanupBlockedUser(bot, partner);
            
            // Clean up message maps
            bot.messageMap.delete(ctx.from.id);
            bot.messageMap.delete(partner);
            
            await updateUser(ctx.from.id, { chatStartTime: null, reportingPartner: partner });
            await updateUser(partner, { chatStartTime: null, reportingPartner: ctx.from.id });

            return ctx.reply(
              buildPartnerLeftMessage(),
              exitChatKeyboard
            );
          }
          
          const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
          console.error(`[CHAT] - Retry failed:`, retryMessage);
        }
      }
      
      // Log other errors but don't crash the chat
      const genericMessage = error instanceof Error ? error.message : String(error);
      console.error(`[CHAT ERROR] -`, genericMessage);
    }
  }
} as Event;

