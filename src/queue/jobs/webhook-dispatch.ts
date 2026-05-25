import type { Job } from 'bullmq';
import { logger } from '@/lib/logger';

/**
 * Webhook dispatch job.
 *
 * Drains the outbox in batches: looks up subscribed webhooks per topic, writes
 * webhook_deliveries rows, POSTs payloads with HMAC signature headers, and
 * updates delivery status + retry backoff. The canonical implementation lives
 * in `src/modules/webhooks/dispatch.ts` (Stream D of SP-5); this job handler
 * is a thin wrapper that delegates to `dispatchOutboxBatch()`.
 *
 * TODO(SP-5 Stream D): swap the no-op below for the real call once
 * `@/modules/webhooks/dispatch` lands:
 *
 *   import { dispatchOutboxBatch } from '@/modules/webhooks/dispatch';
 *   ...
 *   const result = await dispatchOutboxBatch();
 *   return result;
 *
 * Until then this handler is intentionally a no-op so the worker can register
 * the queue and the scheduler's 30s cadence isn't dead-lettered. The sweep is
 * idempotent (the real implementation marks outbox rows 'dispatched' after
 * delivery, so a re-run on the same batch finds zero pending rows).
 */
export async function webhookDispatch(
  _job: Job<Record<string, unknown>>,
): Promise<{ dispatched: number }> {
  logger.debug(
    { jobId: _job.id },
    'webhook dispatch: stub no-op (awaiting SP-5 Stream D dispatchOutboxBatch)',
  );
  return { dispatched: 0 };
}
