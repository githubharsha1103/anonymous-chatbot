import * as fs from "fs";
import * as path from "path";
import { Context, Telegraf } from "telegraf";
import type { ExtraTelegraf } from "../index";
import { handleTelegramError } from "./telegramErrorHandler";
import { UpdateType } from "telegraf/typings/telegram-types";


export interface Event {
  type: UpdateType | UpdateType[];
  execute: (ctx: Context, bot: Telegraf<Context>) => Promise<unknown>;
  disabled?: boolean;
}

export async function loadEvents(bot: ExtraTelegraf) {
  try {
    let eventsDir = path.join(process.cwd(), "dist/Events");
    if (process.env.NODE_ENV === "test" || !fs.existsSync(eventsDir)) {
      eventsDir = path.join(process.cwd(), "src/Events");
    }
    const Files: string[] = [];
    
    // Recursively get all .js files in Events directory
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
    getAllFiles(eventsDir);

    for (const file of Files) {
      try {
        // Ensure absolute path for require
        const absolutePath = path.resolve(file);
        const event = require(absolutePath).default as Event | undefined;

        if (!event || event.disabled) continue;

        const eventType = event.type;
        if (!eventType) continue;

        bot.on(eventType, async (ctx: Context) => {
          try {
            await event.execute(ctx, bot)
          }
          catch (error) {
            const userId = ctx.from?.id;
            handleTelegramError(bot, error, userId);
          }
        }
        );
      } catch (error) {
        console.error(`[EventHandler] -`, error);
      }
    }
    console.info(`[INFO] - Events Loaded`);
  } catch (err) {
    console.error(`[EventHandler] -`, err);
  }
}
