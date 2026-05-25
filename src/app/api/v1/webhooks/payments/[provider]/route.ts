/**
 * Inbound payment webhook endpoint (SP-4 task 18).
 *
 * POST /api/v1/webhooks/payments/[provider]   provider ∈ { 'razorpay', 'stripe' }
 *
 * The provider POSTs an event after a payment attempt completes. This route:
 *   1. Validates the path provider is one we support (else 404).
 *   2. Reads the raw request body via `req.text()` — signature verification
 *      runs over the raw bytes BEFORE any JSON parsing.
 *   3. Asks the matching `PaymentProvider` adapter to verify the
 *      provider-specific signature header.
 *   4. Parses the event and resolves the owning `storeId` via the
 *      `payment_intents` table (BYPASSRLS read — the webhook has no tenant
 *      context until it discovers the intent).
 *   5. Records the event in `payment_events` with the natural idempotency key
 *      `(provider, provider_event_id)` and `ON CONFLICT DO NOTHING`. A
 *      redelivered event short-circuits with 200 OK.
 *   6. Dispatches via `applyPaymentEvent`. On success the event row is
 *      flipped to `processed=true`; on error the row is annotated with
 *      `error=<string>` and the route returns 500 so the provider retries.
 *
 * Why migratorDb? The webhook arrives without a `Host`/tenant header that
 * resolves to one store, AND payment_events is a tenant-scoped table. We
 * need to write the event row + read the intent row from any store. The
 * tenant-scoped work inside `applyPaymentEvent` opens its own
 * `withTenant(intent.storeId, …)` transaction.
 *
 * Response contract: providers expect 2xx for "delivered" and non-2xx to
 * trigger their retry policy. RFC 7807 `problem()` responses are used for
 * 4xx — providers will still retry but the body is informational.
 */

import { eq } from 'drizzle-orm';
import type { PostgresJsTransaction } from 'drizzle-orm/postgres-js';
import { NextResponse } from 'next/server';

import { migratorDb } from '@/db/client';
import { paymentEvents, paymentIntents } from '@/db/schema/payments';
import { problem } from '@/lib/errors';
import { logger } from '@/lib/logger';
import {
  getPaymentProvider,
  type ProviderEvent,
  type ProviderName,
} from '@/modules/payments/provider';
import { applyPaymentEvent } from '@/modules/payments/webhooks';

// The migrator's transaction object is the same `postgres-js` driver type
// used everywhere else in the codebase (see `withTenant` in
// modules/tenant/with-tenant.ts which also casts). We pin it locally for
// the cast that hands the tx down to `applyPaymentEvent`.
type Tx = PostgresJsTransaction<Record<string, never>, Record<string, never>>;

type RouteCtx = { params: Promise<{ provider: string }> };

const SUPPORTED_PROVIDERS: readonly ProviderName[] = ['razorpay', 'stripe'];

function isSupportedProvider(name: string): name is ProviderName {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(name);
}

function signatureHeaderFor(provider: ProviderName): string {
  return provider === 'razorpay' ? 'x-razorpay-signature' : 'stripe-signature';
}

export async function POST(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const { provider: providerParam } = await ctx.params;
  if (!isSupportedProvider(providerParam)) {
    return problem(404, 'unknown-provider', `Unknown payment provider: ${providerParam}`, [
      { path: ['provider'], message: 'unsupported' },
    ]);
  }
  const providerName: ProviderName = providerParam;

  // Step 1 — read RAW body. Do NOT use req.json(); signature verification
  // is over the exact bytes the provider hashed.
  const rawBody = await req.text();

  // Step 2 — instantiate the matching provider adapter.
  const provider = await getPaymentProvider(providerName);

  // Step 3 — verify HMAC signature against the configured webhook secret.
  const sig = req.headers.get(signatureHeaderFor(providerName)) ?? '';
  if (!provider.verifyWebhookSignature(rawBody, sig)) {
    logger.warn(
      { provider: providerName },
      'payment webhook signature verification failed',
    );
    return problem(401, 'invalid-signature', 'Webhook signature is invalid', [
      { path: ['signature'], message: 'invalid' },
    ]);
  }

  // Step 4 — JSON-parse the body (now that we trust the bytes).
  let parsedPayload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('webhook body is not a JSON object');
    }
    parsedPayload = parsed as Record<string, unknown>;
  } catch (err) {
    logger.warn(
      { err, provider: providerName },
      'payment webhook body failed to parse as JSON',
    );
    return problem(400, 'invalid-body', 'Webhook body is not valid JSON', [
      { path: ['body'], message: 'invalid' },
    ]);
  }

  // Step 5 — normalise into our ProviderEvent shape.
  const event: ProviderEvent = provider.parseEvent(parsedPayload);
  if (!event.providerEventId) {
    logger.warn(
      { provider: providerName, eventType: event.type },
      'payment webhook missing provider event id — cannot dedupe',
    );
    return problem(400, 'invalid-event', 'Event is missing provider event id', [
      { path: ['id'], message: 'required' },
    ]);
  }

  // Step 6 — resolve tenant via the intent's providerRef. If we have no
  // matching intent, we never created this checkout — log + 200 so the
  // provider does not keep retrying for an event we cannot place.
  let storeId: string | null = null;
  if (event.providerRef) {
    const intentRows = await migratorDb
      .select({ storeId: paymentIntents.storeId, provider: paymentIntents.provider })
      .from(paymentIntents)
      .where(eq(paymentIntents.providerRef, event.providerRef))
      .limit(2);
    const owning = intentRows.find(r => r.provider === providerName);
    storeId = owning?.storeId ?? null;
  }
  if (!storeId) {
    logger.warn(
      {
        provider: providerName,
        providerRef: event.providerRef,
        providerEventId: event.providerEventId,
        eventType: event.type,
      },
      'payment webhook for unknown intent — acknowledging without dispatch',
    );
    return new NextResponse('OK (unknown intent)', { status: 200 });
  }

  // We persist BOTH the parsed envelope and the raw provider body on the
  // event row. `applyPaymentEvent` reads `payload.providerRef` to dispatch.
  const persistedPayload: Record<string, unknown> = {
    providerRef: event.providerRef,
    providerEventId: event.providerEventId,
    type: event.type,
    ...(event.amountCents !== undefined ? { amountCents: event.amountCents } : {}),
    raw: event.raw,
  };

  // Step 7 — record the event with natural-key idempotency, then dispatch.
  return migratorDb.transaction(async rawTx => {
    const tx = rawTx as unknown as Tx;
    const inserted = await tx
      .insert(paymentEvents)
      .values({
        storeId,
        provider: providerName,
        providerEventId: event.providerEventId,
        eventType: event.type,
        payload: persistedPayload,
      })
      .onConflictDoNothing({
        target: [paymentEvents.provider, paymentEvents.providerEventId],
      })
      .returning();
    const recorded = inserted[0];

    if (!recorded) {
      // Already-seen event (provider redelivery). The unique index on
      // (provider, provider_event_id) is the natural idempotency key.
      logger.info(
        {
          provider: providerName,
          providerEventId: event.providerEventId,
        },
        'payment webhook duplicate — already recorded',
      );
      return new NextResponse('OK (duplicate)', { status: 200 });
    }

    try {
      const result = await applyPaymentEvent(tx, recorded);
      await tx
        .update(paymentEvents)
        .set({ processed: true, processedAt: new Date() })
        .where(eq(paymentEvents.id, recorded.id));
      logger.info(
        {
          paymentEventId: recorded.id,
          provider: providerName,
          providerEventId: event.providerEventId,
          status: result.status,
          ...(result.orderNumber ? { orderNumber: result.orderNumber } : {}),
        },
        'payment webhook dispatched',
      );
      return new NextResponse('OK', { status: 200 });
    } catch (err) {
      // Persist the error so ops + retry tooling can inspect. We deliberately
      // do NOT throw out of the transaction — the event row must survive the
      // failure (otherwise we'd lose the audit trail when the tx rolls back).
      // Note: any tenant-scoped writes inside applyPaymentEvent ran in their
      // own `withTenant` transactions; whether they committed or rolled back
      // is independent of this migrator tx, so the error annotation here is
      // accurate without needing savepoints.
      const errorMessage = err instanceof Error ? err.message : String(err);
      await tx
        .update(paymentEvents)
        .set({ error: errorMessage })
        .where(eq(paymentEvents.id, recorded.id));
      logger.error(
        {
          err,
          paymentEventId: recorded.id,
          provider: providerName,
          providerEventId: event.providerEventId,
        },
        'payment webhook apply failed — provider will retry',
      );
      // Non-2xx so the provider retries on its own schedule. The
      // payment_events row stays with `processed=false, error=<msg>` for
      // a future retry queue (SP-4 risk #5 / SP-5 admin tooling).
      return new NextResponse('payment event apply failed', { status: 500 });
    }
  });
}
