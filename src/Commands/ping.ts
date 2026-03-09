import { Context } from "telegraf";
import { Command } from "../Utils/commandHandler";


export default {
  name: "ping",
  description: "Ping the bot",
  execute: async (ctx: Context) => {
    await ctx.reply("pong!");

  }
} as Command;