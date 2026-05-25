/**
 * Razorpay payment webhook — end-to-end behavior over the route handler.
 *
 * Flow:
 *   1. Build a cart with stock + address, run startCheckout to create a
 *      'attached' payment_intents row with a known providerRef.
 *   2. Craft a webhook payload that says "payment_succeeded for that
 *      providerRef", sign it with the fake provider's webhook secret, POST
 *      it to /api/v1/webhooks/payments/razorpay.
 *   3. Assert: HTTP 200; payment_events row processed=true; intent.status
 *      = 'succeeded'; orders row created with the cart's totals + items;
 *      stock_levels.reserved decremented; cart deleted.
 *   4. POST the same payload again → 200 ("duplicate") without doubling the
 *      order count.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { resetAndMigrate } from './_setup/db';
import { appClient, migratorClient, migratorDb } from '@/db/client';
import { addItem, createCart, setAddresses } from '@/modules/cart/cart';
import { startCheckout } from '@/modules/checkout/checkout';
import { POST as webhookPost } from '@/app/api/v1/webhooks/payments/[provider]/route';
import { carts } from '@/db/schema/carts';
import { paymentEvents, paymentIntents } from '@/db/schema/payments';
import { orders, orderItems } from '@/db/schema/orders';
import { stockLevels } from '@/db/schema/inventory';
import {
  SAMPLE_ADDRESS_IN_MH,
  createCartTenant,
  relaxPaymentIntentCartFk,
  type CartTenantFixture,
} from './_setup/cart-fixtures';
import {
  buildFakeWebhookPayload,
  installFakePaymentProviders,
  signFakeWebhook,
  type FakePaymentProvider,
} from './_setup/fake-payment-provider';

describe('checkout webhook — razorpay', () => {
  let tenant: CartTenantFixture;
  let fakeRazorpay: FakePaymentProvider;
  let uninstall: () => void;

  beforeAll(async () => {
    await resetAndMigrate();
    await relaxPaymentIntentCartFk();
    tenant = await createCartTenant('wh-rzp');
    const installed = installFakePaymentProviders();
    fakeRazorpay = installed.fakeRazorpay;
    uninstall = installed.uninstall;
  });

  afterAll(async () => {
    uninstall();
    await appClient.end();
    await migratorClient.end();
  });

  function buildWebhookRequest(rawBody: string, signature: string): Request {
    return new Request('http://test/api/v1/webhooks/payments/razorpay', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': signature,
      },
      body: rawBody,
    });
  }

  it('payment_succeeded → order created, cart deleted, reserved decremented', async () => {
    // 1. Cart + checkout.
    const cart = await createCart(tenant.storeId, { sessionId: 'wh-rzp-sess' });
    await addItem(tenant.storeId, cart.id, {
      variantId: tenant.variantA.variantId,
      qty: 2,
    });
    await setAddresses(tenant.storeId, cart.id, {
      shippingAddress: SAMPLE_ADDRESS_IN_MH,
    });
    const started = await startCheckout(tenant.storeId, {
      cartId: cart.id,
      provider: 'razorpay',
    });

    // 2. Fake webhook payload + signature.
    const payload = buildFakeWebhookPayload({
      providerRef: started.providerRef,
      providerEventId: `evt_rzp_${crypto.randomUUID()}`,
      type: 'payment_succeeded',
      amountCents: started.totals.totalCents,
    });
    const rawBody = JSON.stringify(payload);
    const sig = signFakeWebhook(rawBody, fakeRazorpay.webhookSecret);

    // 3. POST to the route as if the provider called us.
    const res = await webhookPost(buildWebhookRequest(rawBody, sig), {
      params: Promise.resolve({ provider: 'razorpay' }),
    });
    expect(res.status).toBe(200);

    // payment_events row processed.
    const eventRows = await migratorDb
      .select()
      .from(paymentEvents)
      .where(eq(paymentEvents.providerEventId, payload['id'] as string));
    expect(eventRows).toHaveLength(1);
    expect(eventRows[0]!.processed).toBe(true);

    // intent succeeded.
    const intentRows = await migratorDb
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.id, started.intentId));
    expect(intentRows[0]!.status).toBe('succeeded');

    // order created with the totals.
    const orderRows = await migratorDb
      .select()
      .from(orders)
      .where(eq(orders.storeId, tenant.storeId));
    expect(orderRows).toHaveLength(1);
    const order = orderRows[0]!;
    expect(order.totalCents).toBe(started.totals.totalCents);
    expect(order.subtotalCents).toBe(started.totals.subtotalCents);
    expect(order.number).toMatch(/^WH-RZP-\d{8}$/);

    // order_items matches cart qty.
    const itemRows = await migratorDb
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id));
    expect(itemRows).toHaveLength(1);
    expect(itemRows[0]!.qty).toBe(2);
    expect(itemRows[0]!.variantId).toBe(tenant.variantA.variantId);

    // reserved decremented (committed → release + outbound).
    const [level] = await migratorDb
      .select()
      .from(stockLevels)
      .where(
        and(
          eq(stockLevels.variantId, tenant.variantA.variantId),
          eq(stockLevels.locationId, tenant.locationId),
        ),
      );
    expect(level?.reserved).toBe(0);
    expect(level?.onHand).toBe(98); // 100 − 2

    // cart deleted.
    const cartRows = await migratorDb.select().from(carts).where(eq(carts.id, cart.id));
    expect(cartRows).toHaveLength(0);

    // 4. Duplicate POST → 200 without doubling the order.
    const res2 = await webhookPost(buildWebhookRequest(rawBody, sig), {
      params: Promise.resolve({ provider: 'razorpay' }),
    });
    expect(res2.status).toBe(200);
    const orderRows2 = await migratorDb
      .select()
      .from(orders)
      .where(eq(orders.storeId, tenant.storeId));
    expect(orderRows2).toHaveLength(1);
  });

  it('invalid signature returns 401', async () => {
    const payload = buildFakeWebhookPayload({
      providerRef: 'razorpay_unknown',
      providerEventId: `evt_bad_${crypto.randomUUID()}`,
      type: 'payment_succeeded',
    });
    const rawBody = JSON.stringify(payload);
    // Wrong secret → signature won't verify.
    const sig = signFakeWebhook(rawBody, 'wrong_secret');
    const res = await webhookPost(buildWebhookRequest(rawBody, sig), {
      params: Promise.resolve({ provider: 'razorpay' }),
    });
    expect(res.status).toBe(401);
  });
});
