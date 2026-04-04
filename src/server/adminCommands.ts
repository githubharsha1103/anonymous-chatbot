import { ExtraTelegraf } from '../index';
import {
  getAllUsers,
  getTotalChats,
  banUser,
  updateUser
} from '../storage/db';
import { broadcastWithRateLimit } from '../Utils/telegramErrorHandler';
import { isAdmin } from '../Utils/adminAuth';
import { notifyUserBanned } from '../Utils/moderationNotifications';

/**
 * Register admin commands on the bot
 */
export function registerAdminCommands(bot: ExtraTelegraf): void {
  // Ban command
  bot.command("ban", async (ctx) => {
    if (!ctx.from) return;
    if (!isAdmin(ctx.from.id)) return;

    const id = Number(ctx.message.text.split(" ")[1]);
    if (!id) return ctx.reply("📝 Usage: /ban USERID");

    try {
      const reason = "Banned by admin";
      await banUser(id, reason, ctx.from.id);
      await notifyUserBanned(ctx.telegram, id, reason);
      ctx.reply(`User ${id} banned`);
    } catch (error) {
      console.error("[Ban command] Error:", error);
      ctx.reply("⛔ Failed to ban user. Please try again.");
    }
  });

  // Broadcast command
  bot.command("broadcast", async (ctx) => {
    if (!ctx.from) return;
    if (!isAdmin(ctx.from.id)) return;

    const msg = ctx.message.text.replace("/broadcast", "").trim();
    if (!msg) return ctx.reply("📝 Usage: /broadcast message");

    try {
      const users = await getAllUsers();
      
      if (users.length === 0) {
        return ctx.reply("📢 No users to broadcast to.");
      }

      const userIds = users.map(id => Number(id)).filter(id => !isNaN(id));
      const { success, failed } = await broadcastWithRateLimit(bot, userIds, msg);
      
      // NOTE: We no longer delete users who failed to receive broadcast
      // Users remain in the system even if they blocked the bot or are deactivated
      // This prevents accidental deletion of legitimate users
      
      ctx.reply(`Broadcast completed!\n✅ Sent: ${success}\n❌ Failed: ${failed}\n\nTotal Users: ${userIds.length}`);
    } catch (error) {
      console.error("[Broadcast command] Error:", error);
      ctx.reply("📢 Failed to broadcast. Please try again.");
    }
  });

  // Active chats command
  bot.command("active", (ctx) => {
    if (!ctx.from) return;
    if (!isAdmin(ctx.from.id)) return;
    ctx.reply(`Active chats: ${bot.runningChats.size / 2}`);
  });

  // Stats command
  bot.command("stats", async (ctx) => {
    if (!ctx.from) return;
    if (!isAdmin(ctx.from.id)) return;
    
    try {
      const allUsers = await getAllUsers();
      const totalChats = await getTotalChats();
      
      const stats = `
📊 <b>Bot Statistics</b>

👥 <b>Total Users:</b> ${allUsers.length}
💬 <b>Total Chats:</b> ${totalChats}
💭 <b>Active Chats:</b> ${bot.runningChats.size / 2}
⏳ <b>Users Waiting:</b> ${bot.waitingQueue.length}
`;

      ctx.reply(stats, { parse_mode: "HTML" });
    } catch (error) {
      console.error("[Stats command] Error:", error);
      ctx.reply("📊 Failed to fetch statistics.");
    }
  });

  // Set name command
  bot.command("setname", async (ctx) => {
    if (!ctx.from) return;
    if (!isAdmin(ctx.from.id)) return;
    
    const args = ctx.message.text.split(" ");
    const id = Number(args[1]);
    const name = args.slice(2).join(" ").trim();
    
    if (!id || !name) return ctx.reply("📝 Usage: /setname USERID NewName");
    
    try {
      await updateUser(id, { name });
      ctx.reply(`User ${id} name updated to: ${name}`);
    } catch (error) {
      console.error("[Setname command] Error:", error);
      ctx.reply("✏️ Failed to update user name.");
    }
  });
}
