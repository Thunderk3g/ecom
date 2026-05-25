/**
 * Fulfillment — operational picking/packing and tracking.
 *
 * Three call sites here:
 *   - `createFulfillment`: admin packs N items against an order. Inserts the
 *     fulfillment + items rows AND a matching shipment + shipment_items pair
 *     (one-to-one in this stream — a future plan can split them when carriers
 *     can split a fulfillment across multiple shipments). Validates that
 *     each new line qty ≤ ordered qty minus the sum of prior fulfillment
 *     lines for the same order_item. Recomputes `orders.fulfillment_status`
 *     ('partial' / 'fulfilled') and, when the order is fully fulfilled,
 *     transitions it to 'fulfilled' and emits `order.fulfilled`.
 *   - `markShipped`: flips fulfillment + matching shipment to 'shipped',
 *     records tracking info, emits `order.shipped`.
 *   - `markDelivered`: flips to 'delivered', records `delivered_at`. When
 *     every fulfillment on the order is delivered, transitions the order to
 *     'completed' and emits `order.completed`.
 *
 * Tx model: every public function runs in one `withTenant` transaction so
 * the order-events / outbox / status update are atomic with the fulfillment
 * write. Same pattern as `transitionOrder`.
 *
 * Shipment relationship: this stream pairs one shipment per fulfillment with
 * the same items + qty. The shipment is the carrier-side record (carries
 * label_url etc.); the fulfillment is the operational record (status,
 * tracking_number). Keeping them in lockstep is the simplest correct
 * shape — a follow-up plan can decouple them when operations needs partial
 * shipments per fulfillment.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PostgresJsTransaction } from 'drizzle-orm/postgres-js';
import { withTenant } from '@/modules/tenant/with-tenant';
import { orders, orderItems } from '@/db/schema/orders';
import {
  fulfillments,
  fulfillmentItems,
  shipments,
  shipmentItems,
} from '@/db/schema/fulfillment';
import { outboxEvents } from '@/db/schema/webhooks';
import { appendOrderEvent, type OrderEventActor } from './events';
import { transitionOrderTx } from './lifecycle';
import {
  AlreadyFulfilledError,
  FulfillmentItemQtyExceededError,
  OrderNotFoundError,
} from './errors';

type Tx = PostgresJsTransaction<Record<string, never>, Record<string, never>>;

export type FulfillmentRow = typeof fulfillments.$inferSelect;
export type FulfillmentItemRow = typeof fulfillmentItems.$inferSelect;
export type ShipmentRow = typeof shipments.$inferSelect;
export type ShipmentItemRow = typeof shipmentItems.$inferSelect;

export type CreateFulfillmentInput = {
  orderId: string;
  items: Array<{ orderItemId: string; qty: number }>;
  trackingNumber?: string;
  carrier?: string;
  actor: OrderEventActor;
};

export type CreateFulfillmentResult = {
  fulfillment: FulfillmentRow;
  fulfillmentItems: FulfillmentItemRow[];
  shipment: ShipmentRow;
  shipmentItems: ShipmentItemRow[];
  /** True when this fulfillment closes out the last unfulfilled qty. */
  orderFullyFulfilled: boolean;
};

export async function createFulfillment(
  storeId: string,
  input: CreateFulfillmentInput,
): Promise<CreateFulfillmentResult> {
  if (input.items.length === 0) {
    throw new Error('createFulfillment: items must be non-empty');
  }
  for (const it of input.items) {
    if (it.qty <= 0) {
      throw new Error(
        `createFulfillment: qty must be positive (order_item=${it.orderItemId})`,
      );
    }
  }

  return withTenant(storeId, async tx => {
    // 1. Load order + items.
    const orderRows = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, input.orderId))
      .limit(1);
    const order = orderRows[0];
    if (!order) throw new OrderNotFoundError(input.orderId);

    const requestedIds = input.items.map(it => it.orderItemId);
    const orderItemRows = await tx
      .select()
      .from(orderItems)
      .where(
        and(
          eq(orderItems.orderId, input.orderId),
          inArray(orderItems.id, requestedIds),
        ),
      );
    const orderItemById = new Map(orderItemRows.map(r => [r.id, r]));
    for (const it of input.items) {
      if (!orderItemById.has(it.orderItemId)) {
        throw new OrderNotFoundError(`order_item=${it.orderItemId}`);
      }
    }

    // 2. Sum prior fulfillment qty per order_item (across ALL prior
    //    fulfillments for this order). RLS keeps us inside the tenant.
    const priorRows = await tx
      .select({
        orderItemId: fulfillmentItems.orderItemId,
        priorQty: sql<number>`COALESCE(SUM(${fulfillmentItems.qty}), 0)::int`.as(
          'prior_qty',
        ),
      })
      .from(fulfillmentItems)
      .innerJoin(
        fulfillments,
        eq(fulfillments.id, fulfillmentItems.fulfillmentId),
      )
      .where(eq(fulfillments.orderId, input.orderId))
      .groupBy(fulfillmentItems.orderItemId);
    const priorByItem = new Map(priorRows.map(r => [r.orderItemId, r.priorQty]));

    // 3. Validate each requested line.
    for (const it of input.items) {
      const orderItem = orderItemById.get(it.orderItemId)!;
      const prior = priorByItem.get(it.orderItemId) ?? 0;
      const remaining = orderItem.qty - prior;
      if (it.qty > remaining) {
        throw new FulfillmentItemQtyExceededError(
          it.orderItemId,
          it.qty,
          remaining,
        );
      }
    }

    // 4. Compute post-fulfillment totals to know if the order is fully
    //    covered. Sum ordered qty across ALL order_items; sum new prior+
    //    this-fulfillment for those covered.
    const allOrderItems = await tx
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, input.orderId));
    if (allOrderItems.length === 0) {
      throw new OrderNotFoundError(`order=${input.orderId} has no items`);
    }

    // Guard against double-finalising a fully-fulfilled order: if the
    // recomputed remaining is 0 across the board BEFORE this fulfillment
    // (and the caller still asked to fulfil something), flag the misuse.
    const totalOrderedQty = allOrderItems.reduce((s, r) => s + r.qty, 0);
    const totalPriorQty = allOrderItems.reduce(
      (s, r) => s + (priorByItem.get(r.id) ?? 0),
      0,
    );
    if (totalPriorQty >= totalOrderedQty) {
      throw new AlreadyFulfilledError(input.orderId);
    }

    // 5. INSERT fulfillment + items.
    const insertedFulfillments = await tx
      .insert(fulfillments)
      .values({
        storeId,
        orderId: input.orderId,
        status: 'pending',
        trackingNumber: input.trackingNumber ?? null,
        carrier: input.carrier ?? null,
      })
      .returning();
    const fulfillment = insertedFulfillments[0];
    if (!fulfillment) throw new Error('fulfillments insert returned no row');

    const fulfillmentItemValues = input.items.map(it => ({
      fulfillmentId: fulfillment.id,
      orderItemId: it.orderItemId,
      qty: it.qty,
    }));
    const insertedFulfillmentItems = await tx
      .insert(fulfillmentItems)
      .values(fulfillmentItemValues)
      .returning();

    // 6. INSERT matching shipment + items (one shipment per fulfillment in
    //    this stream — see header).
    const insertedShipments = await tx
      .insert(shipments)
      .values({
        storeId,
        orderId: input.orderId,
        status: 'pending',
        carrier: input.carrier ?? null,
        trackingNumber: input.trackingNumber ?? null,
      })
      .returning();
    const shipment = insertedShipments[0];
    if (!shipment) throw new Error('shipments insert returned no row');

    const shipmentItemValues = input.items.map(it => ({
      shipmentId: shipment.id,
      orderItemId: it.orderItemId,
      qty: it.qty,
    }));
    const insertedShipmentItems = await tx
      .insert(shipmentItems)
      .values(shipmentItemValues)
      .returning();

    // 7. Recompute order fulfillment_status.
    const newTotalFulfilledQty = totalPriorQty + input.items.reduce((s, it) => s + it.qty, 0);
    const fullyFulfilled = newTotalFulfilledQty >= totalOrderedQty;
    const nextFulfillmentStatus = fullyFulfilled ? 'fulfilled' : 'partial';

    await tx
      .update(orders)
      .set({ fulfillmentStatus: nextFulfillmentStatus })
      .where(eq(orders.id, input.orderId));

    // 8. Append timeline event.
    await appendOrderEvent(
      tx,
      storeId,
      input.orderId,
      'fulfillment.created',
      input.actor,
      {
        fulfillmentId: fulfillment.id,
        shipmentId: shipment.id,
        items: input.items,
        carrier: input.carrier ?? null,
        trackingNumber: input.trackingNumber ?? null,
        fullyFulfilled,
      },
    );

    // 9. When fully fulfilled, transition the order. transitionOrderTx writes
    //    its own order_event + outbox row inside the same tx.
    if (fullyFulfilled && order.status === 'paid') {
      await transitionOrderTx(
        tx,
        storeId,
        input.orderId,
        'fulfilled',
        input.actor,
        { fulfillmentId: fulfillment.id },
      );
    }

    return {
      fulfillment,
      fulfillmentItems: insertedFulfillmentItems,
      shipment,
      shipmentItems: insertedShipmentItems,
      orderFullyFulfilled: fullyFulfilled,
    };
  });
}

export type MarkShippedInput = {
  trackingNumber?: string;
  carrier?: string;
  actor: OrderEventActor;
};

export type MarkShippedResult = {
  fulfillment: FulfillmentRow;
  shipment: ShipmentRow | null;
};

/**
 * Flip a pending fulfillment (+ its matching shipment) to 'shipped'. Records
 * tracking info if provided. Emits an `order.shipped` outbox event and
 * appends a timeline event. Does NOT transition the order's status — the
 * order goes to 'fulfilled' when ALL items are fulfilled (see
 * `createFulfillment`), and 'completed' when ALL fulfillments are delivered
 * (see `markDelivered`).
 */
export async function markShipped(
  storeId: string,
  fulfillmentId: string,
  input: MarkShippedInput,
): Promise<MarkShippedResult> {
  return withTenant(storeId, async tx => {
    const existing = await tx
      .select()
      .from(fulfillments)
      .where(eq(fulfillments.id, fulfillmentId))
      .limit(1);
    const fulfillment = existing[0];
    if (!fulfillment) throw new OrderNotFoundError(`fulfillment=${fulfillmentId}`);

    const shippedAt = new Date();
    const updateValues: Partial<typeof fulfillments.$inferInsert> = {
      status: 'shipped',
      shippedAt,
    };
    if (input.trackingNumber !== undefined) {
      updateValues.trackingNumber = input.trackingNumber;
    }
    if (input.carrier !== undefined) {
      updateValues.carrier = input.carrier;
    }

    const updated = await tx
      .update(fulfillments)
      .set(updateValues)
      .where(eq(fulfillments.id, fulfillmentId))
      .returning();
    const nextFulfillment = updated[0];
    if (!nextFulfillment) throw new OrderNotFoundError(`fulfillment=${fulfillmentId}`);

    // Keep the paired shipment in lockstep (best-effort — if a future plan
    // decouples them this will become a separate API).
    const shipmentRows = await tx
      .select()
      .from(shipments)
      .where(
        and(
          eq(shipments.orderId, fulfillment.orderId),
          eq(shipments.status, 'pending'),
        ),
      )
      .orderBy(shipments.createdAt)
      .limit(1);
    let nextShipment: ShipmentRow | null = null;
    const pendingShipment = shipmentRows[0];
    if (pendingShipment) {
      const shipmentUpdate: Partial<typeof shipments.$inferInsert> = {
        status: 'shipped',
        shippedAt,
      };
      if (input.trackingNumber !== undefined) {
        shipmentUpdate.trackingNumber = input.trackingNumber;
      }
      if (input.carrier !== undefined) {
        shipmentUpdate.carrier = input.carrier;
      }
      const updatedShipment = await tx
        .update(shipments)
        .set(shipmentUpdate)
        .where(eq(shipments.id, pendingShipment.id))
        .returning();
      nextShipment = updatedShipment[0] ?? null;
    }

    await appendOrderEvent(
      tx,
      storeId,
      fulfillment.orderId,
      'fulfillment.shipped',
      input.actor,
      {
        fulfillmentId,
        shipmentId: nextShipment?.id ?? null,
        trackingNumber: nextFulfillment.trackingNumber,
        carrier: nextFulfillment.carrier,
        shippedAt: shippedAt.toISOString(),
      },
    );

    await tx.insert(outboxEvents).values({
      storeId,
      topic: 'order.shipped',
      payload: {
        orderId: fulfillment.orderId,
        fulfillmentId,
        trackingNumber: nextFulfillment.trackingNumber,
        carrier: nextFulfillment.carrier,
      },
    });

    return { fulfillment: nextFulfillment, shipment: nextShipment };
  });
}

export type MarkDeliveredResult = {
  fulfillment: FulfillmentRow;
  shipment: ShipmentRow | null;
  orderCompleted: boolean;
};

/**
 * Flip a shipped fulfillment (+ its matching shipment) to 'delivered'. When
 * every fulfillment on the order is delivered, transitions the order to
 * 'completed' and emits `order.completed`. Always emits `order.delivered`
 * for the fulfillment itself.
 */
export async function markDelivered(
  storeId: string,
  fulfillmentId: string,
  actor: OrderEventActor,
): Promise<MarkDeliveredResult> {
  return withTenant(storeId, async tx => {
    const existing = await tx
      .select()
      .from(fulfillments)
      .where(eq(fulfillments.id, fulfillmentId))
      .limit(1);
    const fulfillment = existing[0];
    if (!fulfillment) throw new OrderNotFoundError(`fulfillment=${fulfillmentId}`);

    const deliveredAt = new Date();
    const updated = await tx
      .update(fulfillments)
      .set({ status: 'delivered', deliveredAt })
      .where(eq(fulfillments.id, fulfillmentId))
      .returning();
    const nextFulfillment = updated[0];
    if (!nextFulfillment) throw new OrderNotFoundError(`fulfillment=${fulfillmentId}`);

    // Lockstep shipment.
    const shipmentRows = await tx
      .select()
      .from(shipments)
      .where(
        and(
          eq(shipments.orderId, fulfillment.orderId),
          eq(shipments.status, 'shipped'),
        ),
      )
      .orderBy(shipments.createdAt)
      .limit(1);
    let nextShipment: ShipmentRow | null = null;
    const shippedShipment = shipmentRows[0];
    if (shippedShipment) {
      const updatedShipment = await tx
        .update(shipments)
        .set({ status: 'delivered', deliveredAt })
        .where(eq(shipments.id, shippedShipment.id))
        .returning();
      nextShipment = updatedShipment[0] ?? null;
    }

    await appendOrderEvent(
      tx,
      storeId,
      fulfillment.orderId,
      'fulfillment.delivered',
      actor,
      {
        fulfillmentId,
        shipmentId: nextShipment?.id ?? null,
        deliveredAt: deliveredAt.toISOString(),
      },
    );

    await tx.insert(outboxEvents).values({
      storeId,
      topic: 'order.delivered',
      payload: {
        orderId: fulfillment.orderId,
        fulfillmentId,
        deliveredAt: deliveredAt.toISOString(),
      },
    });

    // Check whether every fulfillment for this order is now delivered.
    const allFulfillments = await tx
      .select({ status: fulfillments.status })
      .from(fulfillments)
      .where(eq(fulfillments.orderId, fulfillment.orderId));
    const allDelivered =
      allFulfillments.length > 0 &&
      allFulfillments.every(f => f.status === 'delivered');

    let orderCompleted = false;
    if (allDelivered) {
      // Order must be in 'fulfilled' for the trigger to allow 'completed'.
      const orderRows = await tx
        .select({ status: orders.status })
        .from(orders)
        .where(eq(orders.id, fulfillment.orderId))
        .limit(1);
      const currentStatus = orderRows[0]?.status;
      if (currentStatus === 'fulfilled') {
        await transitionOrderTx(
          tx,
          storeId,
          fulfillment.orderId,
          'completed',
          actor,
          { fulfillmentId },
        );
        orderCompleted = true;
      }
    }

    return {
      fulfillment: nextFulfillment,
      shipment: nextShipment,
      orderCompleted,
    };
  });
}
