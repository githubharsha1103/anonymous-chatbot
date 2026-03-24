import { Context, Markup } from "telegraf";
import { ExtraTelegraf } from "..";
import { getUser, updateUser, User, createPremiumPaymentOrder, addProcessedPaymentChargeId, getPremiumPaymentOrder, finalizePremiumPayment, updateOrderStatus } from "../storage/db";
import { ADMINS } from "./adminAuth";

// Rate limiting for invoice creation
const invoiceCooldown = new Map<number, number>();

// Cache to prevent duplicate admin notifications (30 second window)
const notifiedPaymentsCache = new Map<string, number>();
const NOTIFICATION_CACHE_TTL = 30000;
const COOLDOWN_MS = 30000; // 30 seconds
const COOLDOWN_CLEANUP_MS = 10 * 60 * 1000; // 10 minutes

// Maximum number of processed payment charge IDs to keep (exported for reference)
export const MAX_PROCESSED_CHARGE_IDS = 50;

// Analytics tracking - exported for monitoring
export const paymentAnalytics = {
  totalPurchases: 0,
  totalRevenueStars: 0,
  premiumUserCount: 0
};

// Increment purchase count
export function incrementPaymentAnalytics(amount: number): void {
  paymentAnalytics.totalPurchases++;
  paymentAnalytics.totalRevenueStars += amount;
}

// Get analytics snapshot
export function getPaymentAnalytics(): typeof paymentAnalytics {
  return { ...paymentAnalytics };
}

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

type PremiumPlanId = "premium_daily" | "premium_weekly" | "premium_monthly" | "premium_yearly";

type PremiumPlan = {
  id: PremiumPlanId;
  name: string;
  days: number;
  stars: number;
  amount: number;
};

const PREMIUM_PLANS: Record<PremiumPlanId, PremiumPlan> = {
  premium_daily: {
    id: "premium_daily",
    name: "Daily Premium",
    days: 1,
    stars: 1,
    amount: 1
  },
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
  // First check if it's an order-based payload
  const orderId = extractOrderIdFromPayload(payload);
  if (orderId) {
    // For order-based, return null - handled separately in payment handler
    return null;
  }

  // Legacy format: premium_weekly, premium_monthly, premium_yearly
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
  // Use >= to ensure users whose expiry is exactly now are still considered premium
  return !!user.premium && expiry >= Date.now();
}

export async function showPremiumPurchaseMenu(ctx: Context): Promise<void> {
  const text =
`⭐ Buy Premium

Premium Plans:
⭐ Daily Premium - 1 Star
⭐ Weekly Premium - 100 Stars
⭐ Monthly Premium - 250 Stars
⭐ Yearly Premium - 1000 Stars`;

  await ctx.reply(
    text,
    Markup.inlineKeyboard([
      [Markup.button.callback("⭐ Daily - 1 Star", "premium_daily")],
      [Markup.button.callback("⭐ Weekly - 100 Stars", "premium_weekly")],
      [Markup.button.callback("⭐ Monthly - 250 Stars", "premium_monthly")],
      [Markup.button.callback("⭐ Yearly - 1000 Stars", "premium_yearly")]
    ])
  );
}

async function createPremiumInvoice(ctx: Context, plan: PremiumPlan): Promise<boolean> {
  const userId = ctx.from?.id;
  if (!userId) return false;

  try {
    // Create order in database first - this is the secure approach
    const order = await createPremiumPaymentOrder(
      userId,
      plan.id,
      plan.days,
      plan.amount
    );

    // Use order ID as payload for security
    const payload = `order_${order.orderId}`;

    // Structured logging for invoice creation
    console.log(JSON.stringify({
      type: "INVOICE_CREATED",
      userId,
      orderId: order.orderId,
      plan: plan.id,
      amount: plan.amount,
      premiumDays: plan.days,
      timestamp: new Date().toISOString()
    }));

    await ctx.telegram.sendInvoice(userId, {
      title: "Premium Subscription",
      description: `Unlock premium features - ${plan.name}`,
      payload: payload,
      provider_token: "",
      currency: "XTR",
      prices: [{ label: `${plan.name}`, amount: plan.amount }]
    });

    return true;
  } catch (error) {
    // Structured logging for invoice creation failure
    console.log(JSON.stringify({
      type: "INVOICE_CREATION_FAILED",
      userId,
      plan: plan.id,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    }));
    console.error("[ERROR] - Failed to create premium invoice:", error);
    await ctx.reply("Failed to create invoice. Please try again.");
    return false;
  }
}

// Order expiry time in milliseconds (30 minutes)
const ORDER_EXPIRY_MS = 30 * 60 * 1000;

// Check if an order has expired
function isOrderExpired(order: { createdAt: number }): boolean {
  return Date.now() - order.createdAt > ORDER_EXPIRY_MS;
}

// Get order ID from payload (new format: order_<orderId> or legacy: premium_<plan>)
function extractOrderIdFromPayload(payload: string): string | null {
  if (payload.startsWith("order_")) {
    return payload.substring(6); // Remove "order_" prefix
  }
  return null; // Legacy format - no order ID
}

async function activatePremium(
  userId: number,
  plan: PremiumPlan,
  paymentChargeId: string
): Promise<{ activated: boolean; premiumUntil: number; alreadyProcessed: boolean }> {
  const user = await getUser(userId);
  const processed = user.processedPaymentChargeIds || [];

  // Check if already processed using atomic operation
  if (processed.includes(paymentChargeId)) {
    const existingExpiry = user.premiumExpires || user.premiumExpiry || Date.now();
    return {
      activated: true,
      premiumUntil: existingExpiry,
      alreadyProcessed: true
    };
  }

  // Use atomic MongoDB operation to add charge ID and prevent race conditions
  const result = await addProcessedPaymentChargeId(userId, paymentChargeId);
  
  if (result.alreadyExists) {
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
    premiumExpiry: newExpiry
  });

  // Update analytics
  incrementPaymentAnalytics(plan.amount);

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

    // Try order-based payment first
    const orderId = extractOrderIdFromPayload(payload);
    
    if (orderId) {
      // Order-based payment validation
      const order = await getPremiumPaymentOrder(orderId);
      
      if (!order) {
        // Structured logging for order not found
        console.log(JSON.stringify({
          type: "PRE_CHECKOUT_VALIDATION_FAILED",
          userId: query.from.id,
          orderId,
          reason: "Order not found",
          timestamp: new Date().toISOString()
        }));
        await ctx.answerPreCheckoutQuery(false, "Order not found.");
        return;
      }

      if (order.userId !== query.from.id) {
        // Structured logging for user mismatch
        console.log(JSON.stringify({
          type: "PRE_CHECKOUT_VALIDATION_FAILED",
          userId: query.from.id,
          orderId,
          orderUserId: order.userId,
          reason: "User mismatch",
          timestamp: new Date().toISOString()
        }));
        await ctx.answerPreCheckoutQuery(false, "Order user mismatch.");
        return;
      }

      // Check if order has expired
      if (isOrderExpired(order)) {
        // Mark order as expired
        await updateOrderStatus(orderId, "expired");
        // Structured logging for expired order
        console.log(JSON.stringify({
          type: "PRE_CHECKOUT_VALIDATION_FAILED",
          userId: query.from.id,
          orderId,
          reason: "Order expired",
          createdAt: new Date(order.createdAt).toISOString(),
          timestamp: new Date().toISOString()
        }));
        await ctx.answerPreCheckoutQuery(false, "Order has expired. Please create a new one.");
        return;
      }

      if (order.status !== "pending") {
        // Structured logging for order not pending
        console.log(JSON.stringify({
          type: "PRE_CHECKOUT_VALIDATION_FAILED",
          userId: query.from.id,
          orderId,
          orderStatus: order.status,
          reason: "Order not pending",
          timestamp: new Date().toISOString()
        }));
        await ctx.answerPreCheckoutQuery(false, "Order is not pending.");
        return;
      }

      if (order.starsAmount !== query.total_amount) {
        // Structured logging for amount mismatch
        console.log(JSON.stringify({
          type: "PRE_CHECKOUT_VALIDATION_FAILED",
          userId: query.from.id,
          orderId,
          expectedAmount: order.starsAmount,
          receivedAmount: query.total_amount,
          reason: "Amount mismatch",
          timestamp: new Date().toISOString()
        }));
        await ctx.answerPreCheckoutQuery(false, "Invalid payment amount.");
        return;
      }

      // Structured logging for successful pre-checkout validation
      console.log(JSON.stringify({
        type: "PRE_CHECKOUT_VALIDATION_SUCCESS",
        userId: query.from.id,
        orderId,
        amount: query.total_amount,
        plan: order.planId,
        timestamp: new Date().toISOString()
      }));

      await ctx.answerPreCheckoutQuery(true);
      return;
    }

    // Legacy payment validation (direct plan payload)
    const plan = getPlanFromPayload(payload);

    if (!plan) {
      // Structured logging for invalid plan
      console.log(JSON.stringify({
        type: "PRE_CHECKOUT_VALIDATION_FAILED",
        userId: query.from.id,
        payload,
        reason: "Invalid plan",
        timestamp: new Date().toISOString()
      }));
      await ctx.answerPreCheckoutQuery(false, "Invalid plan selected.");
      return;
    }

    if (query.total_amount !== plan.amount) {
      // Structured logging for legacy amount mismatch
      console.log(JSON.stringify({
        type: "PRE_CHECKOUT_VALIDATION_FAILED",
        userId: query.from.id,
        payload,
        expectedAmount: plan.amount,
        receivedAmount: query.total_amount,
        reason: "Amount mismatch",
        timestamp: new Date().toISOString()
      }));
      await ctx.answerPreCheckoutQuery(false, "Invalid payment amount.");
      return;
    }

    await ctx.answerPreCheckoutQuery(true);
  });

  // Invoice creation with rate limiting
  bot.action(/premium_(daily|weekly|monthly|yearly)/, async (ctx) => {
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
  const userId = ctx.from?.id;
  
  if (!userId) {
    await ctx.reply("Payment received, but user identity is missing. Please contact support.");
    return true;
  }

  // Try order-based payment first
  const orderId = extractOrderIdFromPayload(payload);
  
  if (orderId) {
    // Order-based payment flow
    const order = await getPremiumPaymentOrder(orderId);
    
    // Validate order exists
    if (!order) {
      console.log(JSON.stringify({
        type: "PAYMENT_FAILURE",
        userId,
        orderId,
        chargeId: successfulPayment.telegram_payment_charge_id,
        reason: "Order not found",
        timestamp: new Date().toISOString()
      }));
      await ctx.reply("Payment received, but order not found. Please contact support.");
      return true;
    }

    // Validate user owns the order
    if (order.userId !== userId) {
      console.log(JSON.stringify({
        type: "PAYMENT_FAILURE",
        userId,
        orderId,
        orderUserId: order.userId,
        chargeId: successfulPayment.telegram_payment_charge_id,
        reason: "User mismatch",
        timestamp: new Date().toISOString()
      }));
      await ctx.reply("Payment received, but user mismatch. Please contact support.");
      return true;
    }

    // Validate order is pending
    if (order.status !== "pending") {
      console.log(JSON.stringify({
        type: "PAYMENT_FAILURE",
        userId,
        orderId,
        orderStatus: order.status,
        chargeId: successfulPayment.telegram_payment_charge_id,
        reason: "Order not pending",
        timestamp: new Date().toISOString()
      }));
      await ctx.reply("Payment already processed or invalid. Please contact support.");
      return true;
    }

    // Validate amount matches
    if (order.starsAmount !== successfulPayment.total_amount) {
      console.log(JSON.stringify({
        type: "PAYMENT_FAILURE",
        userId,
        orderId,
        expectedAmount: order.starsAmount,
        receivedAmount: successfulPayment.total_amount,
        chargeId: successfulPayment.telegram_payment_charge_id,
        reason: "Amount mismatch",
        timestamp: new Date().toISOString()
      }));
      await ctx.reply("Payment received, but amount mismatch. Please contact support.");
      return true;
    }

    // Use finalizePremiumPayment from db.ts to process the order atomically
    const result = await finalizePremiumPayment(
      orderId,
      successfulPayment.telegram_payment_charge_id,
      undefined
    );

    if (!result.success) {
      console.log(JSON.stringify({
        type: "PAYMENT_FAILURE",
        userId,
        orderId,
        chargeId: successfulPayment.telegram_payment_charge_id,
        reason: "Payment processing failed",
        message: result.message,
        timestamp: new Date().toISOString()
      }));
      await ctx.reply("Payment processing failed. Please contact support.");
      return true;
    }

    if (result.alreadyProcessed) {
      console.log(JSON.stringify({
        type: "PAYMENT_DUPLICATE",
        userId,
        orderId,
        chargeId: successfulPayment.telegram_payment_charge_id,
        premiumUntil: result.premiumUntil,
        timestamp: new Date().toISOString()
      }));
      await ctx.reply(
        `Payment already processed.\n\n⏳ Valid until: ${formatDate(result.premiumUntil || Date.now())}`
      );
      return true;
    }

    // Update analytics
    incrementPaymentAnalytics(order.starsAmount);

    // Success - send confirmation
    await ctx.reply(
      `🎉 Premium Activated!\n\n⭐ Plan: ${order.premiumDays} days\n⏳ Valid until: ${formatDate(result.premiumUntil || Date.now())}\n\nEnjoy premium features!`
    );

    // Structured logging
    console.log(JSON.stringify({
      type: "PAYMENT_SUCCESS",
      userId,
      chargeId: successfulPayment.telegram_payment_charge_id,
      orderId,
      plan: order.planId,
      amount: order.starsAmount,
      premiumDays: order.premiumDays,
      timestamp: new Date().toISOString()
    }));

    return true;
  }

  // Legacy payment flow (direct plan payload)
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
      userId,
      expected: plan.amount,
      received: successfulPayment.total_amount,
      payload,
      chargeId: successfulPayment.telegram_payment_charge_id,
      timestamp: new Date().toISOString()
    }));
    await ctx.reply("Payment received, but amount mismatch. Please contact support.");
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
  
  // Notify admins about the new premium purchase (with duplicate prevention)
  const notificationKey = `${userId}_${successfulPayment.telegram_payment_charge_id}`;
  const lastNotified = notifiedPaymentsCache.get(notificationKey);
  const now = Date.now();
  
  // Skip if we already notified within the TTL window (prevents race condition duplicates)
  if (lastNotified && now - lastNotified < NOTIFICATION_CACHE_TTL) {
    console.log(`[PREMIUM_NOTIFY] Skipping duplicate notification for ${notificationKey}`);
    return true;
  }
  
  try {
    const user = await getUser(userId);
    const userName = user?.name || "Unknown";
    const isPremium = user?.premium === true;
    const premiumStatus = isPremium ? "✅ Activated" : "⏳ Pending";
    const adminIds = ADMINS.map(id => parseInt(id));
    
    for (const adminId of adminIds) {
      try {
        await ctx.telegram.sendMessage(
          adminId,
          `💎 *New Premium Purchase*\n\n` +
          `👤 User: *${userName}* (\`${userId}\`)\n` +
          `⭐ Plan: ${planName}\n` +
          `💰 Amount: ${successfulPayment.total_amount} Stars\n` +
          `👑 Status: ${premiumStatus}\n` +
          `⏳ Valid until: ${premiumUntil}\n` +
          `📅 Date: ${new Date().toLocaleString()}`,
          { parse_mode: "Markdown" }
        );
      } catch {
        // Admin might not exist, ignore
      }
    }
    
    // Cache the notification to prevent duplicates
    notifiedPaymentsCache.set(notificationKey, now);
    
    // Clean old entries periodically
    if (notifiedPaymentsCache.size > 100) {
      for (const [key, timestamp] of notifiedPaymentsCache) {
        if (now - timestamp > NOTIFICATION_CACHE_TTL) {
          notifiedPaymentsCache.delete(key);
        }
      }
    }
  } catch (error) {
    console.error("[PREMIUM_NOTIFY] Failed to notify admins:", error);
  }

  return true;
}
