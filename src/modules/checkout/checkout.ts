/**
 * Checkout module — start, advisory confirm, cancel.
 *
 * `startCheckout` is the storefront's "Pay now" entry point. It:
 *   1. Loads the cart and verifies it has at least one item + a shipping
 *      address (else throws MissingShippingAddressError / EmptyCartError).
 *   2. Re-prices the cart through the canonical pricing engine — never trusts
 *      client-side totals.
 *   3. Reserves inventory at the store's default location (the location with
 *      the lowest `created_at`) via SP-3's `reserve()`, with the standard
 *      15-minute TTL.
 *   4. Asks the chosen PaymentProvider to mint an intent (Razorpay Order or
 *      Stripe PaymentIntent).
 *   5. Persists a `payment_intents` row in 'attached' state carrying the
 *      reservation ids — this row is the source of truth that ties cart →
 *      payment intent → reservations together.
 *
 * Idempotency: if an existing 'attached' intent for the same (cart, provider,
 * amount) is already on file, `startCheckout` returns it instead of creating a
 * second one. This handles double-click on "Pay now" without leaking
 * reservations or producing duplicate provider orders.
 *
 * `confirmCheckoutAdvisory` is the optional client-side success callback — it
 * polls intent state and returns the order number once the webhook has
 * created the order. Source of truth remains the webhook.
 *
 * `cancelCheckout` releases reservations, marks the intent 'cancelled', and
 * best-effort tells the provider to cancel its side (errors swallowed and
 * logged — local state is authoritative).
 */

import { and, asc, eq, sql } from 'drizzle-orm';
import type { PostgresJsTransaction } from 'drizzle-orm/postgres-js';
import { withTenant } from '@/modules/tenant/with-tenant';
import { logger } from '@/lib/logger';
import { carts, cartItems } from '@/db/schema/carts';
import { locations } from '@/db/schema/inventory';
import { orders } from '@/db/schema/orders';
import { paymentIntents } from '@/db/schema/payments';
import { priceCart, type CartTotals } from '@/modules/cart/pricing';
import { getPaymentProvider, type ProviderName } from '@/modules/payments/provider';
import { release, reserve } from '@/modules/inventory/reservations';
import {
  CheckoutNotFoundError,
  EmptyCartError,
  IntentNotFoundError,
  MissingShippingAddressError,
} from './errors';

type Tx = PostgresJsTransaction<Record<string, never>, Record<string, never>>;

export type StartCheckoutInput = {
  cartId: string;
  provider: ProviderName;
};

export type StartCheckoutResult = {
  intentId: string;
  providerRef: string;
  clientSecret?: string;
  totals: CartTotals;
};

export type ConfirmAdvisoryResult = {
  orderNumber: string | null;
  status: typeof paymentIntents.$inferSelect.status;
};

/**
 * Pick the store's "default" inventory location — the oldest one by
 * `created_at`. SP-4 books every checkout reservation against this location;
 * multi-location routing is deferred (plan §Risks #2). Throws when the store
 * has no locations configured.
 */
async function getDefaultLocationId(tx: Tx, storeId: string): Promise<string> {
  const rows = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.storeId, storeId))
    .orderBy(asc(locations.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new CheckoutNotFoundError(`no inventory location for store=${storeId}`);
  }
  return row.id;
}

export async function startCheckout(
  storeId: string,
  input: StartCheckoutInput,
): Promise<StartCheckoutResult> {
  // Step 1: load + validate cart, re-price. priceCart owns its own withTenant
  // transaction; we read the totals before reserving so a bad-shaped cart
  // (missing address / empty) short-circuits before we touch inventory.
  const cartRow = await withTenant(storeId, async tx => {
    const rows = await tx.select().from(carts).where(eq(carts.id, input.cartId)).limit(1);
    return rows[0] ?? null;
  });
  if (!cartRow) throw new CheckoutNotFoundError(`cart=${input.cartId}`);
  if (!cartRow.shippingAddress) throw new MissingShippingAddressError();

  const itemRows = await withTenant(storeId, async tx => {
    return tx.select().from(cartItems).where(eq(cartItems.cartId, input.cartId));
  });
  if (itemRows.length === 0) throw new EmptyCartError();

  const totals = await priceCart(storeId, input.cartId, {
    shippingAddress: cartRow.shippingAddress,
  });

  // Step 2: idempotency — if an 'attached' intent for the same provider +
  // amount already exists for this cart, return it. The amount check guards
  // against a stale intent from before the cart changed.
  const existing = await withTenant(storeId, async tx => {
    const rows = await tx
      .select()
      .from(paymentIntents)
      .where(
        and(
          eq(paymentIntents.cartId, input.cartId),
          eq(paymentIntents.provider, input.provider),
          eq(paymentIntents.status, 'attached'),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  });
  if (existing && existing.amountCents === totals.totalCents && existing.providerRef) {
    const result: StartCheckoutResult = {
      intentId: existing.id,
      providerRef: existing.providerRef,
      totals,
    };
    if (existing.clientSecret) result.clientSecret = existing.clientSecret;
    return result;
  }

  // Step 3: reserve inventory. SP-3's reserve() opens its own withTenant tx
  // and applies row-level locks per (variant, location) — concurrent calls
  // serialise there.
  const defaultLocationId = await withTenant(storeId, async tx =>
    getDefaultLocationId(tx, storeId),
  );
  const { reservationIds } = await reserve(storeId, {
    cartId: input.cartId,
    items: itemRows.map(it => ({
      variantId: it.variantId,
      locationId: defaultLocationId,
      qty: it.qty,
    })),
  });

  // Step 4: ask the provider to mint an intent. If this throws after
  // reservations are placed, the reservation TTL (15 min) will reclaim the
  // stock — explicit rollback isn't needed for v1.
  const provider = await getPaymentProvider(input.provider);
  let intent;
  try {
    intent = await provider.createIntent({
      amountCents: totals.totalCents,
      currency: cartRow.currency,
      cartId: input.cartId,
      metadata: { storeId, cartId: input.cartId },
    });
  } catch (err) {
    // Best-effort release on provider error so we don't sit on stock for the
    // full TTL window when the provider rejected the call.
    for (const rid of reservationIds) {
      try {
        await release(storeId, rid, 'provider_create_failed');
      } catch (releaseErr) {
        logger.error(
          { err: releaseErr, reservationId: rid, storeId },
          'failed to release reservation after provider error',
        );
      }
    }
    throw err;
  }

  // Step 5: persist payment_intents row.
  const inserted = await withTenant(storeId, async tx => {
    const result = await tx
      .insert(paymentIntents)
      .values({
        storeId,
        cartId: input.cartId,
        provider: input.provider,
        providerRef: intent.providerRef,
        clientSecret: intent.clientSecret ?? null,
        amountCents: totals.totalCents,
        currency: cartRow.currency,
        status: 'attached',
        reservationIds,
        raw: intent.raw,
      })
      .returning({ id: paymentIntents.id });
    return result[0];
  });
  if (!inserted) throw new Error('startCheckout: payment_intents insert returned no row');

  const result: StartCheckoutResult = {
    intentId: inserted.id,
    providerRef: intent.providerRef,
    totals,
  };
  if (intent.clientSecret) result.clientSecret = intent.clientSecret;
  return result;
}

/**
 * Advisory confirm — client-side success callback. The webhook is the source
 * of truth; this just lets the client poll for the order number once the
 * server has processed the provider's notification.
 *
 * Returns `{ orderNumber: <string>, status: 'succeeded' }` once the webhook
 * has placed the order, or `{ orderNumber: null, status: <current> }` while
 * the webhook is still in flight.
 */
export async function confirmCheckoutAdvisory(
  storeId: string,
  intentId: string,
): Promise<ConfirmAdvisoryResult> {
  return withTenant(storeId, async tx => {
    const rows = await tx
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .limit(1);
    const intent = rows[0];
    if (!intent) throw new IntentNotFoundError(intentId);

    if (intent.status !== 'succeeded') {
      return { orderNumber: null, status: intent.status };
    }

    // Order was created by the webhook handler. Look it up via the cart link
    // (we drop the cart on placement, so join through payments instead).
    const orderRows = await tx
      .select({ number: orders.number })
      .from(orders)
      .innerJoin(
        sql`payments`,
        sql`payments.order_id = ${orders.id} AND payments.intent_id = ${intent.id}`,
      )
      .limit(1);
    const order = orderRows[0];
    return {
      orderNumber: order?.number ?? null,
      status: intent.status,
    };
  });
}

/**
 * Cancel an in-flight checkout. Releases all reservations, flips intent
 * status to 'cancelled', and tells the provider to cancel its side
 * (best-effort — local state is authoritative if the provider call fails).
 */
export async function cancelCheckout(
  storeId: string,
  intentId: string,
): Promise<void> {
  const intent = await withTenant(storeId, async tx => {
    const rows = await tx
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .limit(1);
    return rows[0] ?? null;
  });
  if (!intent) throw new IntentNotFoundError(intentId);

  // Already in a terminal state — nothing to do.
  if (intent.status === 'succeeded' || intent.status === 'cancelled') {
    return;
  }

  // Step 1: release each reservation. SP-3 release() is idempotent against
  // already-released rows (e.g. the TTL sweeper raced us).
  for (const rid of intent.reservationIds) {
    try {
      await release(storeId, rid, 'checkout_cancelled');
    } catch (err) {
      logger.error(
        { err, reservationId: rid, intentId, storeId },
        'failed to release reservation during checkout cancel',
      );
    }
  }

  // Step 2: mark the intent cancelled.
  await withTenant(storeId, async tx => {
    await tx
      .update(paymentIntents)
      .set({ status: 'cancelled', updatedAt: sql`now()` })
      .where(eq(paymentIntents.id, intentId));
  });

  // Step 3: best-effort provider cancel. Failures are logged but not
  // propagated — the local cancellation is the source of truth, and the
  // provider's intent will auto-expire if it's a Razorpay order or remain a
  // requires_payment_method PI on Stripe (both safe).
  // 'manual' provider has no remote intent to cancel; only Razorpay/Stripe.
  if (intent.providerRef && intent.provider !== 'manual') {
    try {
      const provider = await getPaymentProvider(intent.provider);
      await provider.cancelIntent(intent.providerRef);
    } catch (err) {
      logger.warn(
        { err, intentId, provider: intent.provider, providerRef: intent.providerRef },
        'provider cancelIntent failed (intent already cancelled locally)',
      );
    }
  }
}
