import * as fs from "fs";
import * as path from "path";
import { Context, Telegraf } from "telegraf";
import type { ExtraTelegraf } from "../index";
import { handleTelegramError } from "./telegramErrorHandler";
import { isAdmin } from "./adminAuth";

export interface Command {
  name: string;
  description?: string;
  execute: (ctx: Context, bot: Telegraf<Context>) => Promise<unknown>;
  disabled?: boolean;
  adminOnly?: boolean;
}
export async function loadCommands(bot: ExtraTelegraf) {
  try {
    let commandsDir = path.join(process.cwd(), "dist/Commands");
    if (process.env.NODE_ENV === "test" || !fs.existsSync(commandsDir)) {
      commandsDir = path.join(process.cwd(), "src/Commands");
    }
    const Files: string[] = [];
    
    // Recursively get all .js files in Commands directory
    function getAllFiles(dir: string): void {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          getAllFiles(fullPath);
        } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.ts'))) {
          Files.push(fullPath);
        }
      }
    }
    getAllFiles(commandsDir);

    for (const file of Files) {
      try {
        // Ensure absolute path for require
        const absolutePath = path.resolve(file);
        const commandFile = require(absolutePath).default;
        const command = commandFile as Command | undefined;

        if (!command || command.disabled || !command.name) {
          continue;
        }

        const commandName = command.name;
        bot.command(commandName, async (ctx: Context) => {
          if (command.adminOnly) {
            const userId = ctx.from?.id;
            if (!userId || !isAdmin(userId)) {
              await ctx.reply("🚫 You are not authorized to use this command.");
              return;
            }
          }

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
