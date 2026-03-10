import { Context } from "telegraf";
import { Command } from "../Utils/commandHandler";
import { showPremiumPurchaseMenu } from "../Utils/starsPayments";

export default {
  name: "premium",
  description: "Buy premium using Telegram Stars",
  execute: async (ctx: Context) => {
    await showPremiumPurchaseMenu(ctx);
  }
} as Command;
