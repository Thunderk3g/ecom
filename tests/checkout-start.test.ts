/**
 * Checkout start — reserves inventory, persists payment_intents, idempotent.
 *
 * Uses the FakePaymentProvider via `installFakePaymentProviders()` so no
 * network calls happen. Asserts:
 *   - stock_levels.reserved increased by the cart qty
 *   - payment_intents row written with provider/amount/cart linkage
 *   - second call with same cart + provider returns the SAME intentId
 *     (idempotency at the module level, before the HTTP cache layer)
 *
 * Idempotency at the HTTP withIdempotency-key layer is covered in
 * checkout-idempotency.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { resetAndMigrate } from './_setup/db';
import { appClient, migratorClient, migratorDb } from '@/db/client';
import { addItem, createCart, setAddresses } from '@/modules/cart/cart';
import { startCheckout } from '@/modules/checkout/checkout';
import { paymentIntents } from '@/db/schema/payments';
import { stockLevels } from '@/db/schema/inventory';
import {
  SAMPLE_ADDRESS_IN_MH,
  createCartTenant,
  type CartTenantFixture,
} from './_setup/cart-fixtures';
import {
  installFakePaymentProviders,
  type FakePaymentProvider,
} from './_setup/fake-payment-provider';

describe('checkout start', () => {
  let tenant: CartTenantFixture;
  let fakeRazorpay: FakePaymentProvider;
  let uninstall: () => void;

  beforeAll(async () => {
    await resetAndMigrate();
    tenant = await createCartTenant('co-start');
    const installed = installFakePaymentProviders();
    fakeRazorpay = installed.fakeRazorpay;
    uninstall = installed.uninstall;
  });

  afterAll(async () => {
    uninstall();
    await appClient.end();
    await migratorClient.end();
  });

  async function buildCartReady(sessionId: string, qty = 2) {
    const cart = await createCart(tenant.storeId, { sessionId });
    await addItem(tenant.storeId, cart.id, {
      variantId: tenant.variantA.variantId,
      qty,
    });
    await setAddresses(tenant.storeId, cart.id, {
      shippingAddress: SAMPLE_ADDRESS_IN_MH,
    });
    return cart;
  }

  it('reserves inventory and creates a payment_intents row', async () => {
    const cart = await buildCartReady('co-start-1', 3);

    // Before: stock_levels.reserved should be 0 for this variant/location.
    const [before] = await migratorDb
      .select()
      .from(stockLevels)
      .where(
        and(
          eq(stockLevels.variantId, tenant.variantA.variantId),
          eq(stockLevels.locationId, tenant.locationId),
        ),
      );
    expect(before?.reserved ?? 0).toBe(0);

    const result = await startCheckout(tenant.storeId, {
      cartId: cart.id,
      provider: 'razorpay',
    });
    expect(result.intentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.providerRef).toContain('razorpay_');
    expect(result.totals.subtotalCents).toBe(30000); // 3 × 10000

    // After: reserved increased by qty.
    const [after] = await migratorDb
      .select()
      .from(stockLevels)
      .where(
        and(
          eq(stockLevels.variantId, tenant.variantA.variantId),
          eq(stockLevels.locationId, tenant.locationId),
        ),
      );
    expect(after?.reserved).toBe(3);

    // Intent row persisted with provider/amount/cart linkage.
    const [intent] = await migratorDb
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.id, result.intentId));
    expect(intent?.provider).toBe('razorpay');
    expect(intent?.amountCents).toBe(result.totals.totalCents);
    expect(intent?.cartId).toBe(cart.id);
    expect(intent?.status).toBe('attached');
    expect(intent?.reservationIds.length).toBe(1);
  });

  it('empty cart throws EmptyCartError', async () => {
    const cart = await createCart(tenant.storeId, { sessionId: 'co-start-empty' });
    await setAddresses(tenant.storeId, cart.id, {
      shippingAddress: SAMPLE_ADDRESS_IN_MH,
    });
    const { EmptyCartError } = await import('@/modules/checkout/errors');
    await expect(
      startCheckout(tenant.storeId, { cartId: cart.id, provider: 'razorpay' }),
    ).rejects.toBeInstanceOf(EmptyCartError);
  });

  it('cart with no shipping address throws MissingShippingAddressError', async () => {
    const cart = await createCart(tenant.storeId, { sessionId: 'co-start-no-addr' });
    await addItem(tenant.storeId, cart.id, {
      variantId: tenant.variantA.variantId,
      qty: 1,
    });
    const { MissingShippingAddressError } = await import('@/modules/checkout/errors');
    await expect(
      startCheckout(tenant.storeId, { cartId: cart.id, provider: 'razorpay' }),
    ).rejects.toBeInstanceOf(MissingShippingAddressError);
  });

  it('non-existent cart id throws CheckoutNotFoundError', async () => {
    const { CheckoutNotFoundError } = await import('@/modules/checkout/errors');
    await expect(
      startCheckout(tenant.storeId, {
        cartId: '00000000-0000-0000-0000-000000000000',
        provider: 'razorpay',
      }),
    ).rejects.toBeInstanceOf(CheckoutNotFoundError);
  });

  it('double-call with same cart+provider returns the SAME intentId (module-level idempotency)', async () => {
    const cart = await buildCartReady('co-start-2', 1);
    const callsBefore = fakeRazorpay.createCalls.length;

    const first = await startCheckout(tenant.storeId, {
      cartId: cart.id,
      provider: 'razorpay',
    });
    const second = await startCheckout(tenant.storeId, {
      cartId: cart.id,
      provider: 'razorpay',
    });
    expect(second.intentId).toBe(first.intentId);
    expect(second.providerRef).toBe(first.providerRef);
    // Provider createIntent must NOT have been called a second time —
    // the module short-circuited on the existing 'attached' intent.
    expect(fakeRazorpay.createCalls.length - callsBefore).toBe(1);
  });
});
