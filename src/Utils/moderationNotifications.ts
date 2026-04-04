import { Telegram } from "telegraf";

export async function notifyUserBanned(telegram: Telegram, userId: number, reason: string): Promise<void> {
  try {
    await telegram.sendMessage(
      userId,
      `🚫 *You are banned*\n\nReason: ${reason}`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    console.error(`[MODERATION_NOTIFY] Failed to notify banned user ${userId}:`, error);
  }
}

export async function notifyUserUnbanned(telegram: Telegram, userId: number): Promise<void> {
  try {
    await telegram.sendMessage(
      userId,
      "Yay, you are unbanned and free to use the bot. Make sure you don't violate any rules from the bot."
    );
  } catch (error) {
    console.error(`[MODERATION_NOTIFY] Failed to notify unbanned user ${userId}:`, error);
  }
}
