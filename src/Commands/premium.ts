import { Context } from "telegraf";
import { Command } from "../Utils/commandHandler";
import { showPremiumPurchaseMenu } from "../Utils/starsPayments";

export default {
  name: "premium",
  description: "Buy premium using Telegram Stars",

  execute: async (ctx: Context) => {
    try {
      // Ensure command is used in private chat
      if (ctx.chat?.type !== "private") {
        await ctx.reply("⚠️ Please use this command in private chat with the bot.");
        return;
      }

      // Show premium purchase menu
      await showPremiumPurchaseMenu(ctx);

    } catch (error) {
      console.error("Premium command error:", error);
      await ctx.reply("❌ Something went wrong while opening the premium menu. Please try again later.");
    }
  }

} as Command;