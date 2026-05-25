/**
 * Cart coupons — apply, expired, exhausted, invalid; verify the discount
 * flows into priceCart's totals.
 *
 * The cart.applyCoupon helper validates via assertCouponValid, which throws
 * one of InvalidCouponError / CouponExpiredError / CouponUsageExhaustedError.
 * priceCart's promotion evaluator also runs the validation lazily and falls
 * silently — but applyCoupon's UI-facing path is throw-based and that's what
 * we test here.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate } from './_setup/db';
import { appClient, migratorClient } from '@/db/client';
import {
  addItem,
  applyCoupon,
  createCart,
  removeCoupon,
} from '@/modules/cart/cart';
import { priceCart } from '@/modules/cart/pricing';
import {
  CouponExpiredError,
  CouponUsageExhaustedError,
  InvalidCouponError,
} from '@/modules/cart/errors';
import {
  createCartTenant,
  seedPromotion,
  type CartTenantFixture,
} from './_setup/cart-fixtures';

describe('cart coupons', () => {
  let tenant: CartTenantFixture;

  beforeAll(async () => {
    await resetAndMigrate();
    tenant = await createCartTenant('cart-coupon');
  });

  afterAll(async () => {
    await appClient.end();
    await migratorClient.end();
  });

  async function freshCartWithItem(sessionId: string, qty = 2) {
    const cart = await createCart(tenant.storeId, { sessionId });
    await addItem(tenant.storeId, cart.id, {
      variantId: tenant.variantA.variantId,
      qty,
    });
    return cart;
  }

  it('valid 10% coupon: discount appears in totals (10% of 20000 = 2000)', async () => {
    await seedPromotion(tenant.storeId, {
      code: 'TEN_OFF',
      type: 'percent',
      percent: 10,
      status: 'active',
    });
    const cart = await freshCartWithItem('sess-valid');
    await applyCoupon(tenant.storeId, cart.id, 'TEN_OFF');
    const totals = await priceCart(tenant.storeId, cart.id);
    expect(totals.discountCents).toBe(2000);
    expect(totals.appliedPromotions).toHaveLength(1);
    expect(totals.appliedPromotions[0]!.code).toBe('TEN_OFF');
    // Inclusive default, zero tax-rate fallback → total = subtotal − discount.
    expect(totals.totalCents).toBe(20000 - 2000);
  });

  it('expired coupon throws CouponExpiredError on applyCoupon', async () => {
    await seedPromotion(tenant.storeId, {
      code: 'EXPIRED',
      type: 'percent',
      percent: 25,
      status: 'active',
      endsAt: new Date(Date.now() - 60_000),
    });
    const cart = await freshCartWithItem('sess-expired');
    await expect(applyCoupon(tenant.storeId, cart.id, 'EXPIRED')).rejects.toBeInstanceOf(
      CouponExpiredError,
    );
  });

  it('usage-exhausted coupon throws CouponUsageExhaustedError on applyCoupon', async () => {
    await seedPromotion(tenant.storeId, {
      code: 'CAPPED',
      type: 'percent',
      percent: 15,
      status: 'active',
      usageLimit: 5,
      usedCount: 5,
    });
    const cart = await freshCartWithItem('sess-capped');
    await expect(applyCoupon(tenant.storeId, cart.id, 'CAPPED')).rejects.toBeInstanceOf(
      CouponUsageExhaustedError,
    );
  });

  it('invalid (unknown) code throws InvalidCouponError', async () => {
    const cart = await freshCartWithItem('sess-invalid');
    await expect(
      applyCoupon(tenant.storeId, cart.id, 'NOSUCHCODE'),
    ).rejects.toBeInstanceOf(InvalidCouponError);
  });

  it('removeCoupon clears the discount from subsequent totals', async () => {
    await seedPromotion(tenant.storeId, {
      code: 'TWENTY',
      type: 'percent',
      percent: 20,
      status: 'active',
    });
    const cart = await freshCartWithItem('sess-remove-coupon');
    await applyCoupon(tenant.storeId, cart.id, 'TWENTY');
    const withCoupon = await priceCart(tenant.storeId, cart.id);
    expect(withCoupon.discountCents).toBe(4000);

    await removeCoupon(tenant.storeId, cart.id);
    const withoutCoupon = await priceCart(tenant.storeId, cart.id);
    expect(withoutCoupon.discountCents).toBe(0);
    expect(withoutCoupon.appliedPromotions).toHaveLength(0);
  });
});
