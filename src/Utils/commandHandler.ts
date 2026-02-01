import { glob } from "glob";
import { bot } from "../index";
import { Context, Telegraf } from "telegraf";
import { handleTelegramError } from "./telegramErrorHandler";

export interface Command {
  name: string;
  description?: string;
  execute: (ctx: Context, bot: Telegraf<Context>) => Promise<any>;
  disabled?: boolean;
}
export async function loadCommands() {
  try {
    const Files = await glob(`${process.cwd()}/dist/Commands/**/*.js`);

    for (let file of Files) {
      // Ensure absolute path for require
      const absolutePath = require("path").resolve(file);
      const commandFile = require(absolutePath).default;
      const command = commandFile;

      if (!command || command.disabled || !command.name) {
        continue;
      }

      const commandName = command.name;
      try {
        bot.command(commandName, async (ctx: Context) => {
          try {
            await command.execute(ctx, bot)
          } catch (error) {
            const userId = ctx.from?.id;
            handleTelegramError(bot, error, userId);
          }
        });
      } catch (error) {
        console.error(`[CommandHandler] -`, error);
      }
    }

    console.info(`[INFO] - Commands Loaded`);
  } catch (error) {
    console.error(`[CommandHandler] -`, error);
  }
}
