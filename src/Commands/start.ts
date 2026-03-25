import { Context, Telegraf } from "telegraf";
import { Command } from "../Utils/commandHandler";
import { ExtraTelegraf } from "..";
import { getUser, updateUser, updateLastActive, processReferral } from "../storage/db";
import { getSetupStepPrompt, SetupStep } from "../Utils/setupFlow";
import { getIsBroadcasting } from "../index";

const SETUP_STEP_DONE = "done";

type StartContext = Context & {
  startPayload?: string;
  update: Context["update"] & {
    message?: { text?: string };
  };
};

export default {
  name: "start",
  description: "Start the bot",
  execute: async (ctx: Context, bot: Telegraf<Context>) => {
    if (!ctx.from) {
      await ctx.reply("⚠️ Could not identify your account. Please try /start again.");
      return;
    }

    // Check if broadcast is in progress - block matching during broadcast
    if (getIsBroadcasting()) {
      await ctx.reply("⚠️ Server busy due to update. Please try again in a few seconds.");
      return;
    }

    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name || "Unknown";
    const startPayload = (ctx as StartContext).startPayload;
    const messageText = (ctx as StartContext).update?.message?.text;
    const startParam = startPayload || (messageText?.split(" ")[1] || null);

    console.log(`[START] - User ${userId} (${username}) starting`);
    console.log(`[START] - startPayload (ctx.startPayload): ${startPayload}`);
    console.log(`[START] - parsed startParam: ${startParam}`);

    const user = await getUser(userId);

    if (user.isNew) {
      if (startParam && startParam.startsWith("REF")) {
        const referralSuccess = await processReferral(userId, startParam);
        if (referralSuccess) {
          console.log(`[START] - Referral processed successfully for user ${userId} with code: ${startParam}`);
        } else {
          console.log(`[START] - Referral could not be processed for user ${userId} (invalid code or self-referral)`);
        }
      }

      await updateUser(userId, {
        createdAt: Date.now(),
        lastActive: Date.now(),
        name: username
      });
      (bot as ExtraTelegraf).incrementUserCount();

      await ctx.reply(
        "🌟 <b>Welcome to Anonymous Chat!</b> 🌟\n\n" +
          "✨ Connect with strangers anonymously\n" +
          "🔒 Your privacy is protected\n" +
          "💬 Chat freely and safely\n\n" +
          "Tap <b>Get Started</b> to begin!",
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [[{ text: "🌟 Get Started", callback_data: "SETUP_BACK_GENDER" }]]
          }
        }
      );
      return;
    }

    await updateLastActive(userId);

    const setupStep = user.setupStep as SetupStep | undefined;
    if (setupStep && setupStep !== SETUP_STEP_DONE) {
      const prompt = getSetupStepPrompt(setupStep === "state_other" ? "state_other" : setupStep);
      if (prompt) {
        await ctx.reply(prompt.text, { parse_mode: "Markdown", ...(prompt.keyboard || {}) });
        return;
      }
    }

    const groupInviteLink = process.env.GROUP_INVITE_LINK || "https://t.me/teluguanomychat";
    await ctx.reply(
      "🌟 <b>Welcome back!</b> 🌟\n\n" +
        "This bot helps you chat anonymously with people worldwide.\n\n" +
        "📢 <b>Join our community group!</b>\n" +
        "Meet more people and stay updated!\n" +
        `👉 ${groupInviteLink}\n\n` +
        "Use the commands below to navigate:",
      {
        parse_mode: "HTML"
      }
    );
  }
} as Command;

