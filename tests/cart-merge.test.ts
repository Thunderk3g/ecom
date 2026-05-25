/**
 * Cart merge-on-login.
 *
 * Scenario: guest cart has variantA × 2 + variantB × 1, customer cart has
 * variantA × 1. After mergeOnLogin the customer cart owns variantA × 3 and
 * variantB × 1, and the guest cart is gone.
 *
 * The merge implementation upserts on (cart_id, variant_id) so same-variant
 * qtys sum; foreign variants are inserted. The guest cart is then deleted
 * which cascades its cart_items rows.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { resetAndMigrate } from './_setup/db';
import { appClient, migratorClient, migratorDb } from '@/db/client';
import { addItem, createCart, mergeOnLogin } from '@/modules/cart/cart';
import { priceCart } from '@/modules/cart/pricing';
import { carts, cartItems } from '@/db/schema/carts';
import { createCartTenant, type CartTenantFixture } from './_setup/cart-fixtures';

describe('cart merge-on-login', () => {
  let tenant: CartTenantFixture;
  // The same sessionId is shared between guest cart creation and merge call —
  // that's how mergeOnLogin locates the guest cart.
  const sharedSessionId = 'guest-session-merge-1';

  beforeAll(async () => {
    await resetAndMigrate();
    tenant = await createCartTenant('cart-merge');
  });

  afterAll(async () => {
    await appClient.end();
    await migratorClient.end();
  });

  it('merge sums qty for overlapping variants and brings non-overlapping ones across', async () => {
    // Step 1: guest builds a cart anchored to a session cookie value.
    const guest = await createCart(tenant.storeId, { sessionId: sharedSessionId });
    await addItem(tenant.storeId, guest.id, {
      variantId: tenant.variantA.variantId,
      qty: 2,
    });
    await addItem(tenant.storeId, guest.id, {
      variantId: tenant.variantB.variantId,
      qty: 1,
    });

    // Step 2: separately the customer (already had a cart from a prior login)
    // also has variantA × 1.
    const customer = await createCart(tenant.storeId, {
      sessionId: 'prior-customer-session',
      customerId: tenant.adminId,
    });
    await addItem(tenant.storeId, customer.id, {
      variantId: tenant.variantA.variantId,
      qty: 1,
    });

    // Step 3: merge. Guest items roll into the customer's cart.
    const merged = await mergeOnLogin(tenant.storeId, sharedSessionId, tenant.adminId);
    expect(merged.customerId).toBe(tenant.adminId);

    // Re-price the customer cart and verify line counts/qtys.
    const totals = await priceCart(tenant.storeId, merged.id);
    expect(totals.lines).toHaveLength(2);
    const byVariant = new Map(totals.lines.map(l => [l.variantId, l.qty]));
    expect(byVariant.get(tenant.variantA.variantId)).toBe(3); // 2 (guest) + 1 (customer)
    expect(byVariant.get(tenant.variantB.variantId)).toBe(1);

    // Subtotal = 3×10000 + 1×5000 = 35000
    expect(totals.subtotalCents).toBe(35000);

    // Step 4: guest cart and its items must be gone.
    const guestRows = await migratorDb
      .select()
      .from(carts)
      .where(eq(carts.id, guest.id));
    expect(guestRows).toHaveLength(0);
    const orphanItems = await migratorDb
      .select()
      .from(cartItems)
      .where(eq(cartItems.cartId, guest.id));
    expect(orphanItems).toHaveLength(0);
  });

  it('merge when customer has no prior cart creates one and moves all guest items', async () => {
    // Fresh user so there is no prior customer cart to merge into.
    const userRows = await migratorClient<{ id: string }[]>`
      INSERT INTO users (email, password_hash)
      VALUES (${`customer-new-${crypto.randomUUID().slice(0, 6)}@test.local`}, 'fake-hash')
      RETURNING id
    `;
    const newCustomerId = userRows[0]!.id;

    const sessionId = `guest-${crypto.randomUUID().slice(0, 8)}`;
    const guest = await createCart(tenant.storeId, { sessionId });
    await addItem(tenant.storeId, guest.id, {
      variantId: tenant.variantA.variantId,
      qty: 4,
    });

    const merged = await mergeOnLogin(tenant.storeId, sessionId, newCustomerId);
    expect(merged.customerId).toBe(newCustomerId);
    // New cart row, not the guest's.
    expect(merged.id).not.toBe(guest.id);

    const totals = await priceCart(tenant.storeId, merged.id);
    expect(totals.lines).toHaveLength(1);
    expect(totals.lines[0]!.qty).toBe(4);

    // Guest cart deleted.
    const guestRows = await migratorDb.select().from(carts).where(eq(carts.id, guest.id));
    expect(guestRows).toHaveLength(0);
  });

  it('merge when guest cart does not exist is a no-op that still returns customer cart', async () => {
    const userRows = await migratorClient<{ id: string }[]>`
      INSERT INTO users (email, password_hash)
      VALUES (${`customer-noop-${crypto.randomUUID().slice(0, 6)}@test.local`}, 'fake-hash')
      RETURNING id
    `;
    const customerId = userRows[0]!.id;
    const customer = await createCart(tenant.storeId, {
      sessionId: 'unused',
      customerId,
    });
    await addItem(tenant.storeId, customer.id, {
      variantId: tenant.variantB.variantId,
      qty: 2,
    });

    const merged = await mergeOnLogin(tenant.storeId, 'no-such-guest-session', customerId);
    expect(merged.id).toBe(customer.id);
    const totals = await priceCart(tenant.storeId, merged.id);
    expect(totals.lines).toHaveLength(1);
    expect(totals.lines[0]!.qty).toBe(2);
  });
});
