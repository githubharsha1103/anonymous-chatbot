# Premium System Bug Analysis Report

## Executive Summary

Manually granted premium users appear in the admin panel's "Premium Users" list but **do not receive premium functionality** because the admin grant flow is missing critical fields required by the premium verification system.

---

## SECTION 1: Where the Bug Occurs

**Exact Location:** [`src/Commands/adminaccess.ts:2195`](src/Commands/adminaccess.ts:2195)

```typescript
// Grant premium access
bot.action(/ADMIN_GRANT_PREMIUM_(\d+)/, async (ctx) => {
    // ... validation code ...
    await safeAnswerCbQuery(ctx, "Premium granted ✅");
    const userId = parseInt(ctx.match[1]);
    await updateUser(userId, { premium: true });  // ← BUG HERE
    await showUserDetails(ctx, userId);
});
```

---

## SECTION 2: Why the Bug Occurs

### Root Cause
The admin panel only sets `premium: true` but does **NOT** set `premiumExpires` (expiration timestamp). The `isPremium()` function requires BOTH conditions to be true.

### Premium Verification Logic ([`src/Utils/starsPayments.ts:98-101`](src/Utils/starsPayments.ts:98-101))

```typescript
export function isPremium(user: Pick<User, "premium" | "premiumExpires" | "premiumExpiry">): boolean {
  const expiry = user.premiumExpires || user.premiumExpiry || 0;
  return !!user.premium && expiry > Date.now();  // ← REQUIRES EXPIRY > NOW
}
```

When admin sets only `premium: true`:
- `user.premium` = `true` ✅
- `user.premiumExpires` = `undefined` → defaults to `0`
- `0 > Date.now()` = `false` ❌
- **Result:** `true && false` = **false**

---

## SECTION 3: The Broken Logic - Side-by-Side Comparison

### A) Manual Admin Grant (BROKEN)

| Field | Set By Admin | Expected |
|-------|-------------|----------|
| `premium` | `true` ✅ | `true` |
| `premiumExpires` | ❌ NOT SET | Future timestamp |
| `premiumExpiry` | ❌ NOT SET | Future timestamp |

**Code:** [`src/Commands/adminaccess.ts:2195`](src/Commands/adminaccess.ts:2195)
```typescript
await updateUser(userId, { premium: true });  // Missing premiumExpires!
```

### B) Telegram Stars Payment (WORKS)

| Field | Set By Stars | Expected |
|-------|-------------|----------|
| `premium` | `true` ✅ | `true` |
| `premiumExpires` | `newExpiry` ✅ | Future timestamp |
| `premiumExpiry` | `newExpiry` ✅ | Future timestamp |

**Code:** [`src/Utils/starsPayments.ts:226-230`](src/Utils/starsPayments.ts:226-230)
```typescript
await updateUser(userId, {
  premium: true,
  premiumExpires: newExpiry,  // ✓ Sets expiry
  premiumExpiry: newExpiry    // ✓ Sets expiry (redundant field)
});
```

---

## SECTION 4: Corrected Code Snippet

### Fix 1: Update adminaccess.ts (Grant Premium)

**File:** [`src/Commands/adminaccess.ts`](src/Commands/adminaccess.ts)

```typescript
// Grant premium access
bot.action(/ADMIN_GRANT_PREMIUM_(\d+)/, async (ctx) => {
    // Validate admin permissions
    if (!validateAdmin(ctx)) {
        await unauthorizedResponse(ctx, "Unauthorized");
        return;
    }
    await safeAnswerCbQuery(ctx, "Premium granted ✅");
    const userId = parseInt(ctx.match[1]);
    
    // FIX: Set premium with expiration (default 30 days)
    const defaultPremiumDays = 30;
    const premiumExpires = Date.now() + (defaultPremiumDays * 24 * 60 * 60 * 1000);
    
    await updateUser(userId, { 
        premium: true,
        premiumExpires: premiumExpires,
        premiumExpiry: premiumExpires
    });
    
    await showUserDetails(ctx, userId);
});
```

### Fix 2: Update adminaccess.ts (Revoke Premium)

**File:** [`src/Commands/adminaccess.ts`](src/Commands/adminaccess.ts)

```typescript
// Revoke premium access
bot.action(/ADMIN_REVOKE_PREMIUM_(\d+)/, async (ctx) => {
    // Validate admin permissions
    if (!validateAdmin(ctx)) {
        await unauthorizedResponse(ctx, "Unauthorized");
        return;
    }
    await safeAnswerCbQuery(ctx, "Premium revoked ❌");
    const userId = parseInt(ctx.match[1]);
    
    // FIX: Clear premium status AND expiration
    await updateUser(userId, { 
        premium: false,
        premiumExpires: 0,
        premiumExpiry: 0
    });
    
    await showUserDetails(ctx, userId);
});
```

---

## SECTION 5: Additional Issues & Improvements

### Issue 1: In-Memory premiumUsers Set Not Synced

**Problem:** The bot maintains an in-memory `premiumUsers: Set<number>` at [`src/index.ts:103`](src/index.ts:103) that is:
- ✅ Populated when users join premium queue (line 408)
- ❌ NOT populated when admin grants premium manually
- ❌ NOT loaded from database at bot startup
- ❌ No sync mechanism exists

**Impact:** While this doesn't break the main `isPremium()` check (which reads from DB), it affects premium queue operations at [`src/index.ts:562`](src/index.ts:562).

**Recommended Fix:** Add a unified `grantPremium` function:

```typescript
// In src/Utils/premiumUtils.ts (new file)
export async function grantPremium(userId: number, days: number): Promise<void> {
    const expires = Date.now() + (days * 24 * 60 * 60 * 1000);
    
    // Update database
    await updateUser(userId, {
        premium: true,
        premiumExpires: expires,
        premiumExpiry: expires
    });
    
    // Update in-memory cache (if user is in queue)
    bot.addPremiumUser(userId);
}

export async function revokePremium(userId: number): Promise<void> {
    await updateUser(userId, {
        premium: false,
        premiumExpires: 0,
        premiumExpiry: 0
    });
    
    // Update in-memory cache
    bot.removePremiumUser(userId);
}
```

### Issue 2: Missing Premium Loading at Startup

**Problem:** Premium users are not loaded into the in-memory `premiumUsers` Set when the bot starts.

**Recommended Fix:** Add startup loading in [`src/index.ts`](src/index.ts):

```typescript
// After bot initialization, load premium users
async function loadPremiumUsers(): Promise<void> {
    const { getPremiumUsers } = await import('./storage/db');
    const premiumUsers = await getPremiumUsers(); // Need to create this function
    
    for (const user of premiumUsers) {
        if (user.premium && (user.premiumExpires || 0) > Date.now()) {
            bot.addPremiumUser(user.id);
        }
    }
    console.log(`[INFO] Loaded ${bot.premiumUsers.size} premium users`);
}
```

### Issue 3: Inconsistent Field Names

**Problem:** Both `premiumExpires` and `premiumExpiry` are used interchangeably:
- [`src/Utils/starsPayments.ts:98-101`](src/Utils/starsPayments.ts:98-101) checks both
- [`src/storage/db.ts:2261`](src/storage/db.ts:2261) sorts by both
- Creates confusion and potential bugs

**Recommended Fix:** Standardize on single field `premiumExpires`.

---

## Proposed Unified Premium System

### New Function: grantPremium()

```typescript
// src/Utils/premium.ts
import { updateUser, getUser } from '../storage/db';
import { bot } from '../index';

export interface PremiumGrantOptions {
    userId: number;
    days: number;  // Duration in days (0 = indefinite/lifetime)
    source: 'admin' | 'stars_payment' | 'referral';
    paymentChargeId?: string;  // For stars payments
}

/**
 * Unified premium grant function - use for ALL premium activations
 * @param options - Premium grant configuration
 */
export async function grantPremium(options: PremiumGrantOptions): Promise<{ success: boolean; premiumUntil: number }> {
    const { userId, days, source, paymentChargeId } = options;
    
    const user = await getUser(userId);
    const now = Date.now();
    
    // Calculate new expiry time
    let newExpiry: number;
    if (days === 0) {
        // Lifetime premium (no expiry)
        newExpiry = Number.MAX_SAFE_INTEGER;
    } else {
        const extensionMs = days * 24 * 60 * 60 * 1000;
        const currentExpiry = user.premiumExpires || user.premiumExpiry || 0;
        // Extend from current expiry if still valid, otherwise from now
        const base = currentExpiry > now ? currentExpiry : now;
        newExpiry = base + extensionMs;
    }
    
    // Build update object
    const updateData: any = {
        premium: true,
        premiumExpires: newExpiry,
        premiumExpiry: newExpiry  // Keep both for backward compatibility
    };
    
    // Add payment tracking for stars payments
    if (source === 'stars_payment' && paymentChargeId) {
        const processed = user.processedPaymentChargeIds || [];
        if (!processed.includes(paymentChargeId)) {
            updateData.processedPaymentChargeIds = [...processed, paymentChargeId];
        }
    }
    
    // Persist to database
    await updateUser(userId, updateData);
    
    // Update in-memory cache
    bot.addPremiumUser(userId);
    
    return { success: true, premiumUntil: newExpiry };
}

/**
 * Unified premium revoke function - use for ALL premium revocations
 */
export async function revokePremium(userId: number): Promise<void> {
    await updateUser(userId, {
        premium: false,
        premiumExpires: 0,
        premiumExpiry: 0
    });
    
    // Update in-memory cache
    bot.removePremiumUser(userId);
}
```

### Usage Examples

```typescript
// Admin grants 30 days premium
await grantPremium({ userId: 123456, days: 30, source: 'admin' });

// Admin grants lifetime premium
await grantPremium({ userId: 123456, days: 0, source: 'admin' });

// Stars payment activation (existing code path)
await grantPremium({ 
    userId: 123456, 
    days: plan.days, 
    source: 'stars_payment',
    paymentChargeId: 'charge_xxx'
});
```

---

## Summary

| Issue | Location | Fix |
|-------|----------|-----|
| Missing `premiumExpires` on admin grant | [`adminaccess.ts:2195`](src/Commands/adminaccess.ts:2195) | Add `premiumExpires` timestamp |
| Missing `premiumExpires` on admin revoke | [`adminaccess.ts:2208`](src/Commands/adminaccess.ts:2208) | Clear `premiumExpires` to 0 |
| In-memory cache not updated | [`adminaccess.ts:2195`](src/Commands/adminaccess.ts:2195) | Call `bot.addPremiumUser()` |
| No startup premium loading | [`index.ts`](src/index.ts) | Add `loadPremiumUsers()` function |
| No unified grant function | System-wide | Create `grantPremium()` utility |

The core fix is simple: **always set `premiumExpires` when granting premium**. This aligns the admin flow with the Telegram Stars payment flow.
