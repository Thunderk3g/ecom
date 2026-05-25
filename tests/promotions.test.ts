/**
 * Promotion engine — percent / amount / free_shipping / bxgy, plus the
 * stackable vs non-stackable interaction between auto-promos and coupons.
 *
 * Verifies the AppliedPromotion shape that pricing's promoter returns, and
 * the discount math each type computes. Free shipping is asserted via the
 * `freeShipping: true` flag (pricing zeros the shipping line) — we set up a
 * shipping zone so the assertion has something concrete to compare against.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate } from './_setup/db';
import { appClient, migratorClient } from '@/db/client';
import { addItem, applyCoupon, createCart } from '@/modules/cart/cart';
import { priceCart } from '@/modules/cart/pricing';
import { invalidateSiteConfigCache } from '@/modules/config/loader';
import {
  SAMPLE_ADDRESS_IN_MH,
  createLocationFixture,
  createStore,
  createVariantPriced,
  seedOnHand,
  seedPromotion,
  seedShippingZone,
} from './_setup/cart-fixtures';

describe('promotions engine', () => {
  beforeAll(async () => {
    await resetAndMigrate();
  });

  afterAll(async () => {
    await appClient.end();
    await migratorClient.end();
  });

  async function buildStoreCart(slug: string, opts: { priceCents: number; qty: number }) {
    const store = await createStore(slug);
    const variant = await createVariantPriced(store.id, {
      sku: `${slug}-v`,
      productSlug: `${slug}-prod`,
      productName: `${slug} prod`,
      priceCents: opts.priceCents,
    });
    const loc = await createLocationFixture(store.id, { code: `${slug}-wh` });
    await seedOnHand(store.id, variant.variantId, loc.id, 100);
    const cart = await createCart(store.id, { sessionId: `${slug}-sess` });
    await addItem(store.id, cart.id, { variantId: variant.variantId, qty: opts.qty });
    await invalidateSiteConfigCache(store.id);
    return { storeId: store.id, cartId: cart.id, variantId: variant.variantId };
  }

  it('percent: 10% of 20000 subtotal = 2000 discount', async () => {
    const { storeId, cartId } = await buildStoreCart('promo-pct', {
      priceCents: 10000,
      qty: 2,
    });
    await seedPromotion(storeId, {
      code: 'PCT10',
      type: 'percent',
      percent: 10,
      status: 'active',
    });
    await applyCoupon(storeId, cartId, 'PCT10');
    const totals = await priceCart(storeId, cartId);
    expect(totals.discountCents).toBe(2000);
    expect(totals.appliedPromotions[0]!.amountCents).toBe(2000);
    expect(totals.appliedPromotions[0]!.type).toBe('percent');
  });

  it('amount: fixed 1500 cents discount', async () => {
    const { storeId, cartId } = await buildStoreCart('promo-amt', {
      priceCents: 10000,
      qty: 2,
    });
    await seedPromotion(storeId, {
      code: 'AMT1500',
      type: 'amount',
      valueCents: 1500,
      status: 'active',
    });
    await applyCoupon(storeId, cartId, 'AMT1500');
    const totals = await priceCart(storeId, cartId);
    expect(totals.discountCents).toBe(1500);
    expect(totals.appliedPromotions[0]!.amountCents).toBe(1500);
    expect(totals.appliedPromotions[0]!.type).toBe('amount');
  });

  it('free_shipping: shipping zeroes out, monetary discount stays 0', async () => {
    const { storeId, cartId } = await buildStoreCart('promo-ship', {
      priceCents: 5000,
      qty: 1,
    });
    await seedShippingZone(storeId, {
      code: 'india',
      regions: [{ country: 'IN' }],
      rates: [{ code: 'standard', label: 'Standard', rateCents: 9900 }],
    });
    await seedPromotion(storeId, {
      code: 'FREESHIP',
      type: 'free_shipping',
      status: 'active',
    });
    await applyCoupon(storeId, cartId, 'FREESHIP');
    const totals = await priceCart(storeId, cartId, {
      shippingAddress: SAMPLE_ADDRESS_IN_MH,
    });
    expect(totals.shippingCents).toBe(0);
    expect(totals.discountCents).toBe(0); // free_shipping is a flag, not a discount line
    const fs = totals.appliedPromotions.find(p => p.type === 'free_shipping');
    expect(fs?.freeShipping).toBe(true);
  });

  it('bxgy: buy 2 get 1 free against qty=3 → discount = 1 × unitPrice', async () => {
    // Stride = buy + get = 2 + 1 = 3. qty=3 means exactly one group: 1 free.
    const { storeId, cartId } = await buildStoreCart('promo-bxgy', {
      priceCents: 4000,
      qty: 3,
    });
    await seedPromotion(storeId, {
      code: 'BXGY',
      type: 'bxgy',
      status: 'active',
      conditions: { bxgyBuy: 2, bxgyGet: 1 },
    });
    await applyCoupon(storeId, cartId, 'BXGY');
    const totals = await priceCart(storeId, cartId);
    // 1 free × 4000 unit = 4000 discount
    expect(totals.discountCents).toBe(4000);
    expect(totals.appliedPromotions[0]!.type).toBe('bxgy');
    expect(totals.appliedPromotions[0]!.amountCents).toBe(4000);
  });

  it('non-stackable coupon drops auto-promos; stackable coupon coexists', async () => {
    const { storeId, cartId } = await buildStoreCart('promo-stack', {
      priceCents: 10000,
      qty: 1,
    });
    // Auto-promo (no code, status=active).
    await seedPromotion(storeId, {
      name: 'Auto 5%',
      type: 'percent',
      percent: 5,
      status: 'active',
      code: null,
    });
    // Non-stackable coupon.
    await seedPromotion(storeId, {
      code: 'BIG20',
      type: 'percent',
      percent: 20,
      status: 'active',
      stackable: false,
    });
    await applyCoupon(storeId, cartId, 'BIG20');
    const totals1 = await priceCart(storeId, cartId);
    // Only the coupon applies (auto dropped). 20% of 10000 = 2000.
    expect(totals1.appliedPromotions).toHaveLength(1);
    expect(totals1.appliedPromotions[0]!.code).toBe('BIG20');
    expect(totals1.discountCents).toBe(2000);

    // Stackable coupon scenario: replace the coupon with a stackable one.
    const { storeId: storeId2, cartId: cartId2 } = await buildStoreCart('promo-stack2', {
      priceCents: 10000,
      qty: 1,
    });
    await seedPromotion(storeId2, {
      name: 'Auto 5%',
      type: 'percent',
      percent: 5,
      status: 'active',
      code: null,
    });
    await seedPromotion(storeId2, {
      code: 'STACK10',
      type: 'percent',
      percent: 10,
      status: 'active',
      stackable: true,
    });
    await applyCoupon(storeId2, cartId2, 'STACK10');
    const totals2 = await priceCart(storeId2, cartId2);
    // Both apply — auto 5% (500) + coupon 10% (1000) = 1500.
    expect(totals2.appliedPromotions).toHaveLength(2);
    expect(totals2.discountCents).toBe(1500);
  });
});
