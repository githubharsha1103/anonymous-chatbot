/**
 * Unified Premium Service
 * 
 * This module provides centralized premium grant/revoke functionality
 * used by both admin panel and Telegram Stars payment flows.
 */

import { updateUser, getUser } from '../storage/db';
import { bot } from '../index';

/**
 * Grant premium access to a user
 * @param userId - The user's Telegram ID
 * @param days - Number of days for premium access (default: 30)
 */
export async function grantPremium(userId: number, days: number = 30): Promise<{ success: boolean; premiumExpires: number }> {
    const premiumExpires = Date.now() + (days * 24 * 60 * 60 * 1000);
    
    await updateUser(userId, {
        premium: true,
        premiumExpires: premiumExpires,
        premiumExpiry: premiumExpires
    });
    
    // Also update in-memory premium users set if bot instance available
    if (bot && typeof bot.addPremiumUser === 'function') {
        bot.addPremiumUser(userId);
    }
    
    return { success: true, premiumExpires };
}

/**
 * Grant lifetime premium access (no expiration)
 * @param userId - The user's Telegram ID
 */
export async function grantLifetimePremium(userId: number): Promise<{ success: boolean; premiumExpires: number }> {
    const premiumExpires = Number.MAX_SAFE_INTEGER;
    
    await updateUser(userId, {
        premium: true,
        premiumExpires: premiumExpires,
        premiumExpiry: premiumExpires
    });
    
    // Also update in-memory premium users set
    if (bot && typeof bot.addPremiumUser === 'function') {
        bot.addPremiumUser(userId);
    }
    
    return { success: true, premiumExpires };
}

/**
 * Revoke premium access from a user
 * @param userId - The user's Telegram ID
 */
export async function revokePremium(userId: number): Promise<{ success: boolean }> {
    await updateUser(userId, {
        premium: false,
        premiumExpires: 0,
        premiumExpiry: 0
    });
    
    // Also update in-memory premium users set
    if (bot && typeof bot.removePremiumUser === 'function') {
        bot.removePremiumUser(userId);
    }
    
    return { success: true };
}

/**
 * Extend premium for an existing premium user
 * @param userId - The user's Telegram ID
 * @param days - Number of days to add
 */
export async function extendPremium(userId: number, days: number): Promise<{ success: boolean; premiumExpires: number }> {
    const user = await getUser(userId);
    
    if (!user) {
        throw new Error(`User ${userId} not found`);
    }
    
    const currentExpiry = user.premiumExpires || user.premiumExpiry || 0;
    const now = Date.now();
    
    // If premium expired, start from now; otherwise extend from current expiry
    const base = currentExpiry > now ? currentExpiry : now;
    const premiumExpires = base + (days * 24 * 60 * 60 * 1000);
    
    await updateUser(userId, {
        premium: true,
        premiumExpires: premiumExpires,
        premiumExpiry: premiumExpires
    });
    
    // Ensure in-memory cache is updated
    if (bot && typeof bot.addPremiumUser === 'function') {
        bot.addPremiumUser(userId);
    }
    
    return { success: true, premiumExpires };
}

/**
 * Add a processed payment charge ID to prevent duplicate processing
 * @param userId - The user's Telegram ID
 * @param paymentChargeId - The payment charge ID
 */
export async function addProcessedPaymentChargeIdService(userId: number, paymentChargeId: string): Promise<boolean> {
    const user = await getUser(userId);
    if (!user) return false;
    
    const processed = user.processedPaymentChargeIds || [];
    if (processed.includes(paymentChargeId)) {
        return false; // Already processed
    }
    
    await updateUser(userId, {
        processedPaymentChargeIds: [...processed, paymentChargeId]
    });
    
    return true;
}
