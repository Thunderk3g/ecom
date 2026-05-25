/**
 * Outbound webhook dispatcher.
 *
 * Drains pending `outbox_events` (written by domain code in-transaction with
 * the originating mutation — see `outbox.ts`), fans each event out to every
 * active subscription whose `topics[]` overlaps the event's topic, then POSTs
 * the payload to each subscriber with an `X-Inkwell-Signature` header.
 *
 * Retry policy (plan §11):
 *   - 5 total attempts.
 *   - Backoff schedule: 1s, 4s, 16s, 64s, 256s (exponential ×4 from 1s).
 *   - After attempt 5 fails: status='dead'; visible in the admin deliveries
 *     view, no further retries scheduled.
 *
 * Runs against `migratorDb` (BYPASSRLS) on purpose: this is a cross-tenant
 * maintenance job — the scheduler / worker enqueues it without any HTTP
 * request, so there is no `app.store_id` setting in scope. The dispatcher
 * must read every store's outbox and write deliveries on each store's behalf.
 * (Same posture as `reservation-ttl-sweep.ts`.)
 *
 * Idempotency: outbox rows are flipped to status='dispatched' only after the
 * fanout INSERT completes. A re-run finds zero `pending` rows for an already-
 * dispatched event — so duplicate POSTs are bounded by re-deliveries of an
 * already-created `webhook_deliveries` row whose `status='pending'` and
 * `next_try_at <= now()`. The `webhook_deliveries.attempts` counter caps
 * total POSTs at 5.
 *
 * Batch size: 200 outbox events per call. Subscribers are looked up once per
 * batch (cached by storeId) to keep DB round-trips bounded.
 */

import { and, arrayOverlaps, eq, lte, or, isNull, sql } from 'drizzle-orm';
import { migratorDb } from '@/db/client';
import { logger } from '@/lib/logger';
import {
  outboxEvents,
  webhooks,
  webhookDeliveries,
} from '@/db/schema/webhooks';
import { signWebhookPayload } from './signature';
import { DeliveryNotFoundError } from './errors';

/** Maximum outbox rows processed per dispatchOutboxBatch call. */
export const OUTBOX_BATCH_SIZE = 200;

/** Maximum POST attempts before flipping a delivery to 'dead'. */
export const MAX_DELIVERY_ATTEMPTS = 5;

/** HTTP request timeout for the POST to a subscriber. */
export const HTTP_TIMEOUT_MS = 5000;

/** Header name on outbound POSTs — Stripe-style `t=...,v1=...` format. */
export const SIGNATURE_HEADER = 'X-Inkwell-Signature';

/**
 * Exponential backoff schedule indexed by `attempts` post-failure
 * (attempts=1 → 1s, attempts=2 → 4s, ...).
 */
const BACKOFF_SECONDS = [1, 4, 16, 64, 256];

/**
 * Compute the next-try delay in milliseconds for an `attempts` counter just
 * incremented to the given value. Returns null when the value is past the end
 * of the schedule (caller should flip the row to 'dead' instead).
 */
export function backoffMs(attempts: number): number | null {
  if (attempts < 1 || attempts > BACKOFF_SECONDS.length) return null;
  const seconds = BACKOFF_SECONDS[attempts - 1];
  if (seconds === undefined) return null;
  return seconds * 1000;
}

export interface DispatchOutboxResult {
  /** Number of outbox events processed in this batch. */
  events: number;
  /** Number of (event, subscriber) delivery rows newly inserted. */
  deliveriesCreated: number;
  /** Number of POST attempts made (across new deliveries + retries). */
  deliveriesAttempted: number;
  /** Subset of the above that returned 2xx. */
  deliveriesSucceeded: number;
  /** Subset that hit max retries this batch and were flipped to 'dead'. */
  deliveriesDead: number;
}

/**
 * Drain up to `OUTBOX_BATCH_SIZE` pending outbox events. For each event:
 *   1. Resolve subscribed webhooks for `event.storeId` whose `topics[]`
 *      overlaps `[event.topic]` and whose `status='active'`.
 *   2. INSERT one `webhook_deliveries` row per (event, webhook) pair, status
 *      defaults to 'pending'.
 *   3. Call `deliverOne(deliveryId)` to actually POST the body.
 *   4. After all fanout INSERTs for the event complete, flip the outbox row
 *      to status='dispatched', dispatched_at=now().
 *
 * Then process retries: select any pending deliveries whose `next_try_at <=
 * now()` (or NULL — newly created) and POST them too.
 *
 * Returns a summary suitable for log aggregation.
 */
export async function dispatchOutboxBatch(): Promise<DispatchOutboxResult> {
  const result: DispatchOutboxResult = {
    events: 0,
    deliveriesCreated: 0,
    deliveriesAttempted: 0,
    deliveriesSucceeded: 0,
    deliveriesDead: 0,
  };

  // Step 1: drain pending outbox events.
  const pending = await migratorDb
    .select()
    .from(outboxEvents)
    .where(eq(outboxEvents.status, 'pending'))
    .orderBy(outboxEvents.createdAt)
    .limit(OUTBOX_BATCH_SIZE);

  result.events = pending.length;

  // Cache subscriber lookups per (storeId, topic) to amortize DB round-trips.
  const subscriberCache = new Map<string, { id: string; secret: string; url: string }[]>();
  const newlyCreatedDeliveryIds: string[] = [];

  for (const event of pending) {
    const cacheKey = `${event.storeId}::${event.topic}`;
    let subs = subscriberCache.get(cacheKey);
    if (!subs) {
      const rows = await migratorDb
        .select({
          id: webhooks.id,
          secret: webhooks.secret,
          url: webhooks.url,
        })
        .from(webhooks)
        .where(
          and(
            eq(webhooks.storeId, event.storeId),
            eq(webhooks.status, 'active'),
            arrayOverlaps(webhooks.topics, [event.topic]),
          ),
        );
      subs = rows;
      subscriberCache.set(cacheKey, subs);
    }

    if (subs.length > 0) {
      const inserted = await migratorDb
        .insert(webhookDeliveries)
        .values(
          subs.map(s => ({
            storeId: event.storeId,
            webhookId: s.id,
            eventId: event.id,
            status: 'pending' as const,
          })),
        )
        .returning({ id: webhookDeliveries.id });

      for (const row of inserted) {
        newlyCreatedDeliveryIds.push(row.id);
      }
      result.deliveriesCreated += inserted.length;
    }

    // Flip the outbox row to 'dispatched' regardless of subscriber count —
    // an event with no subscribers is still "handled" (nothing to do).
    await migratorDb
      .update(outboxEvents)
      .set({ status: 'dispatched', dispatchedAt: sql`now()` })
      .where(eq(outboxEvents.id, event.id));
  }

  // Step 2: pick up any pending deliveries due for a retry (their next_try_at
  // is in the past), plus the freshly-inserted ones from this batch.
  const now = new Date();
  const retryCandidates = await migratorDb
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.status, 'pending'),
        or(
          isNull(webhookDeliveries.nextTryAt),
          lte(webhookDeliveries.nextTryAt, now),
        ),
      ),
    )
    .limit(OUTBOX_BATCH_SIZE);

  // Dedupe: newlyCreatedDeliveryIds is a subset of retryCandidates (they have
  // nextTryAt IS NULL), but a Set guards against any DB-side overlap.
  const toDeliver = new Set<string>([
    ...newlyCreatedDeliveryIds,
    ...retryCandidates.map(r => r.id),
  ]);

  for (const deliveryId of toDeliver) {
    try {
      const outcome = await deliverOne(deliveryId);
      result.deliveriesAttempted += 1;
      if (outcome === 'succeeded') result.deliveriesSucceeded += 1;
      else if (outcome === 'dead') result.deliveriesDead += 1;
    } catch (err) {
      logger.error(
        { err, deliveryId },
        'dispatchOutboxBatch: deliverOne threw unexpectedly',
      );
    }
  }

  logger.info(
    {
      events: result.events,
      deliveriesCreated: result.deliveriesCreated,
      deliveriesAttempted: result.deliveriesAttempted,
      deliveriesSucceeded: result.deliveriesSucceeded,
      deliveriesDead: result.deliveriesDead,
    },
    'webhook outbox batch complete',
  );

  return result;
}

/**
 * Resolve one delivery row, sign the event body, POST it to the subscriber's
 * URL with a 5s timeout, and update the delivery row based on the response.
 *
 * On 2xx: status='succeeded'.
 * On non-2xx or network/timeout error:
 *   - increment attempts
 *   - attempts >= MAX_DELIVERY_ATTEMPTS → status='dead'
 *   - else → status remains 'pending', next_try_at = now() + backoff(attempts)
 *
 * Uses `migratorDb` for the same reason as `dispatchOutboxBatch` — no HTTP
 * request context, multi-tenant maintenance work.
 */
export async function deliverOne(
  deliveryId: string,
): Promise<'succeeded' | 'failed' | 'dead'> {
  // Load delivery + parent webhook + the underlying outbox event (for payload).
  const [delivery] = await migratorDb
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.id, deliveryId));
  if (!delivery) throw new DeliveryNotFoundError(deliveryId);

  // If the row has already left the 'pending' bucket (e.g. another worker
  // beat us to it), no-op. Treat as success-or-dead per current state.
  if (delivery.status === 'succeeded') return 'succeeded';
  if (delivery.status === 'dead') return 'dead';

  const [hook] = await migratorDb
    .select()
    .from(webhooks)
    .where(eq(webhooks.id, delivery.webhookId));
  if (!hook) {
    // Subscription deleted out from under an in-flight delivery — mark dead.
    await migratorDb
      .update(webhookDeliveries)
      .set({
        status: 'dead',
        attempts: delivery.attempts + 1,
        lastAttemptAt: sql`now()`,
      })
      .where(eq(webhookDeliveries.id, deliveryId));
    return 'dead';
  }

  const [event] = await migratorDb
    .select()
    .from(outboxEvents)
    .where(eq(outboxEvents.id, delivery.eventId));
  if (!event) {
    // Outbox row missing — should not happen given FK on event_id is by uuid
    // (not enforced) but bail safely.
    await migratorDb
      .update(webhookDeliveries)
      .set({
        status: 'dead',
        attempts: delivery.attempts + 1,
        lastAttemptAt: sql`now()`,
      })
      .where(eq(webhookDeliveries.id, deliveryId));
    return 'dead';
  }

  // Build the POST body. We use a JSON envelope so subscribers can demux by
  // topic and correlate via id without parsing the inner payload.
  const envelope = {
    id: event.id,
    topic: event.topic,
    created_at: event.createdAt.toISOString(),
    data: event.payload,
  };
  const body = JSON.stringify(envelope);
  const timestamp = Math.floor(Date.now() / 1000);
  const signatureHeader = signWebhookPayload(hook.secret, body, timestamp);

  let responseCode: number | null = null;
  let responseBodyText: string | null = null;
  let ok = false;

  try {
    const res = await fetch(hook.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [SIGNATURE_HEADER]: signatureHeader,
      },
      body,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    responseCode = res.status;
    // Capture up to ~8KB of response body for diagnostics. Subscribers don't
    // need to return a body but we record what they do return.
    try {
      const text = await res.text();
      responseBodyText = text.length > 8192 ? text.slice(0, 8192) : text;
    } catch {
      responseBodyText = null;
    }
    ok = res.ok; // 200–299
  } catch (err) {
    // Network error, DNS failure, timeout — leaves responseCode null.
    responseBodyText =
      err instanceof Error ? err.message.slice(0, 8192) : 'unknown fetch error';
    ok = false;
  }

  const nextAttempts = delivery.attempts + 1;

  if (ok) {
    await migratorDb
      .update(webhookDeliveries)
      .set({
        status: 'succeeded',
        attempts: nextAttempts,
        lastAttemptAt: sql`now()`,
        responseCode,
        body: responseBodyText,
        nextTryAt: null,
      })
      .where(eq(webhookDeliveries.id, deliveryId));
    return 'succeeded';
  }

  if (nextAttempts >= MAX_DELIVERY_ATTEMPTS) {
    await migratorDb
      .update(webhookDeliveries)
      .set({
        status: 'dead',
        attempts: nextAttempts,
        lastAttemptAt: sql`now()`,
        responseCode,
        body: responseBodyText,
        nextTryAt: null,
      })
      .where(eq(webhookDeliveries.id, deliveryId));
    return 'dead';
  }

  const backoff = backoffMs(nextAttempts);
  const nextTryAt = backoff !== null ? new Date(Date.now() + backoff) : null;

  await migratorDb
    .update(webhookDeliveries)
    .set({
      status: 'pending',
      attempts: nextAttempts,
      lastAttemptAt: sql`now()`,
      responseCode,
      body: responseBodyText,
      nextTryAt,
    })
    .where(eq(webhookDeliveries.id, deliveryId));
  return 'failed';
}

