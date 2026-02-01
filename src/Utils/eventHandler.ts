import { glob } from "glob";
import { bot } from "../index";
import { Context, Telegraf } from "telegraf";
import { handleTelegramError } from "./telegramErrorHandler";


export interface Event {
  type: any;
  execute: (ctx: Context, bot: Telegraf<Context>) => Promise<any>;
  disabled?: boolean;
}

export async function loadEvents() {
  try {
    const Files = await glob(`${process.cwd()}/dist/Events/**/*.js`);

    for (let file of Files) {
      // Ensure absolute path for require
      const absolutePath = require("path").resolve(file);
      const eventFile = require(absolutePath).default as Event;
      const event = eventFile;

      if (event.disabled) continue;

      const eventType = event.type;
      if (!eventType) continue;

      try {
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

