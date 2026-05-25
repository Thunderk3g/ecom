/**
 * Pricing engine — inclusive vs exclusive tax math + zero-qty + mixed lines.
 *
 * Spec §16 default for India is inclusive GST. The pricing module's
 * `priceCart` uses `loadSiteConfig` for the configured mode AND
 * `resolveTaxRate(...)` for the row-level mode. Per the engine code, the
 * row-mode wins for line math but the configured mode decides the rollup
 * formula. So tests that target inclusive lines seed an `inclusive=true`
 * tax_rate; tests for exclusive seed `inclusive=false`.
 *
 * Note: `priceCart` reads `variant.price_cents` (the live price), not the
 * cart_items snapshot. To make the inclusive math hit exactly 11800/1800,
 * we seed a dedicated tenant with variant priced at 11800.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate } from './_setup/db';
import { appClient, migratorClient } from '@/db/client';
import { addItem, createCart } from '@/modules/cart/cart';
import { priceCart } from '@/modules/cart/pricing';
import { invalidateSiteConfigCache } from '@/modules/config/loader';
import {
  SAMPLE_ADDRESS_IN_MH,
  createStore,
  createLocationFixture,
  createVariantPriced,
  seedOnHand,
  seedTaxRate,
} from './_setup/cart-fixtures';

describe('pricing engine', () => {
  // Each test seeds its own store so its tax_rate doesn't interfere with
  // siblings (the engine resolves rates per-storeId).
  beforeAll(async () => {
    await resetAndMigrate();
  });

  afterAll(async () => {
    await appClient.end();
    await migratorClient.end();
  });

  it('inclusive 18%: line 11800 → subtotal 11800, tax 1800, total 11800', async () => {
    const store = await createStore('px-incl');
    const variant = await createVariantPriced(store.id, {
      sku: 'px-incl-v1',
      productSlug: 'px-incl-prod',
      productName: 'Inclusive Prod',
      priceCents: 11800,
    });
    const loc = await createLocationFixture(store.id, { code: 'px-incl-wh' });
    await seedOnHand(store.id, variant.variantId, loc.id, 10);
    await seedTaxRate(store.id, {
      regionCode: 'IN-MH',
      rate: 0.18,
      label: 'GST 18% incl',
      inclusive: true,
    });
    await invalidateSiteConfigCache(store.id);

    const cart = await createCart(store.id, { sessionId: 'px-incl-sess' });
    await addItem(store.id, cart.id, { variantId: variant.variantId, qty: 1 });

    const totals = await priceCart(store.id, cart.id, {
      shippingAddress: SAMPLE_ADDRESS_IN_MH,
    });
    expect(totals.subtotalCents).toBe(11800);
    expect(totals.taxCents).toBe(1800);
    expect(totals.totalCents).toBe(11800);
    expect(totals.lines).toHaveLength(1);
    expect(totals.lines[0]!.lineTaxCents).toBe(1800);
  });

  it('exclusive 18%: line 10000 → subtotal 10000, tax 1800, total 11800', async () => {
    const store = await createStore('px-excl');
    const variant = await createVariantPriced(store.id, {
      sku: 'px-excl-v1',
      productSlug: 'px-excl-prod',
      productName: 'Exclusive Prod',
      priceCents: 10000,
    });
    const loc = await createLocationFixture(store.id, { code: 'px-excl-wh' });
    await seedOnHand(store.id, variant.variantId, loc.id, 10);
    await seedTaxRate(store.id, {
      regionCode: 'IN-MH',
      rate: 0.18,
      label: 'GST 18% excl',
      inclusive: false,
    });
    // Force exclusive mode at the site_config level too — the rollup formula
    // uses configuredMode, not the per-row mode.
    await migratorClient`
      INSERT INTO site_config (store_id, config) VALUES (${store.id}, ${JSON.stringify({ tax: { mode: 'exclusive' } })}::jsonb)
      ON CONFLICT (store_id) DO UPDATE SET config = EXCLUDED.config
    `;
    await invalidateSiteConfigCache(store.id);

    const cart = await createCart(store.id, { sessionId: 'px-excl-sess' });
    await addItem(store.id, cart.id, { variantId: variant.variantId, qty: 1 });

    const totals = await priceCart(store.id, cart.id, {
      shippingAddress: SAMPLE_ADDRESS_IN_MH,
    });
    expect(totals.subtotalCents).toBe(10000);
    expect(totals.taxCents).toBe(1800);
    expect(totals.totalCents).toBe(11800);
  });

  it('empty cart: zero subtotal/tax/total with no lines', async () => {
    const store = await createStore('px-empty');
    const cart = await createCart(store.id, { sessionId: 'px-empty-sess' });
    const totals = await priceCart(store.id, cart.id);
    expect(totals.subtotalCents).toBe(0);
    expect(totals.taxCents).toBe(0);
    expect(totals.totalCents).toBe(0);
    expect(totals.lines).toHaveLength(0);
  });

  it('mixed lines (inclusive 18%): two variants priced 11800 + 2360 sum correctly', async () => {
    const store = await createStore('px-mixed');
    const v1 = await createVariantPriced(store.id, {
      sku: 'px-mix-v1',
      productSlug: 'px-mix-1',
      productName: 'Mix 1',
      priceCents: 11800,
    });
    const v2 = await createVariantPriced(store.id, {
      sku: 'px-mix-v2',
      productSlug: 'px-mix-2',
      productName: 'Mix 2',
      priceCents: 2360,
    });
    const loc = await createLocationFixture(store.id, { code: 'px-mix-wh' });
    await seedOnHand(store.id, v1.variantId, loc.id, 10);
    await seedOnHand(store.id, v2.variantId, loc.id, 10);
    await seedTaxRate(store.id, {
      regionCode: 'IN-MH',
      rate: 0.18,
      label: 'GST 18% incl',
      inclusive: true,
    });
    await invalidateSiteConfigCache(store.id);

    const cart = await createCart(store.id, { sessionId: 'px-mix-sess' });
    await addItem(store.id, cart.id, { variantId: v1.variantId, qty: 1 });
    await addItem(store.id, cart.id, { variantId: v2.variantId, qty: 2 });

    const totals = await priceCart(store.id, cart.id, {
      shippingAddress: SAMPLE_ADDRESS_IN_MH,
    });
    // Subtotals: 11800 + (2 × 2360 = 4720) = 16520
    expect(totals.subtotalCents).toBe(16520);
    // Tax: 11800×0.18/1.18 = 1800 ; 4720×0.18/1.18 = 720 → 2520
    expect(totals.taxCents).toBe(2520);
    // Inclusive rollup: total = subtotal − discount + shipping (tax in subtotal)
    expect(totals.totalCents).toBe(16520);
  });
});
