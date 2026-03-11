import { Context, Markup } from "telegraf";
import { ExtraTelegraf } from "..";
import { getUser, updateUser, User } from "../storage/db";

// Rate limiting for invoice creation
const invoiceCooldown = new Map<number, number>();
const COOLDOWN_MS = 30000; // 30 seconds
const COOLDOWN_CLEANUP_MS = 10 * 60 * 1000; // 10 minutes

// Maximum number of processed payment charge IDs to keep
const MAX_PROCESSED_IDS = 50;

// Cleanup stale invoice cooldowns to prevent memory leaks
function cleanupInvoiceCooldowns(): void {
  const now = Date.now();
  for (const [userId, timestamp] of invoiceCooldown.entries()) {
    if (now - timestamp > COOLDOWN_CLEANUP_MS) {
      invoiceCooldown.delete(userId);
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupInvoiceCooldowns, 5 * 60 * 1000);

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
    amount: 100
  },
  premium_monthly: {
    id: "premium_monthly",
    name: "Monthly Premium",
    days: 30,
    stars: 250,
    amount: 250
  },
  premium_yearly: {
    id: "premium_yearly",
    name: "Yearly Premium",
    days: 365,
    stars: 1000,
    amount: 1000
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

  // Check if already processed using atomic addToSet logic
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

  // Limit array size to prevent unbounded growth
  const trimmedIds = processed.slice(-(MAX_PROCESSED_IDS - 1));

  await updateUser(userId, {
    premium: true,
    premiumExpires: newExpiry,
    premiumExpiry: newExpiry,
    processedPaymentChargeIds: [...trimmedIds, paymentChargeId]
  });

  return {
    activated: true,
    premiumUntil: newExpiry,
    alreadyProcessed: false
  };
}

export function initStarsPaymentHandlers(bot: ExtraTelegraf): void {
  // Pre-checkout validation - verify payload and amount before payment
  bot.on("pre_checkout_query", async (ctx) => {
    const query = ctx.update.pre_checkout_query;
    const payload = query.invoice_payload;

    const plan = getPlanFromPayload(payload);

    if (!plan) {
      await ctx.answerPreCheckoutQuery(false, "Invalid plan selected.");
      return;
    }

    if (query.total_amount !== plan.amount) {
      await ctx.answerPreCheckoutQuery(false, "Invalid payment amount.");
      return;
    }

    await ctx.answerPreCheckoutQuery(true);
  });

  // Invoice creation with rate limiting
  bot.action(/premium_(weekly|monthly|yearly)/, async (ctx) => {
    await ctx.answerCbQuery();
    
    const userId = ctx.from?.id || 0;
    const lastInvoice = invoiceCooldown.get(userId);

    if (lastInvoice && Date.now() - lastInvoice < COOLDOWN_MS) {
      await ctx.reply("Please wait before creating another invoice.");
      return;
    }

    invoiceCooldown.set(userId, Date.now());

    const match = ctx.match as RegExpExecArray | undefined;
    const payload = match ? `premium_${match[1]}` : "";
    const plan = getPlanFromPayload(payload);

    if (!plan) {
      await ctx.reply("Invalid premium plan. Please try again.");
      return;
    }

    await createPremiumInvoice(ctx, plan);
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
      total_amount: number;
    };
  };

  const successfulPayment = message.successful_payment;
  if (!successfulPayment) {
    return false;
  }

  const payload = successfulPayment.invoice_payload;
  const plan = getPlanFromPayload(payload);
  
  // Validate payload
  if (!plan) {
    await ctx.reply("Payment received, but payload is invalid. Please contact support.");
    return true;
  }

  // Validate payment amount
  if (successfulPayment.total_amount !== plan.amount) {
    console.error(JSON.stringify({
      type: "PAYMENT_AMOUNT_MISMATCH",
      userId: ctx.from?.id,
      expected: plan.amount,
      received: successfulPayment.total_amount,
      payload: payload,
      chargeId: successfulPayment.telegram_payment_charge_id,
      timestamp: new Date().toISOString()
    }));
    await ctx.reply("Payment received, but amount mismatch. Please contact support.");
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

  // Structured logging for payment success
  console.log(JSON.stringify({
    type: result.alreadyProcessed ? "PAYMENT_DUPLICATE" : "PAYMENT_SUCCESS",
    userId: userId,
    chargeId: successfulPayment.telegram_payment_charge_id,
    payload: payload,
    amount: successfulPayment.total_amount,
    plan: planName,
    premiumUntil: result.premiumUntil,
    timestamp: new Date().toISOString()
  }));

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
