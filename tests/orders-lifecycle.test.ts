/**
 * Order lifecycle atomicity — `transitionOrder` writes the orders update,
 * the order_events row, and the outbox_events row inside the SAME tx.
 *
 * Two angles:
 *   1. Happy path: after a successful transition, exactly one new order_events
 *      row AND exactly one new outbox_events row exist, both correlating to
 *      the transition.
 *   2. Rollback: when a subsequent operation in the same tx fails, the entire
 *      tx (including the status update + events + outbox) must roll back.
 *      We manufacture a failure by appending an order_events row with a
 *      not-null violation inside a custom withTenant tx — the rollback
 *      must leave the order's status unchanged and no new event/outbox row
 *      visible.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { resetAndMigrate } from './_setup/db';
import { appClient, migratorClient } from '@/db/client';
import { withTenant } from '@/modules/tenant/with-tenant';
import { transitionOrder, transitionOrderTx } from '@/modules/orders/lifecycle';
import { orders } from '@/db/schema/orders';
import { orderEvents } from '@/db/schema/audit';
import { outboxEvents } from '@/db/schema/webhooks';
import { createPaidOrder, SYSTEM_ACTOR } from './_setup/order-fixtures';

describe('order lifecycle atomicity', () => {
  beforeAll(async () => {
    await resetAndMigrate();
  });

  afterAll(async () => {
    await appClient.end();
    await migratorClient.end();
  });

  it('successful transition commits order_event + outbox atomically', async () => {
    const f = await createPaidOrder({ slug: 'life-atomic' });

    const before = await migratorClient<{
      events: string;
      outbox: string;
    }[]>`
      SELECT
        (SELECT count(*)::text FROM order_events WHERE order_id = ${f.orderId}) AS events,
        (SELECT count(*)::text FROM outbox_events WHERE store_id = ${f.storeId}) AS outbox
    `;
    const beforeEvents = Number(before[0]?.events ?? '0');
    const beforeOutbox = Number(before[0]?.outbox ?? '0');

    const result = await transitionOrder(
      f.storeId,
      f.orderId,
      'fulfilled',
      SYSTEM_ACTOR,
      { reason: 'pack complete' },
    );

    expect(result.order.status).toBe('fulfilled');
    expect(result.eventId).not.toBe('');
    expect(result.outboxEventId).not.toBe('');

    const after = await migratorClient<{
      events: string;
      outbox: string;
    }[]>`
      SELECT
        (SELECT count(*)::text FROM order_events WHERE order_id = ${f.orderId}) AS events,
        (SELECT count(*)::text FROM outbox_events WHERE store_id = ${f.storeId}) AS outbox
    `;
    expect(Number(after[0]?.events ?? '0')).toBe(beforeEvents + 1);
    expect(Number(after[0]?.outbox ?? '0')).toBe(beforeOutbox + 1);

    // Verify topic / kind on the new rows.
    const event = await withTenant(f.storeId, async tx =>
      tx.select().from(orderEvents).where(eq(orderEvents.id, result.eventId)),
    );
    expect(event[0]?.kind).toBe('fulfilled');
    expect((event[0]?.payload as Record<string, unknown>)?.from).toBe('paid');
    expect((event[0]?.payload as Record<string, unknown>)?.to).toBe('fulfilled');

    const outbox = await withTenant(f.storeId, async tx =>
      tx.select().from(outboxEvents).where(eq(outboxEvents.id, result.outboxEventId)),
    );
    expect(outbox[0]?.topic).toBe('order.fulfilled');
    expect(outbox[0]?.status).toBe('pending');
  });

  it('rollback: tx failure after transition reverts status + event + outbox', async () => {
    const f = await createPaidOrder({ slug: 'life-rollback' });

    const before = await migratorClient<{
      events: string;
      outbox: string;
      status: string;
    }[]>`
      SELECT
        (SELECT count(*)::text FROM order_events WHERE order_id = ${f.orderId}) AS events,
        (SELECT count(*)::text FROM outbox_events WHERE store_id = ${f.storeId}) AS outbox,
        (SELECT status::text FROM orders WHERE id = ${f.orderId}) AS status
    `;
    const beforeEvents = Number(before[0]?.events ?? '0');
    const beforeOutbox = Number(before[0]?.outbox ?? '0');
    const beforeStatus = before[0]?.status;
    expect(beforeStatus).toBe('paid');

    // Open a withTenant tx, call transitionOrderTx, then deliberately
    // raise a constraint violation to force rollback. We INSERT into
    // order_events with a NULL `kind` — the column is NOT NULL so PG raises
    // 23502. The whole tx (transition + insert) must roll back.
    await expect(
      withTenant(f.storeId, async tx => {
        await transitionOrderTx(tx, f.storeId, f.orderId, 'fulfilled', SYSTEM_ACTOR);
        // Force a NOT NULL violation. We have to use raw SQL because the
        // drizzle insert builder won't let us pass null for a non-nullable
        // typed column.
        await tx.execute(sql`
          INSERT INTO order_events (store_id, order_id, kind, actor_type, payload)
          VALUES (${f.storeId}::uuid, ${f.orderId}::uuid, NULL, 'system', '{}'::jsonb)
        `);
      }),
    ).rejects.toBeDefined();

    const after = await migratorClient<{
      events: string;
      outbox: string;
      status: string;
    }[]>`
      SELECT
        (SELECT count(*)::text FROM order_events WHERE order_id = ${f.orderId}) AS events,
        (SELECT count(*)::text FROM outbox_events WHERE store_id = ${f.storeId}) AS outbox,
        (SELECT status::text FROM orders WHERE id = ${f.orderId}) AS status
    `;
    expect(Number(after[0]?.events ?? '0')).toBe(beforeEvents);
    expect(Number(after[0]?.outbox ?? '0')).toBe(beforeOutbox);
    expect(after[0]?.status).toBe('paid');

    // Sanity: the order is still transitionable from 'paid' (no half-state).
    const ordersRow = await withTenant(f.storeId, async tx =>
      tx.select().from(orders).where(eq(orders.id, f.orderId)),
    );
    expect(ordersRow[0]?.status).toBe('paid');
  });
});
