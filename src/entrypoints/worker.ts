import 'dotenv/config';
import { Worker, Queue } from 'bullmq';
import { logger } from '@/lib/logger';
import { makeRedisConnection, redis } from '@/lib/redis';
import { QUEUE_NAMES } from '@/queue/queues';
import { reservationTtlSweep } from '@/queue/jobs/reservation-ttl-sweep';
import { cartTtlSweep } from '@/queue/jobs/cart-ttl-sweep';
import { inventoryAlerts } from '@/queue/jobs/inventory-alerts';
import { ordersStalePaymentSweep } from '@/queue/jobs/orders-stale-payment-sweep';
import { webhookDispatch } from '@/queue/jobs/webhook-dispatch';
import { imagePostProcess } from '@/queue/jobs/image-post-process';
import {
  startInventoryAlertsListener,
  type InventoryAlertsListener,
} from '@/modules/inventory/alerts';

// Queues that still rely on SP-1 stub handlers (real processors land in later SPs).
const STUB_QUEUES = [
  QUEUE_NAMES.emails,
  QUEUE_NAMES.csvImports,
  QUEUE_NAMES.searchReindex,
] as const;

async function main(): Promise<void> {
  logger.info({ role: 'worker' }, 'worker starting');

  const workers: Worker[] = [];

  // Real SP-3 processors.
  workers.push(
    new Worker(QUEUE_NAMES.reservationTtlSweep, reservationTtlSweep, {
      connection: makeRedisConnection(),
    }),
  );
  workers.push(
    new Worker(QUEUE_NAMES.inventoryAlerts, inventoryAlerts, {
      connection: makeRedisConnection(),
    }),
  );

  // Real SP-4 processors.
  workers.push(
    new Worker(QUEUE_NAMES.cartTtlSweep, cartTtlSweep, {
      connection: makeRedisConnection(),
    }),
  );

  // Real SP-5 processors. webhook.dispatch's handler currently delegates to
  // the (in-flight) dispatchOutboxBatch module — once Stream D lands the
  // job handler picks it up without touching this file.
  workers.push(
    new Worker(QUEUE_NAMES.ordersStalePaymentSweep, ordersStalePaymentSweep, {
      connection: makeRedisConnection(),
    }),
  );
  workers.push(
    new Worker(QUEUE_NAMES.webhookDispatch, webhookDispatch, {
      connection: makeRedisConnection(),
    }),
  );

  // Real SP-8 processor: image.post-process generates derivative rows.
  workers.push(
    new Worker(QUEUE_NAMES.imagePostProcess, imagePostProcess, {
      connection: makeRedisConnection(),
    }),
  );

  // Stub processors for queues that don't have real handlers yet. Touching
  // the Queue ensures the BullMQ key exists in Redis so producers can enqueue.
  for (const name of STUB_QUEUES) {
    new Queue(name, { connection: redis });
    workers.push(
      new Worker(
        name,
        async job => {
          logger.info({ queue: name, id: job.id, data: job.data }, 'job received (no-op stub)');
        },
        { connection: makeRedisConnection() },
      ),
    );
  }

  // Start the Postgres LISTEN client (see alerts.ts for why this uses the
  // migrator URL — TL;DR: LISTEN must observe every store's notifications).
  let alertsListener: InventoryAlertsListener | undefined;
  try {
    alertsListener = await startInventoryAlertsListener();
  } catch (err) {
    logger.error({ err }, 'failed to start inventory alerts listener');
    throw err;
  }

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'worker shutting down');
    void (async (): Promise<void> => {
      try {
        await Promise.all(workers.map(w => w.close()));
      } catch (err) {
        logger.warn({ err }, 'worker close failed');
      }
      try {
        await alertsListener?.stop();
      } catch (err) {
        logger.warn({ err }, 'alerts listener stop failed');
      }
      process.exit(0);
    })();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  logger.info(
    {
      role: 'worker',
      processors: [
        QUEUE_NAMES.reservationTtlSweep,
        QUEUE_NAMES.inventoryAlerts,
        QUEUE_NAMES.cartTtlSweep,
        QUEUE_NAMES.ordersStalePaymentSweep,
        QUEUE_NAMES.webhookDispatch,
        QUEUE_NAMES.imagePostProcess,
      ],
      stubs: STUB_QUEUES,
    },
    'worker ready',
  );
}

main().catch(err => {
  logger.error({ err }, 'worker failed to start');
  process.exit(1);
});
