import { Command } from "../Utils/commandHandler";
import { Markup } from "telegraf";
import { getUser, updateUser, getReferralCount } from "../storage/db";

export default {
  name: "settings",
  description: "Open settings menu",
  execute: async (ctx, bot) => {

    if (!ctx.from) return;
    const u = await getUser(ctx.from.id);

    // Safely get preference display text
    const preferenceText = u.premium 
      ? (u.preference === "any" ? "Any" : u.preference === "male" ? "Male" : u.preference === "female" ? "Female" : "Any")
      : "🔒 Premium Only";

    // Get referral count
    const referralCount = await getReferralCount(ctx.from.id);

    const text =
`⚙ Settings

👤 Gender: ${u.gender ?? "Not Set"}
🎂 Age: ${u.age ?? "Not Set"}
📍 State: ${u.state ?? "Not Set"}
💕 Preference: ${preferenceText}
💎 Premium: ${u.premium ? "Yes ✅" : "No ❌"}
💬 Daily chats left: ${100 - (u.daily || 0)}/100
👥 Referrals: ${referralCount}/30

Use buttons below to update:`;

    return ctx.reply(text,
      Markup.inlineKeyboard([
        [Markup.button.callback("👤 Gender", "SET_GENDER")],
        [Markup.button.callback("🎂 Age", "SET_AGE")],
        [Markup.button.callback("📍 State", "SET_STATE")],
        [Markup.button.callback("💕 Preference", "SET_PREFERENCE")],
        [Markup.button.callback("🎁 Referrals", "OPEN_REFERRAL")]
      ])
    );
  }
} as Command;

// Gender selection keyboard
export const genderKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback("👨 Male", "GENDER_MALE")],
  [Markup.button.callback("👩 Female", "GENDER_FEMALE")],
  [Markup.button.callback("🔙 Back", "OPEN_SETTINGS")]
]);

// State selection keyboard
export const stateKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback("Telangana", "STATE_TELANGANA")],
  [Markup.button.callback("Andhra Pradesh", "STATE_AP")],
  [Markup.button.callback("🔙 Back", "OPEN_SETTINGS")]
]);

// Age input prompt
export const agePrompt = "Please enter your age (13-80):";

// State input prompt  
export const statePrompt = "Select your state:";
