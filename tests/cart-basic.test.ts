/**
 * Cart basics — create, add, update, remove, totals at each step.
 *
 * Verifies the cart module against real Postgres + Redis. Tax is not seeded
 * here (zero-rate fallback from site_config) so totals match subtotal +
 * shipping; the SP-4 default mode is 'inclusive' which means even with zero
 * rate the total equals subtotal. Tax math lives in pricing-engine.test.ts.
 *
 * The cart module's addItem upserts on (cart_id, variant_id) — adding the
 * same variant twice sums quantities and refreshes the unit_price snapshot.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate } from './_setup/db';
import { appClient, migratorClient } from '@/db/client';
import {
  addItem,
  createCart,
  removeItem,
  updateItem,
} from '@/modules/cart/cart';
import { priceCart } from '@/modules/cart/pricing';
import { createCartTenant, type CartTenantFixture } from './_setup/cart-fixtures';

describe('cart basics', () => {
  let tenant: CartTenantFixture;

  beforeAll(async () => {
    await resetAndMigrate();
    tenant = await createCartTenant('cart-basic');
  });

  afterAll(async () => {
    await appClient.end();
    await migratorClient.end();
  });

  it('create cart returns a row with default INR currency and no items', async () => {
    const cart = await createCart(tenant.storeId, { sessionId: 'sess-create' });
    expect(cart.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(cart.currency).toBe('INR');
    expect(cart.customerId).toBeNull();
    const totals = await priceCart(tenant.storeId, cart.id);
    expect(totals.subtotalCents).toBe(0);
    expect(totals.totalCents).toBe(0);
    expect(totals.lines).toHaveLength(0);
  });

  it('add two items: subtotal sums (qty × unit_price) for both lines', async () => {
    const cart = await createCart(tenant.storeId, { sessionId: 'sess-add' });
    // 2 of variantA @ 10000 = 20000
    await addItem(tenant.storeId, cart.id, { variantId: tenant.variantA.variantId, qty: 2 });
    // 3 of variantB @ 5000 = 15000
    await addItem(tenant.storeId, cart.id, { variantId: tenant.variantB.variantId, qty: 3 });

    const totals = await priceCart(tenant.storeId, cart.id);
    // Lines: variantA 20000 + variantB 15000 = 35000 subtotal.
    expect(totals.subtotalCents).toBe(35000);
    expect(totals.lines).toHaveLength(2);
    expect(totals.totalCents).toBe(35000); // inclusive default + 0 rate + no shipping/address
  });

  it('addItem twice for same variant sums qty via upsert', async () => {
    const cart = await createCart(tenant.storeId, { sessionId: 'sess-upsert' });
    await addItem(tenant.storeId, cart.id, { variantId: tenant.variantA.variantId, qty: 1 });
    await addItem(tenant.storeId, cart.id, { variantId: tenant.variantA.variantId, qty: 2 });
    const totals = await priceCart(tenant.storeId, cart.id);
    expect(totals.lines).toHaveLength(1);
    expect(totals.lines[0]!.qty).toBe(3);
    expect(totals.subtotalCents).toBe(30000);
  });

  it('updateItem to new qty recomputes line subtotal', async () => {
    const cart = await createCart(tenant.storeId, { sessionId: 'sess-update' });
    const after = await addItem(tenant.storeId, cart.id, {
      variantId: tenant.variantA.variantId,
      qty: 2,
    });
    const itemId = after.items[0]!.id;
    await updateItem(tenant.storeId, cart.id, itemId, { qty: 5 });
    const totals = await priceCart(tenant.storeId, cart.id);
    expect(totals.lines[0]!.qty).toBe(5);
    expect(totals.subtotalCents).toBe(50000);
  });

  it('updateItem qty=0 removes the line', async () => {
    const cart = await createCart(tenant.storeId, { sessionId: 'sess-update-zero' });
    const after = await addItem(tenant.storeId, cart.id, {
      variantId: tenant.variantA.variantId,
      qty: 4,
    });
    const itemId = after.items[0]!.id;
    await updateItem(tenant.storeId, cart.id, itemId, { qty: 0 });
    const totals = await priceCart(tenant.storeId, cart.id);
    expect(totals.lines).toHaveLength(0);
    expect(totals.subtotalCents).toBe(0);
  });

  it('addItem with qty<=0 throws VariantNotAvailableError', async () => {
    const cart = await createCart(tenant.storeId, { sessionId: 'sess-bad-qty' });
    const { VariantNotAvailableError } = await import('@/modules/cart/errors');
    await expect(
      addItem(tenant.storeId, cart.id, { variantId: tenant.variantA.variantId, qty: 0 }),
    ).rejects.toBeInstanceOf(VariantNotAvailableError);
  });

  it('addItem against unknown variant throws VariantNotAvailableError (not_found)', async () => {
    const cart = await createCart(tenant.storeId, { sessionId: 'sess-unknown-variant' });
    const { VariantNotAvailableError } = await import('@/modules/cart/errors');
    await expect(
      addItem(tenant.storeId, cart.id, {
        variantId: '00000000-0000-0000-0000-000000000000',
        qty: 1,
      }),
    ).rejects.toBeInstanceOf(VariantNotAvailableError);
  });

  it('removeItem deletes the line; remaining lines unaffected', async () => {
    const cart = await createCart(tenant.storeId, { sessionId: 'sess-remove' });
    const afterA = await addItem(tenant.storeId, cart.id, {
      variantId: tenant.variantA.variantId,
      qty: 1,
    });
    await addItem(tenant.storeId, cart.id, {
      variantId: tenant.variantB.variantId,
      qty: 2,
    });
    const aItem = afterA.items.find(i => i.variantId === tenant.variantA.variantId)!;
    await removeItem(tenant.storeId, cart.id, aItem.id);
    const totals = await priceCart(tenant.storeId, cart.id);
    expect(totals.lines).toHaveLength(1);
    expect(totals.lines[0]!.variantId).toBe(tenant.variantB.variantId);
    expect(totals.subtotalCents).toBe(10000); // 2 × 5000
  });
});
