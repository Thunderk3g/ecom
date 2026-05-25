/**
 * SP-5 RLS isolation across order lifecycle tables.
 *
 * Two stores A and B each have an order with a fulfillment, a refund, an
 * order_event, and a webhook subscription. Under `withTenant(A)`:
 *   - SELECT on orders / fulfillments / refunds / order_events / webhooks
 *     only returns A's rows.
 *   - UPDATE on order_events affects 0 rows (append-only — `no_update FOR
 *     UPDATE USING(false)` policy).
 *
 * Sanity: migrator (BYPASSRLS) sees BOTH stores' rows in every table so we
 * know the data really is there — the missing rows under tenant A are the
 * result of RLS filtering, not a fixture bug.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { resetAndMigrate } from './_setup/db';
import { appClient, migratorClient } from '@/db/client';
import { withTenant } from '@/modules/tenant/with-tenant';
import { createPaidOrder, SYSTEM_ACTOR } from './_setup/order-fixtures';
import { createFulfillment } from '@/modules/orders/fulfillment';
import { createRefund } from '@/modules/orders/refund';
import {
  installFakePaymentProviders,
} from './_setup/fake-payment-provider';

describe('SP-5 RLS isolation', () => {
  let uninstall: () => void;
  let storeA: string;
  let storeB: string;
  let orderA: string;
  let orderB: string;

  beforeAll(async () => {
    await resetAndMigrate();
    const installed = installFakePaymentProviders();
    uninstall = installed.uninstall;

    const a = await createPaidOrder({ slug: 'rls-a' });
    const b = await createPaidOrder({ slug: 'rls-b' });
    storeA = a.storeId;
    storeB = b.storeId;
    orderA = a.orderId;
    orderB = b.orderId;

    // Seed a fulfillment + refund + order_event in each store. createRefund
    // calls the fake provider which is now installed.
    await createFulfillment(storeA, {
      orderId: a.orderId,
      items: [{ orderItemId: a.orderItemId, qty: 1 }],
      actor: SYSTEM_ACTOR,
    });
    await createFulfillment(storeB, {
      orderId: b.orderId,
      items: [{ orderItemId: b.orderItemId, qty: 1 }],
      actor: SYSTEM_ACTOR,
    });
    await createRefund(storeA, {
      orderId: a.orderId,
      items: [{ orderItemId: a.orderItemId, qty: 1, amountCents: 10000 }],
      actor: SYSTEM_ACTOR,
    });
    await createRefund(storeB, {
      orderId: b.orderId,
      items: [{ orderItemId: b.orderItemId, qty: 1, amountCents: 10000 }],
      actor: SYSTEM_ACTOR,
    });

    // Seed a webhook subscription in each store via migratorClient (RLS would
    // otherwise require withTenant).
    await migratorClient`
      INSERT INTO webhooks (store_id, url, secret, topics, status)
      VALUES (${storeA}, 'http://a.example/hook', 'sec-a', ARRAY['order.paid']::text[], 'active')
    `;
    await migratorClient`
      INSERT INTO webhooks (store_id, url, secret, topics, status)
      VALUES (${storeB}, 'http://b.example/hook', 'sec-b', ARRAY['order.paid']::text[], 'active')
    `;
  });

  afterAll(async () => {
    uninstall();
    await appClient.end();
    await migratorClient.end();
  });

  it('orders: tenant A cannot see store B orders', async () => {
    const rows = await withTenant(storeA, async tx =>
      tx.execute(sql`SELECT id, store_id FROM orders`),
    );
    const list = rows as unknown as { id: string; store_id: string }[];
    expect(list.length).toBeGreaterThanOrEqual(1);
    for (const r of list) expect(r.store_id).toBe(storeA);
    expect(list.find(r => r.id === orderB)).toBeUndefined();
  });

  it('fulfillments: tenant A cannot see store B fulfillments', async () => {
    const rows = await withTenant(storeA, async tx =>
      tx.execute(sql`SELECT id, store_id FROM fulfillments`),
    );
    const list = rows as unknown as { id: string; store_id: string }[];
    for (const r of list) expect(r.store_id).toBe(storeA);

    // Cross-check: B's rows DO exist (visible to migrator).
    const all = await migratorClient<{ store_id: string }[]>`
      SELECT store_id FROM fulfillments WHERE store_id = ${storeB}
    `;
    expect(all.length).toBeGreaterThanOrEqual(1);
  });

  it('refunds: tenant A cannot see store B refunds', async () => {
    const rows = await withTenant(storeA, async tx =>
      tx.execute(sql`SELECT id, store_id FROM refunds`),
    );
    const list = rows as unknown as { id: string; store_id: string }[];
    for (const r of list) expect(r.store_id).toBe(storeA);

    const all = await migratorClient<{ store_id: string }[]>`
      SELECT store_id FROM refunds WHERE store_id = ${storeB}
    `;
    expect(all.length).toBeGreaterThanOrEqual(1);
  });

  it('order_events: tenant A cannot see store B events', async () => {
    const rows = await withTenant(storeA, async tx =>
      tx.execute(sql`SELECT id, store_id, order_id FROM order_events`),
    );
    const list = rows as unknown as {
      id: string;
      store_id: string;
      order_id: string;
    }[];
    expect(list.length).toBeGreaterThanOrEqual(1);
    for (const r of list) {
      expect(r.store_id).toBe(storeA);
      expect(r.order_id).toBe(orderA);
    }
  });

  it('webhooks: tenant A cannot see store B subscriptions', async () => {
    const rows = await withTenant(storeA, async tx =>
      tx.execute(sql`SELECT id, store_id FROM webhooks`),
    );
    const list = rows as unknown as { id: string; store_id: string }[];
    expect(list.length).toBeGreaterThanOrEqual(1);
    for (const r of list) expect(r.store_id).toBe(storeA);
  });

  it('UPDATE on order_events affects 0 rows (append-only policy)', async () => {
    // The `no_update USING(false)` policy filters every row out of the
    // UPDATE candidate set, so the rewrite affects 0 rows (no exception).
    const result = await withTenant(storeA, async tx =>
      tx.execute(
        sql`UPDATE order_events SET kind = 'tampered' WHERE store_id = ${storeA} RETURNING id`,
      ),
    );
    const updated = result as unknown as { id: string }[];
    expect(updated).toHaveLength(0);

    // Sanity: rows still carry their original kinds.
    const tampered = await migratorClient<{ kind: string }[]>`
      SELECT kind FROM order_events WHERE store_id = ${storeA} AND kind = 'tampered'
    `;
    expect(tampered).toHaveLength(0);
  });
});
