/**
 * Tax rate resolution — region+class → region → country+class → country → fallback.
 *
 * The pricing module's `resolveTaxRate` is the lookup helper used by the
 * pricing engine. We exercise it directly via `priceCart` since it operates
 * inside a withTenant transaction and we want to verify the full path the
 * cart engine uses.
 *
 * The fallback when no row matches is the site_config-configured mode with
 * `rate: 0` — so a cart with no tax rows but a shipping address still gets
 * zero tax and no crash.
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
  seedTaxRate,
} from './_setup/cart-fixtures';

describe('pricing tax resolution', () => {
  beforeAll(async () => {
    await resetAndMigrate();
  });

  afterAll(async () => {
    await appClient.end();
    await migratorClient.end();
  });

  async function buildStoreWithCart(slug: string, priceCents = 11800) {
    const store = await createStore(slug);
    const variant = await createVariantPriced(store.id, {
      sku: `${slug}-v`,
      productSlug: `${slug}-prod`,
      productName: `${slug} prod`,
      priceCents,
    });
    const loc = await createLocationFixture(store.id, { code: `${slug}-wh` });
    await seedOnHand(store.id, variant.variantId, loc.id, 5);
    const cart = await createCart(store.id, { sessionId: `${slug}-sess` });
    await addItem(store.id, cart.id, { variantId: variant.variantId, qty: 1 });
    await invalidateSiteConfigCache(store.id);
    return { storeId: store.id, cartId: cart.id };
  }

  it('country-region match wins over country-only when both exist', async () => {
    const { storeId, cartId } = await buildStoreWithCart('tax-region');
    // Country-only row (would resolve to 5%) vs region row (18%) — region wins.
    await seedTaxRate(storeId, { regionCode: 'IN', rate: 0.05, inclusive: true });
    await seedTaxRate(storeId, { regionCode: 'IN-MH', rate: 0.18, inclusive: true });

    const totals = await priceCart(storeId, cartId, {
      shippingAddress: SAMPLE_ADDRESS_IN_MH,
    });
    // 11800 inclusive @ 18% → 1800 tax.
    expect(totals.taxCents).toBe(1800);
  });

  it('country-only row matches when no region-specific row exists', async () => {
    const { storeId, cartId } = await buildStoreWithCart('tax-country');
    await seedTaxRate(storeId, { regionCode: 'IN', rate: 0.18, inclusive: true });

    const totals = await priceCart(storeId, cartId, {
      shippingAddress: SAMPLE_ADDRESS_IN_MH,
    });
    expect(totals.taxCents).toBe(1800);
  });

  it('no matching row falls back to zero rate from site_config default mode', async () => {
    const { storeId, cartId } = await buildStoreWithCart('tax-fallback');
    // No tax_rates rows. Address is IN-MH but no IN nor IN-MH row exists.

    const totals = await priceCart(storeId, cartId, {
      shippingAddress: SAMPLE_ADDRESS_IN_MH,
    });
    expect(totals.taxCents).toBe(0);
    // Default mode is 'inclusive' → total === subtotal.
    expect(totals.totalCents).toBe(totals.subtotalCents);
  });
});
