/**
 * Order timeline — append-only events.
 *
 * The `order_events` table is append-only at the database layer (0017 RLS
 * blocks UPDATE and DELETE for all roles). The two public functions here
 * cover the only two access patterns:
 *
 *   - `appendOrderEvent(tx, ...)`: insert a row inside the caller's tx so the
 *     event commits atomically with the mutation that produced it. Callers
 *     MUST already hold an open `withTenant(storeId, ...)` transaction —
 *     RLS depends on `app.store_id` being set.
 *   - `getOrderTimeline(storeId, orderId)`: read newest-first list of events
 *     for the admin order detail view.
 *
 * Event `kind` is a free-form string by design — the timeline UI groups by it,
 * but new kinds added by future SPs (CMS notes, custom workflows, etc.) don't
 * need a schema change. The lifecycle / fulfillment / refund modules in this
 * stream restrict themselves to the canonical set documented in
 * `KNOWN_ORDER_EVENT_KINDS` below.
 */

import { asc, eq } from 'drizzle-orm';
import type { PostgresJsTransaction } from 'drizzle-orm/postgres-js';
import { withTenant } from '@/modules/tenant/with-tenant';
import { orderEvents } from '@/db/schema/audit';

type Tx = PostgresJsTransaction<Record<string, never>, Record<string, never>>;

export type OrderEventRow = typeof orderEvents.$inferSelect;

/**
 * Canonical event kinds emitted by this module. The DB column is `text` so
 * future additions don't need a migration, but anything we emit ourselves
 * comes from this set.
 */
export const KNOWN_ORDER_EVENT_KINDS = [
  'created',
  'paid',
  'fulfilled',
  'shipped',
  'delivered',
  'refunded',
  'cancelled',
  'completed',
  'note',
  'fulfillment.created',
  'fulfillment.shipped',
  'fulfillment.delivered',
  'refund.created',
  'refund.succeeded',
  'refund.failed',
] as const;

export type OrderEventKind = (typeof KNOWN_ORDER_EVENT_KINDS)[number] | string;

export type OrderEventActor = {
  /** 'user' | 'system' | 'webhook' | 'job' — free-form for forward-compat. */
  actorType: string;
  /** Null for system / job actors that don't have a user row. */
  actorId: string | null;
};

/**
 * Append a row to `order_events` inside the caller's transaction. Returns the
 * inserted row. The caller is responsible for opening `withTenant` so RLS
 * (`app.store_id`) is set — this function never opens its own transaction.
 */
export async function appendOrderEvent(
  tx: Tx,
  storeId: string,
  orderId: string,
  kind: OrderEventKind,
  actor: OrderEventActor,
  payload: Record<string, unknown> = {},
): Promise<OrderEventRow> {
  const rows = await tx
    .insert(orderEvents)
    .values({
      storeId,
      orderId,
      kind,
      actorType: actor.actorType,
      actorId: actor.actorId,
      payload,
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error('order_events insert returned no row');
  return row;
}

/**
 * Oldest-first timeline for an order. Returns an empty array when the order
 * is not visible to the current tenant (RLS hides it; we don't distinguish
 * "no events" from "no access" here — the route handler should do a 404
 * check via `getOrderById` first if it needs to disambiguate).
 */
export async function getOrderTimeline(
  storeId: string,
  orderId: string,
): Promise<OrderEventRow[]> {
  return withTenant(storeId, async tx => {
    return tx
      .select()
      .from(orderEvents)
      .where(eq(orderEvents.orderId, orderId))
      .orderBy(asc(orderEvents.createdAt), asc(orderEvents.id));
  });
}
