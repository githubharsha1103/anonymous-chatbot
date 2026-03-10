import { Context, Markup } from "telegraf";
import { ExtraTelegraf } from "..";
import { getUser, updateUser, User } from "../storage/db";

type PremiumPlanId = "premium_weekly" | "premium_monthly" | "premium_yearly";

type PremiumPlan = {
  id: PremiumPlanId;
  name: string;
  days: number;
  stars: number;
  amount: number;
};

const PREMIUM_PLANS: Record<PremiumPlanId, PremiumPlan> = {
  premium_weekly: {
    id: "premium_weekly",
    name: "Weekly Premium",
    days: 7,
    stars: 100,
    amount: 10000
  },
  premium_monthly: {
    id: "premium_monthly",
    name: "Monthly Premium",
    days: 30,
    stars: 250,
    amount: 25000
  },
  premium_yearly: {
    id: "premium_yearly",
    name: "Yearly Premium",
    days: 365,
    stars: 1000,
    amount: 100000
  }
};

function getPlanFromPayload(payload: string): PremiumPlan | null {
  if (payload in PREMIUM_PLANS) {
    return PREMIUM_PLANS[payload as PremiumPlanId];
  }
  return null;
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toISOString().slice(0, 10);
}

export function isPremium(user: Pick<User, "premium" | "premiumExpires" | "premiumExpiry">): boolean {
  const expiry = user.premiumExpires || user.premiumExpiry || 0;
  return !!user.premium && expiry > Date.now();
}

export async function showPremiumPurchaseMenu(ctx: Context): Promise<void> {
  const text =
`⭐ Buy Premium

Premium Plans:
⭐ Weekly Premium - 100 Stars
⭐ Monthly Premium - 250 Stars
⭐ Yearly Premium - 1000 Stars`;

  await ctx.reply(
    text,
    Markup.inlineKeyboard([
      [Markup.button.callback("⭐ Weekly - 100 Stars", "premium_weekly")],
      [Markup.button.callback("⭐ Monthly - 250 Stars", "premium_monthly")],
      [Markup.button.callback("⭐ Yearly - 1000 Stars", "premium_yearly")]
    ])
  );
}

async function createPremiumInvoice(ctx: Context, plan: PremiumPlan): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  await ctx.telegram.sendInvoice(userId, {
    title: "Premium Subscription",
    description: "Unlock premium features in the anonymous chat bot",
    payload: plan.id,
    provider_token: "",
    currency: "XTR",
    prices: [{ label: `${plan.name}`, amount: plan.amount }]
  });
}

async function activatePremium(
  userId: number,
  plan: PremiumPlan,
  paymentChargeId: string
): Promise<{ activated: boolean; premiumUntil: number; alreadyProcessed: boolean }> {
  const user = await getUser(userId);
  const processed = user.processedPaymentChargeIds || [];

  if (processed.includes(paymentChargeId)) {
    const existingExpiry = user.premiumExpires || user.premiumExpiry || Date.now();
    return {
      activated: true,
      premiumUntil: existingExpiry,
      alreadyProcessed: true
    };
  }

  const now = Date.now();
  const currentExpiry = user.premiumExpires || user.premiumExpiry || 0;
  const base = currentExpiry > now ? currentExpiry : now;
  const extensionMs = plan.days * 24 * 60 * 60 * 1000;
  const newExpiry = base + extensionMs;

  await updateUser(userId, {
    premium: true,
    premiumExpires: newExpiry,
    premiumExpiry: newExpiry,
    processedPaymentChargeIds: [...processed, paymentChargeId]
  });

  return {
    activated: true,
    premiumUntil: newExpiry,
    alreadyProcessed: false
  };
}

export function initStarsPaymentHandlers(bot: ExtraTelegraf): void {
  bot.action(/premium_(weekly|monthly|yearly)/, async (ctx) => {
    await ctx.answerCbQuery();
    const match = ctx.match as RegExpExecArray | undefined;
    const payload = match ? `premium_${match[1]}` : "";
    const plan = getPlanFromPayload(payload);

    if (!plan) {
      await ctx.reply("Invalid premium plan. Please try again.");
      return;
    }

    await createPremiumInvoice(ctx, plan);
  });

  bot.on("pre_checkout_query", async (ctx) => {
    await ctx.answerPreCheckoutQuery(true);
  });
}

export async function handleSuccessfulPaymentMessage(ctx: Context): Promise<boolean> {
  if (!("message" in ctx.update) || !ctx.update.message) {
    return false;
  }

  const message = ctx.update.message as Context["message"] & {
    successful_payment?: {
      invoice_payload: string;
      telegram_payment_charge_id: string;
    };
  };

  const successfulPayment = message.successful_payment;
  if (!successfulPayment) {
    return false;
  }

  const payload = successfulPayment.invoice_payload;
  const plan = getPlanFromPayload(payload);
  if (!plan) {
    await ctx.reply("Payment received, but payload is invalid. Please contact support.");
    return true;
  }

  const userId = ctx.from?.id;
  if (!userId) {
    await ctx.reply("Payment received, but user identity is missing. Please contact support.");
    return true;
  }

  const result = await activatePremium(
    userId,
    plan,
    successfulPayment.telegram_payment_charge_id
  );

  const premiumUntil = formatDate(result.premiumUntil);
  const planName = plan.name;

  if (result.alreadyProcessed) {
    await ctx.reply(
      `Payment already processed.\n\n⭐ Plan: ${planName}\n⏳ Valid until: ${premiumUntil}`
    );
    return true;
  }

  await ctx.reply(
    `🎉 Premium Activated!\n\n⭐ Plan: ${planName}\n⏳ Valid until: ${premiumUntil}\n\nEnjoy premium features!`
  );

  return true;
}
