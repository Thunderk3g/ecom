/**
 * Shipping computation against priceCart.
 *
 * Tests:
 *   - region match: address-in-zone → that zone's rate applies
 *   - rate.freeOverCents: when cart subtotal ≥ threshold, shipping is 0
 *   - default zone fallback: no region match, isDefault zone wins
 *   - rateCode picks a named rate inside a multi-rate zone
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate } from './_setup/db';
import { appClient, migratorClient } from '@/db/client';
import { addItem, createCart } from '@/modules/cart/cart';
import { priceCart } from '@/modules/cart/pricing';
import { invalidateSiteConfigCache } from '@/modules/config/loader';
import {
  SAMPLE_ADDRESS_IN_MH,
  createLocationFixture,
  createStore,
  createVariantPriced,
  seedOnHand,
  seedShippingZone,
} from './_setup/cart-fixtures';

describe('pricing shipping', () => {
  beforeAll(async () => {
    await resetAndMigrate();
  });

  afterAll(async () => {
    await appClient.end();
    await migratorClient.end();
  });

  async function buildStoreWithCart(slug: string, opts: { priceCents: number; qty: number }) {
    const store = await createStore(slug);
    const variant = await createVariantPriced(store.id, {
      sku: `${slug}-v`,
      productSlug: `${slug}-prod`,
      productName: `${slug} prod`,
      priceCents: opts.priceCents,
    });
    const loc = await createLocationFixture(store.id, { code: `${slug}-wh` });
    await seedOnHand(store.id, variant.variantId, loc.id, 50);
    const cart = await createCart(store.id, { sessionId: `${slug}-sess` });
    await addItem(store.id, cart.id, { variantId: variant.variantId, qty: opts.qty });
    await invalidateSiteConfigCache(store.id);
    return { storeId: store.id, cartId: cart.id };
  }

  it('region match: rate applies (standard 9900 cents for IN-MH)', async () => {
    const { storeId, cartId } = await buildStoreWithCart('ship-region', {
      priceCents: 5000,
      qty: 1,
    });
    await seedShippingZone(storeId, {
      code: 'india',
      regions: [{ country: 'IN' }],
      rates: [
        { code: 'standard', label: 'Standard', rateCents: 9900 },
      ],
    });
    const totals = await priceCart(storeId, cartId, {
      shippingAddress: SAMPLE_ADDRESS_IN_MH,
    });
    expect(totals.shippingCents).toBe(9900);
    expect(totals.shippingOption?.code).toBe('standard');
  });

  it('rate.freeOverCents zeros shipping once cart subtotal qualifies', async () => {
    // Cart subtotal = 1 × 60000 = 60000 ≥ 50000 free-over threshold.
    const { storeId, cartId } = await buildStoreWithCart('ship-freeover', {
      priceCents: 60000,
      qty: 1,
    });
    await seedShippingZone(storeId, {
      code: 'india',
      regions: [{ country: 'IN' }],
      rates: [
        { code: 'standard', label: 'Standard', rateCents: 9900, freeOverCents: 50000 },
      ],
    });
    const totals = await priceCart(storeId, cartId, {
      shippingAddress: SAMPLE_ADDRESS_IN_MH,
    });
    expect(totals.shippingCents).toBe(0);
    expect(totals.shippingOption?.code).toBe('standard');
  });

  it('default zone is used when no region matches', async () => {
    const { storeId, cartId } = await buildStoreWithCart('ship-default', {
      priceCents: 5000,
      qty: 1,
    });
    // Zone for US (won't match IN address).
    await seedShippingZone(storeId, {
      code: 'us',
      regions: [{ country: 'US' }],
      rates: [{ code: 'standard', label: 'US Standard', rateCents: 999 }],
    });
    // Default fallback zone.
    await seedShippingZone(storeId, {
      code: 'row',
      regions: [],
      rates: [{ code: 'standard', label: 'ROW Standard', rateCents: 15000 }],
      isDefault: true,
    });
    const totals = await priceCart(storeId, cartId, {
      shippingAddress: SAMPLE_ADDRESS_IN_MH,
    });
    expect(totals.shippingCents).toBe(15000);
    expect(totals.shippingOption?.label).toBe('ROW Standard');
  });

  it('rateCode picks a named rate from a multi-rate zone', async () => {
    const { storeId, cartId } = await buildStoreWithCart('ship-rate-code', {
      priceCents: 1000,
      qty: 1,
    });
    await seedShippingZone(storeId, {
      code: 'india',
      regions: [{ country: 'IN' }],
      rates: [
        { code: 'standard', label: 'Standard', rateCents: 5000 },
        { code: 'express', label: 'Express', rateCents: 12000 },
      ],
    });
    const totals = await priceCart(storeId, cartId, {
      shippingAddress: SAMPLE_ADDRESS_IN_MH,
      shippingRateCode: 'express',
    });
    expect(totals.shippingCents).toBe(12000);
    expect(totals.shippingOption?.code).toBe('express');
  });
});
