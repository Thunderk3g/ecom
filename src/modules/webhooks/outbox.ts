/**
 * Outbox event writer.
 *
 * The transactional outbox pattern (see plan §11): order mutations and their
 * outbound webhook events commit atomically by inserting an `outbox_events`
 * row inside the same database transaction as the domain mutation. A separate
 * worker drains pending rows (see `dispatch.ts`) and fans them out to
 * subscribed webhooks.
 *
 * IMPORTANT: this function accepts the caller's `tx` (a drizzle transaction
 * — typically the `Tx` from `withTenant`). It does NOT open its own
 * transaction. The caller is responsible for using `withTenant(storeId, ...)`
 * so RLS sees the right `app.store_id` for the INSERT. Stream B
 * (`orders/lifecycle.ts`) is the primary caller from within its
 * `transitionOrder` transaction.
 */

import type { PostgresJsTransaction } from 'drizzle-orm/postgres-js';
import { outboxEvents } from '@/db/schema/webhooks';

type Tx = PostgresJsTransaction<Record<string, never>, Record<string, never>>;

export type OutboxEventRow = typeof outboxEvents.$inferSelect;

/**
 * Insert a pending outbox row. Returns the inserted row so callers can stash
 * the id (e.g. on order_events.payload) if they want to correlate later.
 *
 * The `storeId` is passed explicitly rather than read from the session GUC so
 * that the column value matches the tenant the transaction is scoped to —
 * RLS still enforces the equality on INSERT.
 */
export async function writeOutboxEvent(
  tx: Tx,
  storeId: string,
  topic: string,
  payload: Record<string, unknown>,
): Promise<OutboxEventRow> {
  const [row] = await tx
    .insert(outboxEvents)
    .values({
      storeId,
      topic,
      payload,
      status: 'pending',
    })
    .returning();
  if (!row) {
    throw new Error('outbox_events insert returned no row');
  }
  return row;
}
