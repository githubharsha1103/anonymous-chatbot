import { Markup } from "telegraf";
import type { User } from "../storage/db";

export type SetupStep = "gender" | "age" | "age_manual" | "state" | "state_north" | "state_south" | "state_east" | "state_west" | "state_central" | "state_northeast" | "state_ut" | "state_other" | "done";

export const allIndianStates = [
    { name: "Andhra Pradesh", code: "AP" },
    { name: "Arunachal Pradesh", code: "AR" },
    { name: "Assam", code: "AS" },
    { name: "Bihar", code: "BR" },
    { name: "Chhattisgarh", code: "CG" },
    { name: "Goa", code: "GA" },
    { name: "Gujarat", code: "GJ" },
    { name: "Haryana", code: "HR" },
    { name: "Himachal Pradesh", code: "HP" },
    { name: "Jharkhand", code: "JH" },
    { name: "Karnataka", code: "KA" },
    { name: "Kerala", code: "KL" },
    { name: "Madhya Pradesh", code: "MP" },
    { name: "Maharashtra", code: "MH" },
    { name: "Manipur", code: "MN" },
    { name: "Meghalaya", code: "ML" },
    { name: "Mizoram", code: "MZ" },
    { name: "Nagaland", code: "NL" },
    { name: "Odisha", code: "OR" },
    { name: "Punjab", code: "PB" },
    { name: "Rajasthan", code: "RJ" },
    { name: "Sikkim", code: "SK" },
    { name: "Tamil Nadu", code: "TN" },
    { name: "Telangana", code: "TS" },
    { name: "Tripura", code: "TR" },
    { name: "Uttar Pradesh", code: "UP" },
    { name: "Uttarakhand", code: "UK" },
    { name: "West Bengal", code: "WB" }
];

export const allUnionTerritories = [
    { name: "Delhi", code: "DL" },
    { name: "Jammu & Kashmir", code: "JK" },
    { name: "Ladakh", code: "LA" },
    { name: "Puducherry", code: "PY" },
    { name: "Chandigarh", code: "CH" },
    { name: "Dadra & Nagar Haveli", code: "DN" },
    { name: "Daman & Diu", code: "DD" },
    { name: "Lakshadweep", code: "LD" },
    { name: "Andaman & Nicobar", code: "AN" }
];

export const setupStateKeyboardPage1 = Markup.inlineKeyboard([
    [Markup.button.callback("📍 North India", "SETUP_STATE_NORTH")],
    [Markup.button.callback("📍 South India", "SETUP_STATE_SOUTH")],
    [Markup.button.callback("📍 East India", "SETUP_STATE_EAST")],
    [Markup.button.callback("📍 West India", "SETUP_STATE_WEST")],
    [Markup.button.callback("📍 Central India", "SETUP_STATE_CENTRAL")],
    [Markup.button.callback("📍 North-East India", "SETUP_STATE_NORTHEAST")],
    [Markup.button.callback("📍 Union Territories", "SETUP_STATE_UT")],
    [Markup.button.callback("🌍 Outside India", "SETUP_COUNTRY_OTHER")]
]);

export const setupStateNorthKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🟢 Delhi", "SETUP_STATE_DELHI")],
    [Markup.button.callback("🟢 Haryana", "SETUP_STATE_HARYANA")],
    [Markup.button.callback("🟢 Himachal Pradesh", "SETUP_STATE_HIMACHAL")],
    [Markup.button.callback("🟢 Jammu & Kashmir", "SETUP_STATE_JAMMU")],
    [Markup.button.callback("🟢 Punjab", "SETUP_STATE_PUNJAB")],
    [Markup.button.callback("🟢 Rajasthan", "SETUP_STATE_RAJASTHAN")],
    [Markup.button.callback("🟢 Uttarakhand", "SETUP_STATE_UTTARAKHAND")],
    [Markup.button.callback("🟢 Uttar Pradesh", "SETUP_STATE_UTTARPRADESH")],
    [Markup.button.callback("⬅️ Back", "SETUP_BACK_STATE_P1")]
]);

export const setupStateSouthKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🔵 Andhra Pradesh", "SETUP_STATE_AP")],
    [Markup.button.callback("🔵 Karnataka", "SETUP_STATE_KARNATAKA")],
    [Markup.button.callback("🔵 Kerala", "SETUP_STATE_KERALA")],
    [Markup.button.callback("🔵 Tamil Nadu", "SETUP_STATE_TAMILNADU")],
    [Markup.button.callback("🔵 Telangana", "SETUP_STATE_TELANGANA")],
    [Markup.button.callback("⬅️ Back", "SETUP_BACK_STATE_P1")]
]);

export const setupStateEastKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🟠 Bihar", "SETUP_STATE_BIHAR")],
    [Markup.button.callback("🟠 Jharkhand", "SETUP_STATE_JHARKHAND")],
    [Markup.button.callback("🟠 Odisha", "SETUP_STATE_ODISHA")],
    [Markup.button.callback("🟠 West Bengal", "SETUP_STATE_WESTBENGAL")],
    [Markup.button.callback("⬅️ Back", "SETUP_BACK_STATE_P1")]
]);

export const setupStateWestKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🟣 Goa", "SETUP_STATE_GOA")],
    [Markup.button.callback("🟣 Gujarat", "SETUP_STATE_GUJARAT")],
    [Markup.button.callback("🟣 Maharashtra", "SETUP_STATE_MAHARASHTRA")],
    [Markup.button.callback("⬅️ Back", "SETUP_BACK_STATE_P1")]
]);

export const setupStateCentralKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🟤 Chhattisgarh", "SETUP_STATE_CHHATTISGARH")],
    [Markup.button.callback("🟤 Madhya Pradesh", "SETUP_STATE_MADHYAPRADESH")],
    [Markup.button.callback("⬅️ Back", "SETUP_BACK_STATE_P1")]
]);

export const setupStateNortheastKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🟢 Arunachal Pradesh", "SETUP_STATE_ARUNACHAL")],
    [Markup.button.callback("🟢 Assam", "SETUP_STATE_ASSAM")],
    [Markup.button.callback("🟢 Manipur", "SETUP_STATE_MANIPUR")],
    [Markup.button.callback("🟢 Meghalaya", "SETUP_STATE_MEGHALAYA")],
    [Markup.button.callback("🟢 Mizoram", "SETUP_STATE_MIZORAM")],
    [Markup.button.callback("🟢 Nagaland", "SETUP_STATE_NAGALAND")],
    [Markup.button.callback("🟢 Sikkim", "SETUP_STATE_SIKKIM")],
    [Markup.button.callback("🟢 Tripura", "SETUP_STATE_TRIPURA")],
    [Markup.button.callback("⬅️ Back", "SETUP_BACK_STATE_P1")]
]);

export const setupStateUTKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🟠 Chandigarh", "SETUP_STATE_CHANDIGARH")],
    [Markup.button.callback("🟠 Delhi", "SETUP_STATE_DELHI")],
    [Markup.button.callback("🟠 Jammu & Kashmir", "SETUP_STATE_JAMMU")],
    [Markup.button.callback("🟠 Ladakh", "SETUP_STATE_LADAKH")],
    [Markup.button.callback("🟠 Puducherry", "SETUP_STATE_PUDUCHERRY")],
    [Markup.button.callback("🟠 Andaman & Nicobar", "SETUP_STATE_ANDAMAN")],
    [Markup.button.callback("⬅️ Back", "SETUP_BACK_STATE_P1")]
]);

export const setupGenderKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("👨 Male", "SETUP_GENDER_MALE")],
    [Markup.button.callback("👩 Female", "SETUP_GENDER_FEMALE")]
]);

export const setupAgeKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("15", "SETUP_AGE_13_17")],
    [Markup.button.callback("22", "SETUP_AGE_18_25")],
    [Markup.button.callback("33", "SETUP_AGE_26_40")],
    [Markup.button.callback("45", "SETUP_AGE_40_PLUS")],
    [Markup.button.callback("📝 Type Age", "SETUP_AGE_MANUAL")]
]);

export const setupAgeManualKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("⬅️ Back", "SETUP_BACK_AGE")]
]);

export const setupStateManualKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("⬅️ Back", "SETUP_BACK_STATE")]
]);

export function getSetupStepPrompt(step: SetupStep): { text: string; keyboard?: ReturnType<typeof Markup.inlineKeyboard> } | null {
    switch (step) {
        case "gender":
            return {
                text:
                    "📝 *Step 1 of 3*\n\n" +
                    "👤 *Select your gender:*",
                keyboard: setupGenderKeyboard
            };
        case "age":
            return {
                text:
                    "📝 *Step 2 of 3*\n\n" +
                    "🎂 *Select your age:*\n" +
                    "(Choose the option closest to your age)",
                keyboard: setupAgeKeyboard
            };
        case "age_manual":
            return {
                text:
                    "📝 *Enter your age:*\n\n" +
                    "Please type a number between 13 and 80\n" +
                    "(e.g., 21)",
                keyboard: setupAgeManualKeyboard
            };
        case "state":
            return {
                text:
                    "📝 *Step 3 of 3*\n\n" +
                    "📍 *Select your location:*\n" +
                    "(Choose your Indian state/territory)",
                keyboard: setupStateKeyboardPage1
            };
        case "state_north":
            return {
                text:
                    "📍 *North India*\n\n" +
                    "Select your state:",
                keyboard: setupStateNorthKeyboard
            };
        case "state_south":
            return {
                text:
                    "📍 *South India*\n\n" +
                    "Select your state:",
                keyboard: setupStateSouthKeyboard
            };
        case "state_east":
            return {
                text:
                    "📍 *East India*\n\n" +
                    "Select your state:",
                keyboard: setupStateEastKeyboard
            };
        case "state_west":
            return {
                text:
                    "📍 *West India*\n\n" +
                    "Select your state:",
                keyboard: setupStateWestKeyboard
            };
        case "state_central":
            return {
                text:
                    "📍 *Central India*\n\n" +
                    "Select your state:",
                keyboard: setupStateCentralKeyboard
            };
        case "state_northeast":
            return {
                text:
                    "📍 *North-East India*\n\n" +
                    "Select your state:",
                keyboard: setupStateNortheastKeyboard
            };
        case "state_ut":
            return {
                text:
                    "📍 *Union Territories*\n\n" +
                    "Select your UT:",
                keyboard: setupStateUTKeyboard
            };
        case "state_other":
            return {
                text:
                    "📍 *Enter your state:*\n\n" +
                    "(e.g., Karnataka, Tamil Nadu, Maharashtra, etc.)",
                keyboard: setupStateManualKeyboard
            };
        default:
            return null;
    }
}

export function getSetupRequiredPrompt(user: Pick<User, "gender" | "age" | "state">): { text: string; keyboard: ReturnType<typeof Markup.inlineKeyboard> } | null {
    if (!user.gender) {
        return {
            text:
                "📝 *Setup Required*\n\n" +
                "⚠️ You must complete your profile before using the bot.\n\n" +
                "👤 *Step 1 of 3*\n" +
                "Select your gender:",
            keyboard: setupGenderKeyboard
        };
    }

    if (!user.age) {
        return {
            text:
                "📝 *Setup Required*\n\n" +
                "⚠️ You must complete your profile before using the bot.\n\n" +
                "👤 *Step 2 of 3*\n" +
                "🎂 *Select your age:*\n" +
                "(Choose the option closest to your age)",
            keyboard: setupAgeKeyboard
        };
    }

    if (!user.state) {
        return {
            text:
                "📝 *Setup Required*\n\n" +
                "⚠️ You must complete your profile before using the bot.\n\n" +
                "👤 *Step 3 of 3*\n" +
                "📍 *Select your location:*\n" +
                "(Choose your Indian state/territory)",
            keyboard: setupStateKeyboardPage1
        };
    }

    return null;
}

export function getSetupCompleteText(user: Pick<User, "gender" | "age" | "state">, groupInviteLink: string): string {
    const genderText = user.gender
        ? user.gender.charAt(0).toUpperCase() + user.gender.slice(1)
        : "Not Set";
    const genderEmoji = user.gender === "female" ? "👩" : user.gender === "male" ? "👨" : "👤";
    const stateText = user.state === "Other" ? "🌍 Other" : (user.state || "Not Set");

    return (
        "✨ *Profile Complete!* ✨\n\n" +
        "━━━━━━━━━━━━━━━━━━━━\n\n" +
        "📋 *Your Profile:*\n\n" +
        `${genderEmoji} *Gender:* ${genderText}\n` +
        `🎂 *Age:* ${user.age || "Not Set"}\n` +
        `📍 *Location:* ${stateText}\n\n` +
        "━━━━━━━━━━━━━━━━━━━━\n\n" +
        "📢 *Want to join our community group?*\n" +
        "Join to meet more people and stay updated!\n" +
        `👉 ${groupInviteLink}\n\n` +
        "━━━━━━━━━━━━━━━━━━━━\n\n" +
        "🎉 *You're all set to start chatting!*\n" +
        "/search - Find a chat partner now\n" +
        "⚙️ /settings - Update your profile anytime\n" +
        "❓ /help - Get help with commands\n\n" +
        "💡 *Tip:* Be friendly and respectful for the best experience!"
    );
}
