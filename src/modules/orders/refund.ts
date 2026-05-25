/**
 * Refund module — partial or full refunds against a paid order.
 *
 * Flow:
 *   1. `createRefund` validates the requested amount against the remaining
 *      refundable balance (order.totalCents minus sum of pending + succeeded
 *      refunds), then PERSISTS a `refunds` row with status='pending' plus the
 *      per-line `refund_items` allocations inside a single `withTenant` tx.
 *      The order's `order_events` row 'refund.created' is appended in the
 *      same tx. Outbox is NOT written here — we wait for the provider's
 *      success acknowledgement (or webhook) before announcing a refund.
 *   2. After that tx commits, we call `provider.refundPayment(providerRef,
 *      amount, { idempotencyKey: refund.id })` OUTSIDE the database
 *      transaction. The network call must not hold a DB connection.
 *   3. On provider success: `applyRefundSucceeded` runs in a fresh tx —
 *      flips the refund to 'succeeded', writes the provider ref, appends
 *      'refund.succeeded' to the timeline, transitions the order to
 *      'refunded' WHEN the total succeeded refund amount covers the full
 *      order total, and emits `order.refunded` via the outbox.
 *   4. On provider failure: the refund row is flipped to 'failed' in a
 *      compensating tx (also append 'refund.failed' to the timeline) and a
 *      typed `RefundFailedError` is surfaced to the caller.
 *
 * Concurrency choice: the network call sits between two transactions because
 * holding a connection across a multi-second HTTPS round-trip is a pool-killer
 * — and the refund row's persisted 'pending' status is the recovery anchor.
 * If the process dies between (2) and (3), a future poll/webhook can drive
 * the refund to its terminal state via `applyRefundSucceeded` or the
 * compensating failure path. The provider call uses the refund row's UUID as
 * its idempotency key so a retry is safe.
 *
 * `applyRefundSucceeded` is exported for the SP-4 webhook handler (and the
 * polling worker in Stream H) — it is the ONLY in-process way to flip a
 * refund to 'succeeded' from outside this file.
 */

import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { PostgresJsTransaction } from 'drizzle-orm/postgres-js';
import { withTenant } from '@/modules/tenant/with-tenant';
import { orders, orderItems } from '@/db/schema/orders';
import { payments } from '@/db/schema/payments';
import { refunds, refundItems } from '@/db/schema/refunds';
import { getPaymentProvider, type ProviderName } from '@/modules/payments/provider';
import { appendOrderEvent, type OrderEventActor } from './events';
import { transitionOrderTx } from './lifecycle';
import {
  OrderNotFoundError,
  RefundAmountExceededError,
  RefundFailedError,
} from './errors';

type Tx = PostgresJsTransaction<Record<string, never>, Record<string, never>>;

export type RefundRow = typeof refunds.$inferSelect;
export type RefundItemRow = typeof refundItems.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;

export type CreateRefundInput = {
  orderId: string;
  items: Array<{ orderItemId: string; qty: number; amountCents: number }>;
  reason?: string;
  actor: OrderEventActor;
};

export type CreateRefundResult = {
  refund: RefundRow;
  items: RefundItemRow[];
  /** True when the refund has been driven to 'succeeded' by this call. */
  succeeded: boolean;
  /** Set when `succeeded` and the order's total refund hits order.totalCents. */
  orderRefunded: boolean;
};

export async function createRefund(
  storeId: string,
  input: CreateRefundInput,
): Promise<CreateRefundResult> {
  if (input.items.length === 0) {
    throw new Error('createRefund: items must be non-empty');
  }
  for (const it of input.items) {
    if (it.qty <= 0) {
      throw new Error(
        `createRefund: qty must be positive (order_item=${it.orderItemId})`,
      );
    }
    if (it.amountCents <= 0) {
      throw new Error(
        `createRefund: amountCents must be positive (order_item=${it.orderItemId})`,
      );
    }
  }
  const requestedCents = input.items.reduce((s, it) => s + it.amountCents, 0);

  // ── Step 1: persist 'pending' refund + items inside one tx.
  const persisted = await withTenant(storeId, async tx => {
    const orderRows = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, input.orderId))
      .limit(1);
    const order = orderRows[0];
    if (!order) throw new OrderNotFoundError(input.orderId);

    // Validate every requested order_item belongs to this order.
    const requestedIds = input.items.map(it => it.orderItemId);
    const orderItemRows = await tx
      .select({ id: orderItems.id, qty: orderItems.qty })
      .from(orderItems)
      .where(
        and(
          eq(orderItems.orderId, input.orderId),
          inArray(orderItems.id, requestedIds),
        ),
      );
    const orderItemIds = new Set(orderItemRows.map(r => r.id));
    for (const it of input.items) {
      if (!orderItemIds.has(it.orderItemId)) {
        throw new OrderNotFoundError(`order_item=${it.orderItemId}`);
      }
    }

    // Compute available refundable balance: order.totalCents minus the sum
    // of every refund row that is NOT 'failed' (pending counts because the
    // provider call may still succeed and we don't want concurrent callers
    // to double-allocate). RLS scopes us to the tenant.
    const sumRows = await tx
      .select({
        sumCents: sql<number>`COALESCE(SUM(${refunds.amountCents}), 0)::int`.as('sum_cents'),
      })
      .from(refunds)
      .where(
        and(
          eq(refunds.orderId, input.orderId),
          ne(refunds.status, 'failed'),
        ),
      );
    const alreadyAllocated = sumRows[0]?.sumCents ?? 0;
    const availableCents = order.totalCents - alreadyAllocated;
    if (requestedCents > availableCents) {
      throw new RefundAmountExceededError(
        input.orderId,
        requestedCents,
        availableCents,
      );
    }

    // Resolve the payment row for this order. Manual / store-credit refunds
    // can be supported by leaving paymentId null, but the provider call path
    // requires a captured payment, so we 404 if there is none.
    const paymentRows = await tx
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.orderId, input.orderId),
          eq(payments.status, 'succeeded'),
        ),
      )
      .orderBy(payments.createdAt)
      .limit(1);
    const payment = paymentRows[0] ?? null;
    if (!payment) {
      throw new OrderNotFoundError(
        `no succeeded payment for order=${input.orderId}`,
      );
    }
    if (!payment.providerRef) {
      throw new OrderNotFoundError(
        `payment ${payment.id} has no providerRef`,
      );
    }

    const insertedRefunds = await tx
      .insert(refunds)
      .values({
        storeId,
        orderId: input.orderId,
        paymentId: payment.id,
        amountCents: requestedCents,
        reason: input.reason ?? null,
        status: 'pending',
      })
      .returning();
    const refund = insertedRefunds[0];
    if (!refund) throw new Error('refunds insert returned no row');

    const refundItemValues = input.items.map(it => ({
      refundId: refund.id,
      orderItemId: it.orderItemId,
      qty: it.qty,
      amountCents: it.amountCents,
    }));
    const insertedItems = await tx
      .insert(refundItems)
      .values(refundItemValues)
      .returning();

    await appendOrderEvent(
      tx,
      storeId,
      input.orderId,
      'refund.created',
      input.actor,
      {
        refundId: refund.id,
        amountCents: requestedCents,
        items: input.items,
        reason: input.reason ?? null,
      },
    );

    return { refund, items: insertedItems, payment, orderTotalCents: order.totalCents };
  });

  // ── Step 2: provider call OUTSIDE any DB tx. Idempotency key = refund.id.
  let providerRefundRef: string;
  let providerRaw: Record<string, unknown>;
  try {
    const provider = await getPaymentProvider(
      persisted.payment.provider as ProviderName,
    );
    const result = await provider.refundPayment(
      persisted.payment.providerRef as string,
      requestedCents,
      { idempotencyKey: persisted.refund.id },
    );
    providerRefundRef = result.providerRef;
    providerRaw = result.raw;
  } catch (err) {
    // ── Step 4: compensating tx — flip to 'failed' and emit timeline.
    await withTenant(storeId, async tx => {
      await tx
        .update(refunds)
        .set({ status: 'failed', raw: { error: String(err) } })
        .where(eq(refunds.id, persisted.refund.id));
      await appendOrderEvent(
        tx,
        storeId,
        input.orderId,
        'refund.failed',
        input.actor,
        { refundId: persisted.refund.id, error: String(err) },
      );
    });
    throw new RefundFailedError(persisted.refund.id, err);
  }

  // ── Step 3: success — flip to 'succeeded' and (maybe) transition order.
  const applied = await applyRefundSucceededInternal(
    storeId,
    persisted.refund.id,
    providerRefundRef,
    providerRaw,
    input.actor,
  );

  return {
    refund: applied.refund,
    items: persisted.items,
    succeeded: true,
    orderRefunded: applied.orderRefunded,
  };
}

export type ApplyRefundSucceededResult = {
  refund: RefundRow;
  orderRefunded: boolean;
};

/**
 * Drive a refund row to 'succeeded' status. Called by `createRefund` after a
 * successful provider call AND by the SP-4 webhook handler when a refund
 * confirmation arrives asynchronously. Idempotent: if the refund is already
 * 'succeeded', this is a no-op.
 */
export async function applyRefundSucceeded(
  storeId: string,
  refundId: string,
  providerRef: string,
  raw?: Record<string, unknown>,
  actor?: OrderEventActor,
): Promise<ApplyRefundSucceededResult> {
  const resolvedActor: OrderEventActor = actor ?? {
    actorType: 'webhook',
    actorId: null,
  };
  return applyRefundSucceededInternal(
    storeId,
    refundId,
    providerRef,
    raw ?? null,
    resolvedActor,
  );
}

async function applyRefundSucceededInternal(
  storeId: string,
  refundId: string,
  providerRef: string,
  raw: Record<string, unknown> | null,
  actor: OrderEventActor,
): Promise<ApplyRefundSucceededResult> {
  return withTenant(storeId, async tx => {
    const existing = await tx
      .select()
      .from(refunds)
      .where(eq(refunds.id, refundId))
      .limit(1);
    const refund = existing[0];
    if (!refund) throw new OrderNotFoundError(`refund=${refundId}`);

    // Idempotent: already-succeeded refund returns its current row, no event.
    if (refund.status === 'succeeded') {
      const orderRefunded = await isOrderFullyRefundedTx(tx, refund.orderId);
      return { refund, orderRefunded };
    }

    const updated = await tx
      .update(refunds)
      .set({
        status: 'succeeded',
        providerRef,
        ...(raw !== null ? { raw } : {}),
      })
      .where(eq(refunds.id, refundId))
      .returning();
    const next = updated[0];
    if (!next) throw new OrderNotFoundError(`refund=${refundId}`);

    await appendOrderEvent(
      tx,
      storeId,
      refund.orderId,
      'refund.succeeded',
      actor,
      { refundId, providerRef, amountCents: refund.amountCents },
    );

    // Determine whether the cumulative succeeded refund amount covers the
    // order total. If so, transition the order to 'refunded' (which also
    // writes 'order.refunded' to the outbox via transitionOrderTx).
    const orderRefunded = await isOrderFullyRefundedTx(tx, refund.orderId);
    if (orderRefunded) {
      const orderRows = await tx
        .select({ status: orders.status })
        .from(orders)
        .where(eq(orders.id, refund.orderId))
        .limit(1);
      const currentStatus = orderRows[0]?.status;
      if (currentStatus && currentStatus !== 'refunded' && currentStatus !== 'cancelled') {
        await transitionOrderTx(
          tx,
          storeId,
          refund.orderId,
          'refunded',
          actor,
          { refundId, totalRefundedCents: refund.amountCents },
        );
      }
    }

    return { refund: next, orderRefunded };
  });
}

/**
 * Returns true when the sum of every 'succeeded' refund for the order
 * matches (or exceeds) the order's totalCents. Reads inside the caller's tx.
 */
async function isOrderFullyRefundedTx(tx: Tx, orderId: string): Promise<boolean> {
  const orderRows = await tx
    .select({ totalCents: orders.totalCents })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  const total = orderRows[0]?.totalCents;
  if (total === undefined) return false;

  const sumRows = await tx
    .select({
      sumCents: sql<number>`COALESCE(SUM(${refunds.amountCents}), 0)::int`.as('sum_cents'),
    })
    .from(refunds)
    .where(
      and(eq(refunds.orderId, orderId), eq(refunds.status, 'succeeded')),
    );
  const succeededSum = sumRows[0]?.sumCents ?? 0;
  return succeededSum >= total;
}
