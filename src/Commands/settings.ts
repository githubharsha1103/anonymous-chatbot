import { Context } from "telegraf";
import { Command } from "../Utils/commandHandler";
import { showSettings } from "../Utils/actionHandler";

export default {
  name: "settings",
  description: "Open settings menu",
  execute: async (ctx: Context) => {
    if (!ctx.from) return;
    
    // Use the shared showSettings function for consistent UI
    // The function handles both callback queries and regular commands
    await showSettings(ctx);
  }
} as Command;
