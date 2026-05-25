/**
 * Inbound payment webhook dispatcher (SP-4 task 18, Stream F).
 *
 * `applyPaymentEvent` is invoked by the `/api/v1/webhooks/payments/[provider]`
 * route AFTER:
 *   1. The provider signature has been HMAC-verified.
 *   2. The raw event has been parsed into our `ProviderEvent` shape.
 *   3. A `payment_events` row has been recorded inside a `migratorDb`
 *      transaction (BYPASSRLS — the webhook itself has no tenant context).
 *
 * The outer migrator transaction must remain free of tenant-scoped writes:
 * RLS-bearing tables (`payment_intents`, `orders`, `payments`, `carts`,
 * `cart_items`, …) are only legal to touch with `app.store_id` set. So this
 * dispatcher:
 *   - Reads the intent row through migratorDb (RLS bypass; we lack a tenant)
 *     to discover the owning `storeId`.
 *   - Opens a NEW `withTenant(storeId, …)` transaction for any per-tenant
 *     work (intent status flip, order creation, reservation release).
 *
 * Idempotency:
 *   - `payment_succeeded` is a no-op when the intent is already 'succeeded'.
 *   - `payment_failed`    is a no-op when the intent is already 'failed' or
 *     'succeeded' (never downgrade a terminal state — Razorpay/Stripe can
 *     deliver events out of order).
 *   - `refund_succeeded`  is a stub log — SP-5 owns the refund flow.
 *
 * Caller is the route handler; the route does the OUTER `payment_events`
 * write + `processed`/`error` flags so that any throw here is observable on
 * the event row.
 */

import { eq } from 'drizzle-orm';
import type { PostgresJsTransaction } from 'drizzle-orm/postgres-js';

import { paymentEvents, paymentIntents } from '@/db/schema/payments';
import { logger } from '@/lib/logger';
import { createOrderFromCart } from '@/modules/checkout/orders';
import { release } from '@/modules/inventory/reservations';
import { withTenant } from '@/modules/tenant/with-tenant';

type MigratorTx = PostgresJsTransaction<Record<string, never>, Record<string, never>>;

export type PaymentEventRow = typeof paymentEvents.$inferSelect;

export type ApplyPaymentEventResult = {
  status: 'applied' | 'noop' | 'ignored';
  orderNumber?: string;
};

/**
 * Dispatch a recorded payment event to its handler. Called from inside the
 * route's migratorDb transaction. Throws on hard failure so the route can
 * persist `payment_events.error` and return a non-2xx to the provider.
 */
export async function applyPaymentEvent(
  tx: MigratorTx,
  recordedEvent: PaymentEventRow,
): Promise<ApplyPaymentEventResult> {
  switch (recordedEvent.eventType) {
    case 'payment_succeeded':
      return applyPaymentSucceeded(tx, recordedEvent);
    case 'payment_failed':
      return applyPaymentFailed(tx, recordedEvent);
    case 'refund_succeeded':
      // SP-5 owns refunds (`refunds` table + provider.refundPayment()). For
      // now we log + acknowledge so the provider stops retrying.
      logger.info(
        {
          paymentEventId: recordedEvent.id,
          provider: recordedEvent.provider,
          providerEventId: recordedEvent.providerEventId,
        },
        'refund_succeeded ignored — SP-5 will own refund handling',
      );
      return { status: 'ignored' };
    default:
      logger.warn(
        {
          paymentEventId: recordedEvent.id,
          eventType: recordedEvent.eventType,
        },
        'unhandled payment event type',
      );
      return { status: 'ignored' };
  }
}

/**
 * Extract the `providerRef` (Razorpay order_id / Stripe payment_intent id)
 * stored on the recorded event. The route parsed it out of the payload via
 * `provider.parseEvent` and we re-read it from `payload.providerRef` rather
 * than re-parsing the raw provider shape here.
 *
 * The route writes the parsed event under `payload` along with the raw
 * provider body, so `payload.providerRef` is the source of truth.
 */
function extractProviderRef(recordedEvent: PaymentEventRow): string | null {
  const payload = recordedEvent.payload;
  if (!payload || typeof payload !== 'object') return null;
  const candidate = (payload as Record<string, unknown>)['providerRef'];
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

async function loadIntentByRef(
  tx: MigratorTx,
  provider: PaymentEventRow['provider'],
  providerRef: string,
): Promise<typeof paymentIntents.$inferSelect | null> {
  // BYPASSRLS lookup — we have no tenant context yet. The intent row carries
  // the `storeId` we need to open the tenant transaction.
  const rows = await tx
    .select()
    .from(paymentIntents)
    .where(eq(paymentIntents.providerRef, providerRef))
    .limit(2);
  // Defensive: providerRef is globally unique per provider in practice
  // (Razorpay order_ids and Stripe PI ids are namespaced). We also filter by
  // provider to be safe in case a fixture re-uses a string across providers.
  const matches = rows.filter(r => r.provider === provider);
  return matches[0] ?? null;
}

async function applyPaymentSucceeded(
  tx: MigratorTx,
  recordedEvent: PaymentEventRow,
): Promise<ApplyPaymentEventResult> {
  const providerRef = extractProviderRef(recordedEvent);
  if (!providerRef) {
    logger.warn(
      { paymentEventId: recordedEvent.id },
      'payment_succeeded missing providerRef — cannot dispatch',
    );
    return { status: 'ignored' };
  }

  const intent = await loadIntentByRef(tx, recordedEvent.provider, providerRef);
  if (!intent) {
    logger.warn(
      { paymentEventId: recordedEvent.id, providerRef },
      'payment_succeeded for unknown intent — ignoring',
    );
    return { status: 'ignored' };
  }

  // Idempotent re-delivery — webhook arrived twice for an already-placed
  // order. The unique(provider, providerEventId) index on payment_events is
  // the first line of defence; this is the second.
  if (intent.status === 'succeeded') {
    logger.info(
      { paymentEventId: recordedEvent.id, intentId: intent.id },
      'payment_succeeded already applied — noop',
    );
    return { status: 'noop' };
  }

  // After createOrderFromCart succeeds, the cart row is deleted and the FK is
  // set null (migration 0015). If this webhook arrives twice and the first
  // attempt half-applied, cartId could be null on retry — guard.
  if (!intent.cartId) {
    logger.warn(
      { paymentEventId: recordedEvent.id, intentId: intent.id },
      'payment_succeeded for intent without cart — cart already consumed',
    );
    return { status: 'noop' };
  }

  const intentCartId = intent.cartId;

  // Per-tenant work runs in its own transaction so RLS is enforced. The
  // outer migrator tx remains read-only for tenant-scoped tables.
  const orderResult = await withTenant(intent.storeId, async tenantTx => {
    return createOrderFromCart(tenantTx, intent.storeId, {
      cartId: intentCartId,
      intent,
      paymentRef: {
        providerRef,
        amountCents: intent.amountCents,
      },
    });
  });

  logger.info(
    {
      paymentEventId: recordedEvent.id,
      intentId: intent.id,
      orderId: orderResult.id,
      orderNumber: orderResult.number,
      storeId: intent.storeId,
    },
    'payment_succeeded applied — order placed',
  );

  return { status: 'applied', orderNumber: orderResult.number };
}

async function applyPaymentFailed(
  tx: MigratorTx,
  recordedEvent: PaymentEventRow,
): Promise<ApplyPaymentEventResult> {
  const providerRef = extractProviderRef(recordedEvent);
  if (!providerRef) {
    logger.warn(
      { paymentEventId: recordedEvent.id },
      'payment_failed missing providerRef — cannot dispatch',
    );
    return { status: 'ignored' };
  }

  const intent = await loadIntentByRef(tx, recordedEvent.provider, providerRef);
  if (!intent) {
    logger.warn(
      { paymentEventId: recordedEvent.id, providerRef },
      'payment_failed for unknown intent — ignoring',
    );
    return { status: 'ignored' };
  }

  // Never downgrade a terminal state. Providers can deliver succeeded then
  // a stale failed (e.g. after manual retry); the first terminal status wins.
  if (intent.status === 'succeeded' || intent.status === 'failed') {
    logger.info(
      {
        paymentEventId: recordedEvent.id,
        intentId: intent.id,
        currentStatus: intent.status,
      },
      'payment_failed received against terminal intent — noop',
    );
    return { status: 'noop' };
  }

  // Per-tenant work: flip status + release reservations. release() is
  // idempotent against already-released rows.
  await withTenant(intent.storeId, async tenantTx => {
    await tenantTx
      .update(paymentIntents)
      .set({ status: 'failed' })
      .where(eq(paymentIntents.id, intent.id));
  });

  for (const reservationId of intent.reservationIds) {
    try {
      await release(intent.storeId, reservationId, 'payment_failed');
    } catch (err) {
      logger.error(
        {
          err,
          reservationId,
          intentId: intent.id,
          storeId: intent.storeId,
        },
        'failed to release reservation after payment_failed',
      );
    }
  }

  logger.info(
    {
      paymentEventId: recordedEvent.id,
      intentId: intent.id,
      storeId: intent.storeId,
    },
    'payment_failed applied — intent marked failed, reservations released',
  );

  return { status: 'applied' };
}
