/**
 * Order state-machine — TRANSITIONS map + DB trigger belt-and-braces.
 *
 * Verifies the canonical allowed hops:
 *   pending_payment → paid
 *   paid            → fulfilled
 *   fulfilled       → completed
 *
 * And the rejections:
 *   pending_payment → completed (illegal — multi-hop, not in map)
 *
 * Also: same-status `transitionOrder` is a no-op (no order_event / outbox
 * rows written). And the DB trigger `orders_status_transition_check` raises
 * when a caller bypasses `transitionOrder` and rewrites status via raw SQL —
 * proving the trigger is the floor that catches anything bypassing the TS
 * helper.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { resetAndMigrate } from './_setup/db';
import { appClient, migratorClient } from '@/db/client';
import { withTenant } from '@/modules/tenant/with-tenant';
import { transitionOrder, TRANSITIONS } from '@/modules/orders/lifecycle';
import { InvalidOrderTransitionError } from '@/modules/orders/errors';
import { orders } from '@/db/schema/orders';
import { orderEvents } from '@/db/schema/audit';
import { outboxEvents } from '@/db/schema/webhooks';
import { createPaidOrder, SYSTEM_ACTOR } from './_setup/order-fixtures';

describe('order state machine', () => {
  beforeAll(async () => {
    await resetAndMigrate();
  });

  afterAll(async () => {
    await appClient.end();
    await migratorClient.end();
  });

  it('TRANSITIONS map is the documented set', () => {
    // Self-test guard: if someone widens the state machine, they need to
    // update this test alongside the SQL trigger in 0018.
    expect(TRANSITIONS.pending_payment).toEqual(['paid', 'cancelled']);
    expect(TRANSITIONS.paid).toEqual(['fulfilled', 'cancelled', 'refunded']);
    expect(TRANSITIONS.fulfilled).toEqual(['completed', 'refunded']);
    expect(TRANSITIONS.completed).toEqual(['refunded']);
    expect(TRANSITIONS.refunded).toEqual([]);
    expect(TRANSITIONS.cancelled).toEqual([]);
  });

  it('valid hop pending_payment → paid → fulfilled → completed', async () => {
    const f = await createPaidOrder({ slug: 'sm-valid' });

    // Roll the order back to 'pending_payment' via migrator (bypass trigger)
    // so we can walk the whole happy path. The trigger blocks backwards hops,
    // so we use a direct UPDATE with the trigger disabled momentarily.
    await migratorClient`
      ALTER TABLE orders DISABLE TRIGGER orders_status_transition
    `;
    await migratorClient`
      UPDATE orders SET status = 'pending_payment', payment_status = 'pending'
      WHERE id = ${f.orderId}
    `;
    await migratorClient`
      ALTER TABLE orders ENABLE TRIGGER orders_status_transition
    `;

    const r1 = await transitionOrder(f.storeId, f.orderId, 'paid', SYSTEM_ACTOR);
    expect(r1.order.status).toBe('paid');
    expect(r1.order.paymentStatus).toBe('paid');
    expect(r1.eventId).not.toBe('');
    expect(r1.outboxEventId).not.toBe('');

    const r2 = await transitionOrder(f.storeId, f.orderId, 'fulfilled', SYSTEM_ACTOR);
    expect(r2.order.status).toBe('fulfilled');

    const r3 = await transitionOrder(f.storeId, f.orderId, 'completed', SYSTEM_ACTOR);
    expect(r3.order.status).toBe('completed');
  });

  it('invalid hop pending_payment → completed throws InvalidOrderTransitionError', async () => {
    const f = await createPaidOrder({ slug: 'sm-invalid' });

    // Force the order back to pending_payment first.
    await migratorClient`
      ALTER TABLE orders DISABLE TRIGGER orders_status_transition
    `;
    await migratorClient`
      UPDATE orders SET status = 'pending_payment', payment_status = 'pending'
      WHERE id = ${f.orderId}
    `;
    await migratorClient`
      ALTER TABLE orders ENABLE TRIGGER orders_status_transition
    `;

    await expect(
      transitionOrder(f.storeId, f.orderId, 'completed', SYSTEM_ACTOR),
    ).rejects.toBeInstanceOf(InvalidOrderTransitionError);

    // The order status must NOT have moved.
    const rows = await migratorClient<{ status: string }[]>`
      SELECT status FROM orders WHERE id = ${f.orderId}
    `;
    expect(rows[0]?.status).toBe('pending_payment');
  });

  it('DB trigger raises when transitionOrder is bypassed', async () => {
    const f = await createPaidOrder({ slug: 'sm-trigger' });

    // Force back to pending_payment.
    await migratorClient`
      ALTER TABLE orders DISABLE TRIGGER orders_status_transition
    `;
    await migratorClient`
      UPDATE orders SET status = 'pending_payment', payment_status = 'pending'
      WHERE id = ${f.orderId}
    `;
    await migratorClient`
      ALTER TABLE orders ENABLE TRIGGER orders_status_transition
    `;

    // Direct UPDATE via migrator → trigger sees pending_payment → completed
    // (illegal) and RAISEs. migratorClient propagates the postgres error.
    await expect(
      migratorClient`
        UPDATE orders SET status = 'completed' WHERE id = ${f.orderId}
      `,
    ).rejects.toThrow(/invalid order status transition/i);
  });

  it('same-status transitionOrder is a no-op (no event / outbox rows)', async () => {
    const f = await createPaidOrder({ slug: 'sm-noop' });

    // Fixture leaves the order in 'paid'. Count events / outbox entries first.
    const beforeEvents = await migratorClient<{ count: string }[]>`
      SELECT count(*)::text AS count FROM order_events WHERE order_id = ${f.orderId}
    `;
    const beforeOutbox = await migratorClient<{ count: string }[]>`
      SELECT count(*)::text AS count FROM outbox_events WHERE store_id = ${f.storeId}
    `;

    const result = await transitionOrder(f.storeId, f.orderId, 'paid', SYSTEM_ACTOR);
    expect(result.order.status).toBe('paid');
    expect(result.eventId).toBe('');
    expect(result.outboxEventId).toBe('');

    const afterEvents = await migratorClient<{ count: string }[]>`
      SELECT count(*)::text AS count FROM order_events WHERE order_id = ${f.orderId}
    `;
    const afterOutbox = await migratorClient<{ count: string }[]>`
      SELECT count(*)::text AS count FROM outbox_events WHERE store_id = ${f.storeId}
    `;
    expect(afterEvents[0]?.count).toBe(beforeEvents[0]?.count);
    expect(afterOutbox[0]?.count).toBe(beforeOutbox[0]?.count);

    // Sanity check via the ORM that we actually queried the right rows.
    const eventCount = await withTenant(f.storeId, async tx =>
      tx.select().from(orderEvents).where(eq(orderEvents.orderId, f.orderId)),
    );
    expect(eventCount.length).toBe(Number(beforeEvents[0]?.count ?? '0'));
    const outboxRows = await withTenant(f.storeId, async tx =>
      tx.select().from(outboxEvents).where(eq(outboxEvents.storeId, f.storeId)),
    );
    expect(outboxRows.length).toBe(Number(beforeOutbox[0]?.count ?? '0'));
    const ordersRows = await withTenant(f.storeId, async tx =>
      tx.select().from(orders).where(eq(orders.id, f.orderId)),
    );
    expect(ordersRows[0]?.status).toBe('paid');
  });
});
