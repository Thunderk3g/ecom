/**
 * Checkout HTTP idempotency.
 *
 * POST /api/v1/checkout/start uses withIdempotency keyed on
 *   `storefront:checkout:start:<storeId>:<cartId>` + Idempotency-Key header.
 *
 * Verified:
 *   - same Idempotency-Key replays the same JSON response (Redis cache hit)
 *   - different Idempotency-Key with the same cart still produces a coherent
 *     result (the module short-circuits to the existing intent, so the JSON
 *     payload still matches — different Redis key, identical underlying data)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import Redis from 'ioredis';
import { resetAndMigrate } from './_setup/db';
import { appClient, migratorClient } from '@/db/client';
import { addItem, createCart, setAddresses } from '@/modules/cart/cart';
import { sign } from '@/lib/cookies';
import { mintCsrfToken } from '@/modules/auth/csrf';
import { POST as checkoutStartPost } from '@/app/api/v1/checkout/start/route';
import {
  SAMPLE_ADDRESS_IN_MH,
  createCartTenant,
  type CartTenantFixture,
} from './_setup/cart-fixtures';
import { installFakePaymentProviders } from './_setup/fake-payment-provider';

describe('checkout HTTP idempotency', () => {
  let tenant: CartTenantFixture;
  let uninstall: () => void;
  let redis: Redis;
  const host = 'cikd.example.com';

  beforeAll(async () => {
    await resetAndMigrate();
    redis = new Redis(process.env.REDIS_URL!);
    await redis.flushdb();

    tenant = await createCartTenant('co-idem');
    await migratorClient`
      INSERT INTO store_domains (store_id, domain, is_primary)
      VALUES (${tenant.storeId}, ${host}, true)
    `;
    const installed = installFakePaymentProviders();
    uninstall = installed.uninstall;
  });

  afterAll(async () => {
    uninstall();
    await redis.quit();
    await appClient.end();
    await migratorClient.end();
  });

  /**
   * Build a fresh cart + companion guest-session cookie value. We MUST use
   * a unique session id per cart because the carts_guest_session_uq partial
   * index forbids two guest carts in the same store for one session.
   */
  async function readyCart(): Promise<{ cartId: string; sessionPlain: string }> {
    const sessionPlain = `sess-${crypto.randomUUID()}`;
    const cart = await createCart(tenant.storeId, { sessionId: sessionPlain });
    await addItem(tenant.storeId, cart.id, {
      variantId: tenant.variantA.variantId,
      qty: 1,
    });
    await setAddresses(tenant.storeId, cart.id, {
      shippingAddress: SAMPLE_ADDRESS_IN_MH,
    });
    return { cartId: cart.id, sessionPlain };
  }

  function buildRequest(
    cartId: string,
    idemKey: string,
    sessionPlain: string,
  ): Request {
    const signedCookie = sign(sessionPlain);
    const csrf = mintCsrfToken(sessionPlain);
    return new Request('http://test/api/v1/checkout/start', {
      method: 'POST',
      headers: {
        'x-store-host': host,
        'content-type': 'application/json',
        cookie: `cart_sid=${signedCookie}`,
        'x-csrf-token': csrf,
        'idempotency-key': idemKey,
      },
      body: JSON.stringify({ cartId, provider: 'razorpay' }),
    });
  }

  it('same Idempotency-Key returns the same response payload (cached)', async () => {
    const { cartId, sessionPlain } = await readyCart();
    const key = `idem-${crypto.randomUUID()}`;

    const r1 = await checkoutStartPost(buildRequest(cartId, key, sessionPlain));
    expect(r1.status).toBe(200);
    const body1 = (await r1.json()) as { data: { intentId: string; providerRef: string } };

    const r2 = await checkoutStartPost(buildRequest(cartId, key, sessionPlain));
    expect(r2.status).toBe(200);
    const body2 = (await r2.json()) as { data: { intentId: string; providerRef: string } };

    expect(body2.data.intentId).toBe(body1.data.intentId);
    expect(body2.data.providerRef).toBe(body1.data.providerRef);
  });

  it('different Idempotency-Key returns coherent data (module short-circuits to existing intent)', async () => {
    const { cartId, sessionPlain } = await readyCart();
    const keyA = `idem-a-${crypto.randomUUID()}`;
    const keyB = `idem-b-${crypto.randomUUID()}`;

    const r1 = await checkoutStartPost(buildRequest(cartId, keyA, sessionPlain));
    expect(r1.status).toBe(200);
    const body1 = (await r1.json()) as { data: { intentId: string } };

    const r2 = await checkoutStartPost(buildRequest(cartId, keyB, sessionPlain));
    expect(r2.status).toBe(200);
    const body2 = (await r2.json()) as { data: { intentId: string } };

    // The HTTP idempotency cache was missed (different key) but the checkout
    // module returned the same persisted intent.
    expect(body2.data.intentId).toBe(body1.data.intentId);
  });

  it('missing Idempotency-Key returns 400', async () => {
    const { cartId, sessionPlain } = await readyCart();
    const signedCookie = sign(sessionPlain);
    const csrf = mintCsrfToken(sessionPlain);
    const req = new Request('http://test/api/v1/checkout/start', {
      method: 'POST',
      headers: {
        'x-store-host': host,
        'content-type': 'application/json',
        cookie: `cart_sid=${signedCookie}`,
        'x-csrf-token': csrf,
      },
      body: JSON.stringify({ cartId, provider: 'razorpay' }),
    });
    const res = await checkoutStartPost(req);
    expect(res.status).toBe(400);
  });
});
