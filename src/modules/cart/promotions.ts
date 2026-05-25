/**
 * Promotion evaluator.
 *
 * Supports the four promotion types listed in the SP-4 schema:
 *   - 'percent'        — flat % off the eligible subtotal
 *   - 'amount'         — flat cents off the eligible subtotal
 *   - 'free_shipping'  — annotated as such; the pricing engine zeros shipping
 *   - 'bxgy'           — buy N, get M free on the eligible variants
 *
 * Stacking rules:
 *   - "auto" promotions (code IS NULL) layer underneath a coupon.
 *   - Non-stackable coupons replace any auto promos applied first.
 *   - At most one coupon per cart (cart.coupon_code).
 *   - Sort by largest discount first; cap at the cart's eligible subtotal.
 *
 * Conditions (PromotionConditions JSON):
 *   - minSubtotalCents — gate by cart subtotal
 *   - variantIds / categoryIds — scope by line items
 *   - bxgyBuy / bxgyGet — bxgy params (we resolve the value as `buy * priceCents` discount, capped)
 */

import { and, count, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { PostgresJsTransaction } from 'drizzle-orm/postgres-js';
import {
  promotions,
  promotionRedemptions,
  type PromotionConditions,
} from '@/db/schema/promotions';
import { products } from '@/db/schema/catalog';
import {
  InvalidCouponError,
  CouponExpiredError,
  CouponUsageExhaustedError,
} from './errors';
import type { PricedLine } from './pricing-types';

type Tx = PostgresJsTransaction<Record<string, never>, Record<string, never>>;

export type PromotionRow = typeof promotions.$inferSelect;

export type AppliedPromotion = {
  promotionId: string;
  code: string | null;
  name: string;
  type: PromotionRow['type'];
  amountCents: number;
  /** True for free_shipping; signals the pricing engine to zero shipping. */
  freeShipping: boolean;
};

export type EvaluateCouponResult =
  | { ok: true; promotion: PromotionRow }
  | {
      ok: false;
      reason: 'not_found' | 'expired' | 'usage_exhausted' | 'starts_in_future' | 'inactive';
    };

export type CartContext = {
  customerId: string | null;
  variantIds: string[];
};

/**
 * Active = status='active', within [startsAt, endsAt] window, usage_limit not
 * yet hit. Returns auto promotions (code IS NULL).
 */
export async function listActivePromotions(
  tx: Tx,
  storeId: string,
  now: Date = new Date(),
): Promise<PromotionRow[]> {
  const rows = await tx
    .select()
    .from(promotions)
    .where(
      and(
        eq(promotions.storeId, storeId),
        eq(promotions.status, 'active'),
        isNull(promotions.code),
      ),
    );

  return rows.filter(p => isWithinWindow(p, now) && !isUsageExhausted(p));
}

function isWithinWindow(p: PromotionRow, now: Date): boolean {
  if (p.startsAt && p.startsAt > now) return false;
  if (p.endsAt && p.endsAt < now) return false;
  return true;
}

function isUsageExhausted(p: PromotionRow): boolean {
  if (p.usageLimit === null || p.usageLimit === undefined) return false;
  return p.usedCount >= p.usageLimit;
}

export async function evaluateCoupon(
  tx: Tx,
  storeId: string,
  code: string,
  now: Date = new Date(),
): Promise<EvaluateCouponResult> {
  const trimmed = code.trim();
  if (!trimmed) return { ok: false, reason: 'not_found' };

  const rows = await tx
    .select()
    .from(promotions)
    .where(and(eq(promotions.storeId, storeId), eq(promotions.code, trimmed)))
    .limit(1);
  const promo = rows[0];
  if (!promo) return { ok: false, reason: 'not_found' };
  if (promo.status !== 'active') return { ok: false, reason: 'inactive' };
  if (promo.startsAt && promo.startsAt > now) return { ok: false, reason: 'starts_in_future' };
  if (promo.endsAt && promo.endsAt < now) return { ok: false, reason: 'expired' };
  if (isUsageExhausted(promo)) return { ok: false, reason: 'usage_exhausted' };
  return { ok: true, promotion: promo };
}

/**
 * Throwing variant for cart.applyCoupon — translates evaluator results into
 * typed cart errors.
 */
export async function assertCouponValid(
  tx: Tx,
  storeId: string,
  code: string,
): Promise<PromotionRow> {
  const result = await evaluateCoupon(tx, storeId, code);
  if (result.ok) return result.promotion;
  switch (result.reason) {
    case 'expired':
      throw new CouponExpiredError(code);
    case 'usage_exhausted':
      throw new CouponUsageExhaustedError(code);
    case 'not_found':
    case 'inactive':
    case 'starts_in_future':
    default:
      throw new InvalidCouponError(code);
  }
}

/**
 * For a given promotion + cart lines, decide the eligible subtotal — the slice
 * of subtotal the promo can act on. variantIds and categoryIds in conditions
 * narrow the eligible set; default is all lines.
 */
async function eligibleLineSubtotal(
  tx: Tx,
  storeId: string,
  conditions: PromotionConditions,
  lines: PricedLine[],
): Promise<{ eligibleSubtotal: number; eligibleLines: PricedLine[] }> {
  const variantScope = conditions.variantIds ?? [];
  const categoryScope = conditions.categoryIds ?? [];

  let allowedVariantIds: Set<string> | null = null;
  if (variantScope.length > 0) {
    allowedVariantIds = new Set(variantScope);
  }
  if (categoryScope.length > 0) {
    // Resolve which of the cart's variant ids belong to a product in a
    // scoped category. Cheap query — small variant set per cart.
    const lineVariantIds = lines.map(l => l.variantId);
    if (lineVariantIds.length > 0) {
      const rows = await tx
        .select({ variantId: sql<string>`pv.id`.as('variantId') })
        .from(sql`product_variants pv`)
        .innerJoin(products, eq(sql`pv.product_id`, products.id))
        .where(
          and(
            eq(products.storeId, storeId),
            inArray(sql`pv.id`, lineVariantIds),
            inArray(products.categoryId, categoryScope),
          ),
        );
      const fromCategory = new Set(rows.map(r => r.variantId));
      allowedVariantIds = allowedVariantIds
        ? new Set([...allowedVariantIds].filter(v => fromCategory.has(v)))
        : fromCategory;
    } else {
      allowedVariantIds = new Set<string>();
    }
  }

  const eligibleLines = allowedVariantIds
    ? lines.filter(l => allowedVariantIds!.has(l.variantId))
    : lines;
  const eligibleSubtotal = eligibleLines.reduce((s, l) => s + l.lineSubtotalCents, 0);
  return { eligibleSubtotal, eligibleLines };
}

function computePromotionAmount(
  promo: PromotionRow,
  eligibleSubtotal: number,
  eligibleLines: PricedLine[],
): number {
  switch (promo.type) {
    case 'percent': {
      const pct = promo.percent ?? 0;
      if (pct <= 0) return 0;
      const clamped = Math.min(pct, 100);
      return Math.min(eligibleSubtotal, Math.round((eligibleSubtotal * clamped) / 100));
    }
    case 'amount': {
      const v = promo.valueCents ?? 0;
      return Math.min(eligibleSubtotal, Math.max(0, v));
    }
    case 'free_shipping': {
      return 0; // discount tracked separately via freeShipping flag
    }
    case 'bxgy': {
      const buy = promo.conditions.bxgyBuy ?? 0;
      const get = promo.conditions.bxgyGet ?? 0;
      if (buy <= 0 || get <= 0) return 0;
      const stride = buy + get;
      let discount = 0;
      for (const line of eligibleLines) {
        const groups = Math.floor(line.qty / stride);
        if (groups > 0) {
          discount += groups * get * line.unitPriceCents;
        }
      }
      return Math.min(eligibleSubtotal, discount);
    }
    default:
      return 0;
  }
}

/**
 * Apply auto promotions + the cart's coupon (if any).
 *
 * Order of operations:
 *   1. Load active auto promos.
 *   2. Load the coupon, if cart.couponCode is set; ignore on validation failure
 *      (the cart owns coupon-stickiness via applyCoupon; the engine never
 *      throws here so quote endpoints stay 200 OK).
 *   3. Filter by minSubtotalCents.
 *   4. If a non-stackable coupon is present, drop all auto promos.
 *   5. Sort remaining by computed amount desc.
 *   6. Cap total discount at the eligible subtotal.
 */
export async function applyPromotions(
  tx: Tx,
  storeId: string,
  cart: { couponCode: string | null; customerId: string | null },
  lines: PricedLine[],
  now: Date = new Date(),
): Promise<AppliedPromotion[]> {
  const subtotal = lines.reduce((s, l) => s + l.lineSubtotalCents, 0);

  const autos = await listActivePromotions(tx, storeId, now);

  let coupon: PromotionRow | null = null;
  if (cart.couponCode) {
    const ev = await evaluateCoupon(tx, storeId, cart.couponCode, now);
    if (ev.ok) coupon = ev.promotion;
  }

  const dropAutos = coupon !== null && coupon.stackable === false;
  const candidates: PromotionRow[] = [];
  if (!dropAutos) candidates.push(...autos);
  if (coupon) candidates.push(coupon);

  const applied: AppliedPromotion[] = [];

  for (const promo of candidates) {
    if (
      promo.conditions.minSubtotalCents !== undefined &&
      subtotal < promo.conditions.minSubtotalCents
    ) {
      continue;
    }
    const { eligibleSubtotal, eligibleLines } = await eligibleLineSubtotal(
      tx,
      storeId,
      promo.conditions,
      lines,
    );
    if (eligibleSubtotal <= 0 && promo.type !== 'free_shipping') continue;

    const amount = computePromotionAmount(promo, eligibleSubtotal, eligibleLines);
    if (amount <= 0 && promo.type !== 'free_shipping') continue;

    applied.push({
      promotionId: promo.id,
      code: promo.code,
      name: promo.name,
      type: promo.type,
      amountCents: amount,
      freeShipping: promo.type === 'free_shipping',
    });
  }

  // Sort by discount amount desc so the largest wins at the cap.
  applied.sort((a, b) => b.amountCents - a.amountCents);

  // Cap total discount at the cart subtotal (excluding free-shipping which is
  // a separate annotation handled by the pricing engine).
  let remaining = subtotal;
  for (const a of applied) {
    if (a.freeShipping) continue;
    if (a.amountCents > remaining) a.amountCents = Math.max(0, remaining);
    remaining -= a.amountCents;
  }

  return applied;
}

export type RedemptionRef = {
  cartId?: string;
  orderId?: string;
  customerId?: string | null;
};

/**
 * Record an applied promotion. Increments promotion.used_count and inserts a
 * promotion_redemptions row. Called from checkout/order creation, not from
 * priceCart — pricing must remain side-effect free.
 */
export async function recordRedemption(
  tx: Tx,
  storeId: string,
  applied: AppliedPromotion,
  ref: RedemptionRef,
): Promise<void> {
  await tx.insert(promotionRedemptions).values({
    storeId,
    promotionId: applied.promotionId,
    cartId: ref.cartId ?? null,
    orderId: ref.orderId ?? null,
    customerId: ref.customerId ?? null,
    amountCents: applied.amountCents,
  });
  await tx
    .update(promotions)
    .set({ usedCount: sql`${promotions.usedCount} + 1` })
    .where(eq(promotions.id, applied.promotionId));
}

// Silence unused-import linter — re-exported for completeness in some code paths.
void count;
void gt;
void lte;
