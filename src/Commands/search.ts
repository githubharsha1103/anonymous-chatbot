import { Context } from "telegraf";
import { ExtraTelegraf } from "..";
import { areUsersMutuallyBlocked, getUser, updateUser } from "../storage/db";
import { beginChatRuntime, buildPartnerMatchMessage } from "../Utils/chatFlow";
import { endChatDueToError, sendMessageWithRetry } from "../Utils/telegramErrorHandler";
import { getSetupRequiredPrompt } from "../Utils/setupFlow";

interface WaitingUser {
  id: number;
  preference: string;
  gender: string;
  isPremium: boolean;
  blockedUsers?: number[];
}

export async function redirectToSetup(ctx: Context) {
  if (!ctx.from) return null;

  try {
    const user = await getUser(ctx.from.id);
    const prompt = getSetupRequiredPrompt(user);

    if (prompt) {
      return ctx.reply(prompt.text, { parse_mode: "Markdown", ...prompt.keyboard });
    }

    return null;
  } catch (error) {
    console.error("[redirectToSetup] Error fetching user:", error);
    return ctx.reply("?? An error occurred. Please try again.");
  }
}

export default {
  name: "search",
  description: "Search for a chat",
  execute: async (ctx: Context, bot: ExtraTelegraf) => {
    const userId = ctx.from?.id as number;

    if (bot.isRateLimited(userId)) {
      return ctx.reply("? Please wait a moment before searching again.");
    }

    bot.syncQueueState();

    if (bot.isQueueFull()) {
      return ctx.reply("?? Queue is full. Please try again later.");
    }

    const MAX_QUEUE_SOFT_LIMIT = 9500;
    if (bot.waitingQueue.length > MAX_QUEUE_SOFT_LIMIT) {
      const removeCount = bot.trimWaitingQueue(MAX_QUEUE_SOFT_LIMIT);
      console.log(`[QUEUE] - Queue size limit enforced, removed ${removeCount} oldest users`);
    }

    const user = await getUser(userId);
    if (!user.gender || !user.age || !user.state) {
      return redirectToSetup(ctx);
    }

    try {
      return await bot.withChatStateLock(async () => {
        const gender = user.gender || "any";
        const preference = user.preference || "any";
        const isPremium = user.premium || false;
        const myBlockedUsers = user.blockedUsers || [];

        if (bot.runningChats.has(userId)) {
          return ctx.reply(
            "You are already in a chat!\n\nUse /end to leave the chat or use /next to skip the current chat."
          );
        }

        if (bot.isInQueue(userId)) {
          return ctx.reply("You are already in the queue!");
        }

        const matchPreference = isPremium && preference !== "any" ? preference : null;
        let matchIndex = -1;

        for (let i = 0; i < bot.waitingQueue.length; i++) {
          const queuedUser = bot.waitingQueue[i] as WaitingUser;
          if (!bot.queueSet.has(queuedUser.id)) continue;

          const waitingGender = queuedUser.gender || "any";
          const waitingPreference = queuedUser.preference || "any";
          const genderMatches = !matchPreference || waitingGender === matchPreference;
          const preferenceMatches = waitingPreference === "any" || waitingPreference === gender;

          if (genderMatches && preferenceMatches) {
            const blockedByLatestState = await areUsersMutuallyBlocked(userId, queuedUser.id);
            if (blockedByLatestState) continue;

            matchIndex = i;
            break;
          }
        }

        if (matchIndex === -1) {
          const added = bot.addToQueueAtomic({
            id: userId,
            preference,
            gender,
            isPremium,
            blockedUsers: myBlockedUsers
          });
          if (!added) {
            return ctx.reply("You are already in the queue!");
          }
          return ctx.reply("? Waiting for a partner...");
        }

        const match = bot.waitingQueue[matchIndex] as WaitingUser;
        bot.waitingQueue.splice(matchIndex, 1);
        bot.queueSet.delete(match.id);
        beginChatRuntime(bot, userId, match.id);

        const chatStartTime = Date.now();
        await updateUser(userId, { lastPartner: match.id, chatStartTime });
        await updateUser(match.id, { lastPartner: userId, chatStartTime });

        const matchUser = await getUser(match.id);
        bot.incrementChatCount();

        const userPartnerInfo = buildPartnerMatchMessage(isPremium, matchUser);
        const matchPartnerInfo = buildPartnerMatchMessage(!!user.premium, user);

        const matchSent = await sendMessageWithRetry(bot, match.id, matchPartnerInfo);
        if (!matchSent) {
          const partnerStillThere = bot.runningChats.has(match.id);
          await endChatDueToError(bot, userId, match.id);

          if (partnerStillThere) {
            const requeued = bot.addToQueueAtomic({
              id: userId,
              preference,
              gender,
              isPremium,
              blockedUsers: myBlockedUsers
            });
            if (!requeued) {
              return ctx.reply("?? Temporary connection issue. Please try /search again.");
            }

            return ctx.reply(
              "?? Temporary connection issue with partner. You've been added back to the queue...\n? Waiting for a new partner..."
            );
          }

          return ctx.reply("?? Could not connect to partner. They may have left or restricted the bot.");
        }

        return ctx.reply(userPartnerInfo);
      });
    } catch (error) {
      console.error("[Search command] Match flow failed:", error);
      return ctx.reply("?? Server is busy. Please try again in a moment.");
    }
  }
};
