import * as fs from "fs";
import * as path from "path";
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
    const commandsDir = path.join(process.cwd(), "dist/Commands");
    const Files: string[] = [];
    
    // Recursively get all .js files in Commands directory
    function getAllFiles(dir: string): void {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          getAllFiles(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
          Files.push(fullPath);
        }
      }
    }
    getAllFiles(commandsDir);

    for (const file of Files) {
      // Ensure absolute path for require
      const absolutePath = path.resolve(file);
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
