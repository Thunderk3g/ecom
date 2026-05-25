import 'dotenv/config';
import { Queue } from 'bullmq';
import { logger } from '@/lib/logger';
import { redis } from '@/lib/redis';
import { QUEUE_NAMES } from '@/queue/queues';

async function main(): Promise<void> {
  logger.info({ role: 'scheduler' }, 'scheduler starting');

  const sweepQueue = new Queue(QUEUE_NAMES.reservationTtlSweep, { connection: redis });
  const cartSweepQueue = new Queue(QUEUE_NAMES.cartTtlSweep, { connection: redis });
  const ordersStalePaymentSweepQueue = new Queue(QUEUE_NAMES.ordersStalePaymentSweep, {
    connection: redis,
  });
  const webhookDispatchQueue = new Queue(QUEUE_NAMES.webhookDispatch, { connection: redis });

  // Upsert a Job Scheduler so re-running the scheduler is idempotent: BullMQ
  // recognises the scheduler key and updates its cadence instead of stacking
  // additional repeats. Every 60s matches the SP-3 plan; the sweep job
  // tolerates a re-run finding zero rows.
  await sweepQueue.upsertJobScheduler(
    'reservation-ttl-sweep',
    { every: 60_000 },
    {
      name: 'sweep',
      data: {},
      opts: { removeOnComplete: true, removeOnFail: 50 },
    },
  );

  // SP-4: cart TTL sweep runs every 6h. Cart expiry is on the order of days
  // (per SP-4 cart config), so we don't need the 60s cadence the reservation
  // sweep uses — 6h keeps stale carts and their reservations from lingering
  // without flooding the queue. Idempotent re-runs are a no-op.
  await cartSweepQueue.upsertJobScheduler(
    'cart-ttl-sweep',
    { every: 6 * 60 * 60 * 1000 },
    {
      name: 'sweep',
      data: {},
      opts: { removeOnComplete: true, removeOnFail: 50 },
    },
  );

  // SP-5: stale-payment sweep runs every 5 min. Threshold inside the job is
  // 30 min idle on `pending_payment`, so a 5-min cadence keeps cancellation
  // latency to ~30–35 min worst case. Idempotent re-run is a no-op.
  await ordersStalePaymentSweepQueue.upsertJobScheduler(
    'orders-stale-payment-sweep',
    { every: 5 * 60_000 },
    {
      name: 'sweep',
      data: {},
      opts: { removeOnComplete: true, removeOnFail: 50 },
    },
  );

  // SP-5: webhook dispatch runs every 30s — short cadence keeps order events
  // flowing out promptly while still batching enough work per tick to amortise
  // outbox polling cost. The job is idempotent (outbox rows flip to
  // 'dispatched' once delivered) so overlapping runs are safe.
  await webhookDispatchQueue.upsertJobScheduler(
    'webhook-dispatch',
    { every: 30_000 },
    {
      name: 'dispatch',
      data: {},
      opts: { removeOnComplete: true, removeOnFail: 50 },
    },
  );

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'scheduler shutting down');
    void (async (): Promise<void> => {
      try {
        await sweepQueue.close();
      } catch (err) {
        logger.warn({ err }, 'scheduler queue close failed');
      }
      try {
        await cartSweepQueue.close();
      } catch (err) {
        logger.warn({ err }, 'scheduler cart queue close failed');
      }
      try {
        await ordersStalePaymentSweepQueue.close();
      } catch (err) {
        logger.warn({ err }, 'scheduler stale-payment sweep queue close failed');
      }
      try {
        await webhookDispatchQueue.close();
      } catch (err) {
        logger.warn({ err }, 'scheduler webhook-dispatch queue close failed');
      }
      process.exit(0);
    })();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  logger.info(
    {
      schedulers: [
        `${QUEUE_NAMES.reservationTtlSweep}:reservation-ttl-sweep@60s`,
        `${QUEUE_NAMES.cartTtlSweep}:cart-ttl-sweep@6h`,
        `${QUEUE_NAMES.ordersStalePaymentSweep}:orders-stale-payment-sweep@5m`,
        `${QUEUE_NAMES.webhookDispatch}:webhook-dispatch@30s`,
      ],
    },
    'scheduler ready',
  );

  // Hold the process open for graceful shutdown signals.
  await new Promise<void>(() => {});
}

main().catch(err => {
  logger.error({ err }, 'scheduler failed');
  process.exit(1);
});
