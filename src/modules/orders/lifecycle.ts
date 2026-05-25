/**
 * Order state machine + admin list reads.
 *
 * `transitionOrder` is the single in-process source of truth for legal status
 * hops. The DB also enforces these via the `orders_status_transition_check`
 * trigger (migration 0018) — that's belt-and-braces against raw SQL or future
 * callers that bypass this helper. The TypeScript side checks FIRST so the
 * caller gets a typed `InvalidOrderTransitionError` instead of a postgres
 * exception bubbling up.
 *
 * Atomicity: the status update, the `order_events` row, and the
 * `outbox_events` row all commit inside the same `withTenant` tx. A downstream
 * worker drains the outbox and fans the event out to subscribed webhooks
 * (Stream H). Writing the outbox in the same tx guarantees we never emit a
 * webhook for a transition that didn't happen, and never silently swallow a
 * transition that happened but failed to emit.
 *
 * `listOrders` powers the admin orders index — cursor pagination matching the
 * project-wide shape (`?after=...&limit=`), filterable by status, payment
 * status, customer email, and a placed-at date range.
 */

import {
  and,
  desc,
  eq,
  gte,
  lt,
  lte,
  or,
  type SQL,
} from 'drizzle-orm';
import type { PostgresJsTransaction } from 'drizzle-orm/postgres-js';
import { withTenant } from '@/modules/tenant/with-tenant';
import { decodeCursor, encodeCursor, parseLimit } from '@/lib/cursor';
import { orders } from '@/db/schema/orders';
import { outboxEvents } from '@/db/schema/webhooks';
import {
  appendOrderEvent,
  type OrderEventActor,
  type OrderEventKind,
} from './events';
import {
  InvalidOrderTransitionError,
  OrderNotFoundError,
} from './errors';

type Tx = PostgresJsTransaction<Record<string, never>, Record<string, never>>;

export type OrderRow = typeof orders.$inferSelect;
export type OrderStatus = OrderRow['status'];
export type OrderPaymentStatus = OrderRow['paymentStatus'];

/**
 * Source-of-truth transition map. MUST stay in lockstep with the SQL trigger
 * `orders_status_transition_check` in migration 0018.
 */
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ['paid', 'cancelled'],
  paid: ['fulfilled', 'cancelled', 'refunded'],
  fulfilled: ['completed', 'refunded'],
  completed: ['refunded'],
  refunded: [],
  cancelled: [],
};

/**
 * Map a target `OrderStatus` to the canonical timeline event kind. Used both
 * by `transitionOrder` (which appends a row to `order_events`) and by the
 * outbox topic name (`order.<status>`).
 */
function eventKindForStatus(to: OrderStatus): OrderEventKind {
  return to;
}

/**
 * Outbox topic for a transition. Convention: `order.<status>` (e.g.
 * `order.paid`, `order.cancelled`). Stream H consumers subscribe to these by
 * name.
 */
export function outboxTopicForStatus(to: OrderStatus): string {
  return `order.${to}`;
}

export type TransitionOrderResult = {
  order: OrderRow;
  eventId: string;
  outboxEventId: string;
};

/**
 * Move an order from its current status to `to`. The whole hop — UPDATE,
 * `order_events` insert, `outbox_events` insert — runs inside one
 * `withTenant` transaction so it's atomic.
 *
 * Throws `OrderNotFoundError` when the order id is invisible (RLS or wrong
 * tenant). Throws `InvalidOrderTransitionError` when `to` is not in the
 * allowed list for the current status. Same-status hops are a silent no-op
 * (matches the DB trigger's behaviour and keeps idempotent retries safe).
 */
export async function transitionOrder(
  storeId: string,
  orderId: string,
  to: OrderStatus,
  actor: OrderEventActor,
  payload: Record<string, unknown> = {},
): Promise<TransitionOrderResult> {
  return withTenant(storeId, async tx =>
    transitionOrderTx(tx, storeId, orderId, to, actor, payload),
  );
}

/**
 * Same as `transitionOrder` but for callers that already hold an open
 * `withTenant` transaction (e.g. `createFulfillment` after marking the last
 * line shipped). The caller's tx is reused so the transition commits with
 * the surrounding work.
 */
export async function transitionOrderTx(
  tx: Tx,
  storeId: string,
  orderId: string,
  to: OrderStatus,
  actor: OrderEventActor,
  payload: Record<string, unknown> = {},
): Promise<TransitionOrderResult> {
  const existing = await tx
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  const current = existing[0];
  if (!current) throw new OrderNotFoundError(orderId);

  // Same-status: no-op short-circuit. Match the DB trigger's behaviour so
  // retried webhook handlers don't double-emit events.
  if (current.status === to) {
    // Still return a synthetic shape so callers don't crash on `.order`.
    // No event / outbox row is written.
    return {
      order: current,
      eventId: '',
      outboxEventId: '',
    };
  }

  const allowed = TRANSITIONS[current.status];
  if (!allowed.includes(to)) {
    throw new InvalidOrderTransitionError(current.status, to);
  }

  const updateValues: Partial<typeof orders.$inferInsert> = { status: to };
  if (to === 'cancelled') {
    updateValues.cancelledAt = new Date();
  }
  if (to === 'refunded') {
    // Keep paymentStatus in lockstep with order.status for the canonical
    // full-refund hop. Partial refunds DON'T transition the order, so this
    // only fires when the caller has decided the order is fully refunded.
    updateValues.paymentStatus = 'refunded';
  }
  if (to === 'paid' && current.paymentStatus !== 'paid') {
    updateValues.paymentStatus = 'paid';
  }

  const updated = await tx
    .update(orders)
    .set(updateValues)
    .where(eq(orders.id, orderId))
    .returning();
  const next = updated[0];
  if (!next) throw new OrderNotFoundError(orderId);

  const event = await appendOrderEvent(
    tx,
    storeId,
    orderId,
    eventKindForStatus(to),
    actor,
    { from: current.status, to, ...payload },
  );

  const outboxRows = await tx
    .insert(outboxEvents)
    .values({
      storeId,
      topic: outboxTopicForStatus(to),
      payload: {
        orderId,
        number: next.number,
        from: current.status,
        to,
        ...payload,
      },
    })
    .returning({ id: outboxEvents.id });
  const outboxRow = outboxRows[0];
  if (!outboxRow) throw new Error('outbox_events insert returned no row');

  return {
    order: next,
    eventId: event.id,
    outboxEventId: outboxRow.id,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Admin list
// ──────────────────────────────────────────────────────────────────────────────

export type ListOrdersFilters = {
  status?: OrderStatus | OrderStatus[];
  paymentStatus?: OrderPaymentStatus | OrderPaymentStatus[];
  customerEmail?: string;
  from?: Date;
  to?: Date;
};

export type ListOrdersOptions = ListOrdersFilters & {
  cursor?: string;
  limit?: number;
};

export type ListOrdersResult = {
  items: OrderRow[];
  nextCursor: string | null;
};

/**
 * Cursor-paginated newest-first admin order list. The cursor encodes
 * `placedAt` (ISO) + `id` (uuid) for a deterministic order. Filters are
 * AND-combined; arrays are IN-combined.
 */
export async function listOrders(
  storeId: string,
  opts: ListOrdersOptions = {},
): Promise<ListOrdersResult> {
  const limit = parseLimit(opts.limit?.toString());

  return withTenant(storeId, async tx => {
    const filters: SQL[] = [];

    if (opts.status !== undefined) {
      const list = Array.isArray(opts.status) ? opts.status : [opts.status];
      if (list.length === 1) {
        filters.push(eq(orders.status, list[0]!));
      } else if (list.length > 1) {
        const head = list[0]!;
        const orExpr = list
          .slice(1)
          .reduce<SQL>(
            (acc, s) => or(acc, eq(orders.status, s)) as SQL,
            eq(orders.status, head),
          );
        filters.push(orExpr);
      }
    }

    if (opts.paymentStatus !== undefined) {
      const list = Array.isArray(opts.paymentStatus)
        ? opts.paymentStatus
        : [opts.paymentStatus];
      if (list.length === 1) {
        filters.push(eq(orders.paymentStatus, list[0]!));
      } else if (list.length > 1) {
        const head = list[0]!;
        const orExpr = list
          .slice(1)
          .reduce<SQL>(
            (acc, s) => or(acc, eq(orders.paymentStatus, s)) as SQL,
            eq(orders.paymentStatus, head),
          );
        filters.push(orExpr);
      }
    }

    if (opts.customerEmail) {
      filters.push(eq(orders.email, opts.customerEmail));
    }

    if (opts.from) filters.push(gte(orders.placedAt, opts.from));
    if (opts.to) filters.push(lte(orders.placedAt, opts.to));

    if (opts.cursor) {
      const decoded = decodeCursor(opts.cursor);
      if (decoded) {
        const cutoff = new Date(decoded.k);
        filters.push(
          or(
            lt(orders.placedAt, cutoff),
            and(eq(orders.placedAt, cutoff), lt(orders.id, decoded.id)),
          ) as SQL,
        );
      }
    }

    const whereExpr = filters.length > 0 ? and(...filters) : undefined;

    const pageRows = await tx
      .select()
      .from(orders)
      .where(whereExpr)
      .orderBy(desc(orders.placedAt), desc(orders.id))
      .limit(limit + 1);

    const hasMore = pageRows.length > limit;
    const sliced = hasMore ? pageRows.slice(0, limit) : pageRows;
    const last = sliced[sliced.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ k: last.placedAt.toISOString(), id: last.id })
        : null;

    return { items: sliced, nextCursor };
  });
}
