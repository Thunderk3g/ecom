/**
 * Stripe payment webhook — same flow as Razorpay but through the stripe
 * provider branch of the route. The fake provider handles both header
 * names with the same HMAC scheme, so the test signature math is identical.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { resetAndMigrate } from './_setup/db';
import { appClient, migratorClient, migratorDb } from '@/db/client';
import { addItem, createCart, setAddresses } from '@/modules/cart/cart';
import { startCheckout } from '@/modules/checkout/checkout';
import { POST as webhookPost } from '@/app/api/v1/webhooks/payments/[provider]/route';
import { carts } from '@/db/schema/carts';
import { paymentIntents } from '@/db/schema/payments';
import { orders } from '@/db/schema/orders';
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

describe('checkout webhook — stripe', () => {
  let tenant: CartTenantFixture;
  let fakeStripe: FakePaymentProvider;
  let uninstall: () => void;

  beforeAll(async () => {
    await resetAndMigrate();
    await relaxPaymentIntentCartFk();
    tenant = await createCartTenant('wh-stp');
    const installed = installFakePaymentProviders();
    fakeStripe = installed.fakeStripe;
    uninstall = installed.uninstall;
  });

  afterAll(async () => {
    uninstall();
    await appClient.end();
    await migratorClient.end();
  });

  function buildWebhookRequest(rawBody: string, signature: string): Request {
    return new Request('http://test/api/v1/webhooks/payments/stripe', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signature,
      },
      body: rawBody,
    });
  }

  it('payment_succeeded via stripe → order created, cart deleted, reserved decremented', async () => {
    const cart = await createCart(tenant.storeId, { sessionId: 'wh-stp-sess' });
    await addItem(tenant.storeId, cart.id, {
      variantId: tenant.variantB.variantId,
      qty: 3,
    });
    await setAddresses(tenant.storeId, cart.id, {
      shippingAddress: SAMPLE_ADDRESS_IN_MH,
    });
    const started = await startCheckout(tenant.storeId, {
      cartId: cart.id,
      provider: 'stripe',
    });
    expect(started.providerRef).toContain('stripe_');
    expect(started.clientSecret).toBeDefined();

    const payload = buildFakeWebhookPayload({
      providerRef: started.providerRef,
      providerEventId: `evt_stp_${crypto.randomUUID()}`,
      type: 'payment_succeeded',
      amountCents: started.totals.totalCents,
    });
    const rawBody = JSON.stringify(payload);
    const sig = signFakeWebhook(rawBody, fakeStripe.webhookSecret);

    const res = await webhookPost(buildWebhookRequest(rawBody, sig), {
      params: Promise.resolve({ provider: 'stripe' }),
    });
    expect(res.status).toBe(200);

    const intentRows = await migratorDb
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.id, started.intentId));
    expect(intentRows[0]!.status).toBe('succeeded');

    const orderRows = await migratorDb
      .select()
      .from(orders)
      .where(eq(orders.storeId, tenant.storeId));
    expect(orderRows).toHaveLength(1);
    expect(orderRows[0]!.totalCents).toBe(started.totals.totalCents);
    expect(orderRows[0]!.number).toMatch(/^WH-STP-\d{8}$/);

    const [level] = await migratorDb
      .select()
      .from(stockLevels)
      .where(
        and(
          eq(stockLevels.variantId, tenant.variantB.variantId),
          eq(stockLevels.locationId, tenant.locationId),
        ),
      );
    expect(level?.reserved).toBe(0);
    expect(level?.onHand).toBe(97); // 100 − 3

    const cartRows = await migratorDb.select().from(carts).where(eq(carts.id, cart.id));
    expect(cartRows).toHaveLength(0);

    // Duplicate POST is a no-op.
    const res2 = await webhookPost(buildWebhookRequest(rawBody, sig), {
      params: Promise.resolve({ provider: 'stripe' }),
    });
    expect(res2.status).toBe(200);
    const orderRows2 = await migratorDb
      .select()
      .from(orders)
      .where(eq(orders.storeId, tenant.storeId));
    expect(orderRows2).toHaveLength(1);
  });
});
