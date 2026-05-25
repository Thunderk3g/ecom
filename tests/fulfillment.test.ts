/**
 * Fulfillment flow — partial → fulfilled → shipped → delivered → completed.
 *
 * Order has 2 of item A and 1 of item B (subtotal 25000c). Fulfill A=1 first:
 *   - fulfillment_status → 'partial'
 *   - order.status stays 'paid'
 * Then fulfill A=1 and B=1:
 *   - fulfillment_status → 'fulfilled'
 *   - order.status → 'fulfilled' (transitionOrder fired inside createFulfillment)
 * Then markShipped on either fulfillment:
 *   - fulfillment.status → 'shipped'
 *   - matching shipment also flipped
 * Then markDelivered on each fulfillment in turn:
 *   - fulfillment.status → 'delivered'
 *   - when ALL fulfillments delivered AND order is 'fulfilled' →
 *     order.status → 'completed'
 *
 * Plus: FulfillmentItemQtyExceededError when caller asks for more than the
 * unfulfilled remainder.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { resetAndMigrate } from './_setup/db';
import { appClient, migratorClient } from '@/db/client';
import { withTenant } from '@/modules/tenant/with-tenant';
import {
  createFulfillment,
  markShipped,
  markDelivered,
} from '@/modules/orders/fulfillment';
import { FulfillmentItemQtyExceededError } from '@/modules/orders/errors';
import { orders } from '@/db/schema/orders';
import { fulfillments } from '@/db/schema/fulfillment';
import { createPaidOrder, SYSTEM_ACTOR } from './_setup/order-fixtures';

describe('fulfillment flow', () => {
  beforeAll(async () => {
    await resetAndMigrate();
  });

  afterAll(async () => {
    await appClient.end();
    await migratorClient.end();
  });

  it('partial → fulfilled and order.status transitions on close-out', async () => {
    // Default fixture: A qty=2, B qty=1
    const f = await createPaidOrder({ slug: 'ff-partial' });

    // First fulfillment: cover 1 of A. Should leave order in (partial, paid).
    const r1 = await createFulfillment(f.storeId, {
      orderId: f.orderId,
      items: [{ orderItemId: f.orderItemId, qty: 1 }],
      trackingNumber: 'TRK1',
      carrier: 'fedex',
      actor: SYSTEM_ACTOR,
    });
    expect(r1.orderFullyFulfilled).toBe(false);
    expect(r1.fulfillmentItems).toHaveLength(1);

    const after1 = await withTenant(f.storeId, async tx =>
      tx.select().from(orders).where(eq(orders.id, f.orderId)),
    );
    expect(after1[0]?.fulfillmentStatus).toBe('partial');
    expect(after1[0]?.status).toBe('paid');

    // Second fulfillment: cover remaining 1 of A and 1 of B. Closes out the
    // order → fulfillment_status='fulfilled', order.status='fulfilled'.
    const r2 = await createFulfillment(f.storeId, {
      orderId: f.orderId,
      items: [
        { orderItemId: f.orderItemId, qty: 1 },
        { orderItemId: f.orderItemBId, qty: 1 },
      ],
      trackingNumber: 'TRK2',
      carrier: 'fedex',
      actor: SYSTEM_ACTOR,
    });
    expect(r2.orderFullyFulfilled).toBe(true);

    const after2 = await withTenant(f.storeId, async tx =>
      tx.select().from(orders).where(eq(orders.id, f.orderId)),
    );
    expect(after2[0]?.fulfillmentStatus).toBe('fulfilled');
    expect(after2[0]?.status).toBe('fulfilled');
  });

  it('markShipped sets fulfillment.status=shipped + records carrier/tracking', async () => {
    const f = await createPaidOrder({ slug: 'ff-shipped' });
    const r = await createFulfillment(f.storeId, {
      orderId: f.orderId,
      items: [
        { orderItemId: f.orderItemId, qty: 2 },
        { orderItemId: f.orderItemBId, qty: 1 },
      ],
      actor: SYSTEM_ACTOR,
    });
    expect(r.orderFullyFulfilled).toBe(true);

    const shipped = await markShipped(f.storeId, r.fulfillment.id, {
      trackingNumber: 'NEW-TRK',
      carrier: 'ups',
      actor: SYSTEM_ACTOR,
    });
    expect(shipped.fulfillment.status).toBe('shipped');
    expect(shipped.fulfillment.trackingNumber).toBe('NEW-TRK');
    expect(shipped.fulfillment.carrier).toBe('ups');
    expect(shipped.shipment?.status).toBe('shipped');
  });

  it('markDelivered: when all fulfillments delivered, order.status → completed', async () => {
    const f = await createPaidOrder({ slug: 'ff-completed' });

    // Single fulfillment covers the whole order.
    const r = await createFulfillment(f.storeId, {
      orderId: f.orderId,
      items: [
        { orderItemId: f.orderItemId, qty: 2 },
        { orderItemId: f.orderItemBId, qty: 1 },
      ],
      actor: SYSTEM_ACTOR,
    });

    // Ship first — markDelivered expects the prior shipment to be in 'shipped'
    // for the lockstep update.
    await markShipped(f.storeId, r.fulfillment.id, { actor: SYSTEM_ACTOR });

    const delivered = await markDelivered(
      f.storeId,
      r.fulfillment.id,
      SYSTEM_ACTOR,
    );
    expect(delivered.fulfillment.status).toBe('delivered');
    expect(delivered.shipment?.status).toBe('delivered');
    expect(delivered.orderCompleted).toBe(true);

    const o = await withTenant(f.storeId, async tx =>
      tx.select().from(orders).where(eq(orders.id, f.orderId)),
    );
    expect(o[0]?.status).toBe('completed');
  });

  it('FulfillmentItemQtyExceededError when qty > unfulfilled remainder', async () => {
    const f = await createPaidOrder({ slug: 'ff-overfill' });

    // Order has qty=2 of item A. Ask for 3 in one go → exceeded.
    await expect(
      createFulfillment(f.storeId, {
        orderId: f.orderId,
        items: [{ orderItemId: f.orderItemId, qty: 3 }],
        actor: SYSTEM_ACTOR,
      }),
    ).rejects.toBeInstanceOf(FulfillmentItemQtyExceededError);

    // Cover 2, then ask for one more (already fully fulfilled on that line).
    await createFulfillment(f.storeId, {
      orderId: f.orderId,
      items: [{ orderItemId: f.orderItemId, qty: 2 }],
      actor: SYSTEM_ACTOR,
    });
    await expect(
      createFulfillment(f.storeId, {
        orderId: f.orderId,
        items: [{ orderItemId: f.orderItemId, qty: 1 }],
        actor: SYSTEM_ACTOR,
      }),
    ).rejects.toBeInstanceOf(FulfillmentItemQtyExceededError);

    // Sanity: there is exactly one fulfillment row on this order.
    const rows = await withTenant(f.storeId, async tx =>
      tx
        .select()
        .from(fulfillments)
        .where(
          and(eq(fulfillments.orderId, f.orderId), eq(fulfillments.storeId, f.storeId)),
        ),
    );
    expect(rows).toHaveLength(1);
  });
});
