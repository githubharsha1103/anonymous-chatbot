import { Context, Markup } from "telegraf";
import { ExtraTelegraf } from "..";
import { getGender, getUser, updateUser } from "../storage/db";
import { cleanupBlockedUser, safeSendMessage } from "../Utils/telegramErrorHandler";

// Type for users in waiting queue
interface WaitingUser {
  id: number;
  preference: string;
  gender: string;
  isPremium: boolean;
}

export default {
  name: "next",
  description: "Skip current chat and find new partner",
  execute: async (ctx: Context, bot: ExtraTelegraf) => {

    const userId = ctx.from?.id as number;
    const gender = getGender(userId);
    
    // End current chat if in one
    if (bot.runningChats.includes(userId)) {
      const partner = bot.getPartner(userId);
      
      bot.runningChats = bot.runningChats.filter(
        u => u !== userId && u !== partner
      );
      
      bot.messageMap.delete(userId);
      bot.messageMap.delete(partner);

      // Store partner ID for potential report (both ways)
      if (partner) {
        updateUser(userId, { reportingPartner: partner });
        updateUser(partner, { reportingPartner: userId });
      }
      
      // Report keyboard
      const reportKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback("🚨 Report User", "OPEN_REPORT")]
      ]);

      // Use safeSendMessage to handle blocked partners
      await safeSendMessage(
        bot,
        partner,
        "🚫 Partner left the chat\n\n/next - Find new partner\n\n━━━━━━━━━━━━━━━━━\nTo report this chat:",
        reportKeyboard
      );

      return ctx.reply(
        "🚫 Partner left the chat\n\n/next - Find new partner\n\n━━━━━━━━━━━━━━━━━\nTo report this chat:",
        reportKeyboard
      );
    }

    // Remove from queue if already waiting
    const queueIndex = bot.waitingQueue.findIndex(w => w.id === userId);
    if (queueIndex !== -1) {
      bot.waitingQueue.splice(queueIndex, 1);
    }

    // Get user preference
    const user = getUser(userId);
    const preference = user.preference || "any";
    const isPremium = user.premium || false;

    // Find a compatible match
    const matchIndex = bot.waitingQueue.findIndex(waiting => {
      const w = waiting as WaitingUser;
      const currentUserSatisfied = 
        preference === "any" || preference === w.gender;
      const waitingUserSatisfied = 
        w.preference === "any" || w.preference === gender;
      return currentUserSatisfied && waitingUserSatisfied;
    });

    if (matchIndex !== -1) {
      const match = bot.waitingQueue[matchIndex] as WaitingUser;
      const matchUser = getUser(match.id);
      bot.waitingQueue.splice(matchIndex, 1);

      bot.runningChats.push(match.id, userId);

      // Store last partner and chat start time
      updateUser(userId, { lastPartner: match.id, chatStartTime: Date.now() });
      updateUser(match.id, { lastPartner: userId, chatStartTime: Date.now() });

      if (bot.waiting === match.id) {
        bot.waiting = null;
      }

      // Increment chat count for new chat
      bot.incrementChatCount();

      // Build partner info message
      const partnerGender = isPremium ? (matchUser.gender ? matchUser.gender.charAt(0).toUpperCase() + matchUser.gender.slice(1) : "Not Set") : "Available with Premium";
      const partnerAge = matchUser.age || "Not Set";
      
      const userPartnerInfo = 
`✅ Partner Matched

🔢 Age: ${partnerAge}
👥 Gender: ${partnerGender}
🌍 Country: 🇮🇳 India${matchUser.state ? ` - ${matchUser.state.charAt(0).toUpperCase() + matchUser.state.slice(1)}` : ""}

🚫 Links are restricted
⏱️ Media sharing unlocked after 2 minutes

/end — Leave the chat`;

      const matchPartnerInfo = 
`✅ Partner Matched

🔢 Age: ${user.age || "Not Set"}
👥 Gender: ${user.gender ? user.gender.charAt(0).toUpperCase() + user.gender.slice(1) : "Not Set"}
🌍 Country: 🇮🇳 India${user.state ? ` - ${user.state.charAt(0).toUpperCase() + user.state.slice(1)}` : ""}

🚫 Links are restricted
⏱️ Media sharing unlocked after 2 minutes

/end — Leave the chat`;

      // Use safeSendMessage to handle blocked matches
      await safeSendMessage(
        bot,
        match.id,
        matchPartnerInfo
      );

      return ctx.reply(userPartnerInfo);
    }

    // No match, add to queue
    bot.waitingQueue.push({ id: userId, preference, gender: gender || "any", isPremium } as WaitingUser);
    bot.waiting = userId;
    return ctx.reply("⏳ Waiting for a partner...");
  }
};
