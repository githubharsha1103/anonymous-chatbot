import { Context } from "telegraf";

type CbQueryCtx = Context & {
  callbackQuery?: { id?: string };
  answerCbQuery?: (text?: string) => Promise<unknown>;
};

export function getErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const errorLike = error as { description?: string; message?: string };
    return errorLike.description || errorLike.message || "Unknown error";
  }
  return String(error);
}

export async function safeAnswerCbQuery(ctx: CbQueryCtx, text?: string): Promise<void> {
  try {
    if (ctx.callbackQuery?.id && ctx.answerCbQuery) {
      await ctx.answerCbQuery(text);
    }
  } catch {
    // Ignore callback-query expiry or invalid state errors.
  }
}

export async function safeEditMessageText(
  ctx: Context,
  text: string,
  extra?: unknown
): Promise<void> {
  try {
    await ctx.editMessageText(text, extra as Parameters<Context["editMessageText"]>[1]);
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    if (message.includes("message is not modified")) {
      return;
    }
    try {
      await ctx.reply(text, extra as Parameters<Context["reply"]>[1]);
    } catch {
      // Swallow final fallback errors to avoid crashing handlers.
    }
  }
}
