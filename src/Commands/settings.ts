import { Command } from "../Utils/commandHandler";
import { Markup } from "telegraf";
import { getReferralCount, getUser } from "../storage/db";

export default {
  name: "settings",
  description: "Open settings menu",
  execute: async (ctx) => {
    if (!ctx.from) return;

    const user = await getUser(ctx.from.id);
    const referralCount = await getReferralCount(ctx.from.id);
    const preferenceText = user.premium
      ? user.preference === "male"
        ? "Male"
        : user.preference === "female"
          ? "Female"
          : "Any"
      : "Premium Only";

    const text =
`Settings

Gender: ${user.gender ?? "Not Set"}
Age: ${user.age ?? "Not Set"}
State: ${user.state ?? "Not Set"}
Preference: ${preferenceText}
Premium: ${user.premium ? "Yes" : "No"}
Blocked Users: ${(user.blockedUsers || []).length}
Chats: Unlimited
Referrals: ${referralCount}/30

Use buttons below to update:`;

    return ctx.reply(
      text,
      Markup.inlineKeyboard([
        [Markup.button.callback("Gender", "SET_GENDER")],
        [Markup.button.callback("Age", "SET_AGE")],
        [Markup.button.callback("State", "SET_STATE")],
        [Markup.button.callback("Preference", "SET_PREFERENCE")],
        [Markup.button.callback("Blocked Users", "OPEN_BLOCKED_USERS")],
        [Markup.button.callback("Referrals", "OPEN_REFERRAL")],
        [Markup.button.callback("Premium", "BUY_PREMIUM")]
      ])
    );
  }
} as Command;
