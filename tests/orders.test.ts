/**
 * Orders read API — guest by email, customer by session, cross-customer
 * isolation, and the customer order list pagination.
 *
 * Order rows are seeded directly via migratorClient so we don't have to drive
 * the full webhook flow for every variant of the read path. `mint_order_number`
 * is invoked manually to mirror the production order numbering.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import Redis from 'ioredis';
import { resetAndMigrate } from './_setup/db';
import { appClient, migratorClient } from '@/db/client';
import { sign, SESSION_COOKIE } from '@/lib/cookies';
import { GET as getOrderByNumber } from '@/app/api/v1/orders/[number]/route';
import { GET as listCustomerOrdersGet } from '@/app/api/v1/customer/orders/route';
import { createCartTenant, type CartTenantFixture } from './_setup/cart-fixtures';

type OrderResp = {
  data: {
    order: { number: string; email: string; totalCents: number; customerId: string | null };
    items: Array<{ qty: number; variantId: string }>;
  };
};

describe('orders read API', () => {
  let tenant: CartTenantFixture;
  let redis: Redis;
  const host = 'orders.example.com';

  beforeAll(async () => {
    await resetAndMigrate();
    redis = new Redis(process.env.REDIS_URL!);
    await redis.flushdb();

    tenant = await createCartTenant('orders');
    await migratorClient`
      INSERT INTO store_domains (store_id, domain, is_primary)
      VALUES (${tenant.storeId}, ${host}, true)
    `;
  });

  afterAll(async () => {
    await redis.quit();
    await appClient.end();
    await migratorClient.end();
  });

  async function seedOrder(opts: {
    email: string;
    customerId?: string | null;
    totalCents?: number;
    placedAt?: Date;
  }): Promise<{ id: string; number: string }> {
    const customerId = opts.customerId ?? null;
    const total = opts.totalCents ?? 10000;
    const placedAt = (opts.placedAt ?? new Date()).toISOString();
    const rows = await migratorClient<{ id: string; number: string }[]>`
      INSERT INTO orders (
        store_id, number, customer_id, email, status, payment_status,
        currency, subtotal_cents, total_cents, placed_at
      ) VALUES (
        ${tenant.storeId},
        mint_order_number(${tenant.storeSlug}),
        ${customerId},
        ${opts.email},
        'paid', 'paid',
        'INR', ${total}, ${total}, ${placedAt}::timestamptz
      )
      RETURNING id, number
    `;
    const row = rows[0]!;
    await migratorClient`
      INSERT INTO order_items (
        order_id, store_id, variant_id, sku, name, qty, unit_price_cents, line_total_cents
      ) VALUES (
        ${row.id}, ${tenant.storeId}, ${tenant.variantA.variantId},
        ${tenant.variantA.sku}, 'Test', 1, ${total}, ${total}
      )
    `;
    return row;
  }

  async function seedUserSession(): Promise<{ userId: string; sessionId: string }> {
    const email = `order-user-${crypto.randomUUID().slice(0, 6)}@test.local`;
    const userRows = await migratorClient<{ id: string }[]>`
      INSERT INTO users (email, password_hash)
      VALUES (${email}, 'fake-hash')
      RETURNING id
    `;
    const userId = userRows[0]!.id;
    // Seed a matching customer row whose id equals the user id, so the
    // legacy cart→order flow (which puts userSession.userId into
    // orders.customer_id) satisfies the SP-5 FK to customers.id.
    await migratorClient`
      INSERT INTO customers (id, store_id, user_id, email)
      VALUES (${userId}, ${tenant.storeId}, ${userId}, ${email})
    `;
    const sessionId = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 86400_000).toISOString();
    await migratorClient`
      INSERT INTO sessions (id, user_id, expires_at)
      VALUES (${sessionId}, ${userId}, ${expiresAt}::timestamptz)
    `;
    return { userId, sessionId };
  }

  it('guest GET /orders/[number]?email matches → returns order', async () => {
    const order = await seedOrder({ email: 'guest@test.local' });
    const req = new Request(
      `http://test/api/v1/orders/${order.number}?email=guest@test.local`,
      { method: 'GET', headers: { 'x-store-host': host } },
    );
    const res = await getOrderByNumber(req, {
      params: Promise.resolve({ number: order.number }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as OrderResp;
    expect(body.data.order.number).toBe(order.number);
    expect(body.data.items).toHaveLength(1);
  });

  it('guest GET with wrong email returns 404', async () => {
    const order = await seedOrder({ email: 'right@test.local' });
    const req = new Request(
      `http://test/api/v1/orders/${order.number}?email=wrong@test.local`,
      { method: 'GET', headers: { 'x-store-host': host } },
    );
    const res = await getOrderByNumber(req, {
      params: Promise.resolve({ number: order.number }),
    });
    expect(res.status).toBe(404);
  });

  it('customer GET own order works', async () => {
    const { userId, sessionId } = await seedUserSession();
    const order = await seedOrder({
      email: 'customer@test.local',
      customerId: userId,
    });
    const req = new Request(`http://test/api/v1/orders/${order.number}`, {
      method: 'GET',
      headers: {
        'x-store-host': host,
        cookie: `${SESSION_COOKIE}=${sign(sessionId)}`,
      },
    });
    const res = await getOrderByNumber(req, {
      params: Promise.resolve({ number: order.number }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as OrderResp;
    expect(body.data.order.customerId).toBe(userId);
  });

  it("customer GET another customer's order returns 404", async () => {
    const a = await seedUserSession();
    const b = await seedUserSession();
    // Order belongs to user A.
    const order = await seedOrder({
      email: 'a@test.local',
      customerId: a.userId,
    });
    // User B tries to fetch it.
    const req = new Request(`http://test/api/v1/orders/${order.number}`, {
      method: 'GET',
      headers: {
        'x-store-host': host,
        cookie: `${SESSION_COOKIE}=${sign(b.sessionId)}`,
      },
    });
    const res = await getOrderByNumber(req, {
      params: Promise.resolve({ number: order.number }),
    });
    expect(res.status).toBe(404);
  });

  it('customer order list paginates by placed_at desc, cursor walks all pages', async () => {
    const { userId, sessionId } = await seedUserSession();
    // Seed 7 orders for this user, each placed 1s apart so order is stable.
    const now = Date.now();
    for (let i = 0; i < 7; i++) {
      await seedOrder({
        email: 'list@test.local',
        customerId: userId,
        placedAt: new Date(now - (7 - i) * 1000),
      });
    }

    const limit = 3;
    const collected: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    while (true) {
      const url = new URL('http://test/api/v1/customer/orders');
      url.searchParams.set('limit', String(limit));
      if (cursor !== undefined) url.searchParams.set('after', cursor);
      const req = new Request(url.toString(), {
        method: 'GET',
        headers: {
          'x-store-host': host,
          cookie: `${SESSION_COOKIE}=${sign(sessionId)}`,
        },
      });
      const res = await listCustomerOrdersGet(req);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: Array<{ number: string }>;
        page: { nextCursor: string | null };
      };
      pages++;
      for (const o of body.data) collected.push(o.number);
      if (!body.page.nextCursor) break;
      cursor = body.page.nextCursor;
      if (pages > 5) throw new Error('pagination did not terminate');
    }
    expect(collected.length).toBe(7);
    expect(new Set(collected).size).toBe(7);
  });
});
