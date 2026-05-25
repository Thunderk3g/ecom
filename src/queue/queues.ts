import { Queue } from 'bullmq';
import { redis } from '@/lib/redis';

// BullMQ Queue handles used by the web (producer) and scheduler (producer)
// processes to enqueue work. Worker (consumer) processes import the job
// handlers directly and construct their own `Worker` instances in the
// worker entrypoint.
//
// Queue names map 1:1 with the spec §7 queue inventory. Names use dotted
// segments rather than slashes so they read naturally in Redis keys.

export const QUEUE_NAMES = {
  emails: 'emails',
  csvImports: 'csv.imports',
  inventoryAlerts: 'inventory.alerts',
  searchReindex: 'search.reindex',
  webhookDispatch: 'webhook.dispatch',
  imagePostProcess: 'image.post-process',
  reservationTtlSweep: 'reservation.ttl.sweep',
  cartTtlSweep: 'cart.ttl.sweep',
  ordersStalePaymentSweep: 'orders.stale-payment-sweep',
} as const;

export const emailsQueue = new Queue(QUEUE_NAMES.emails, { connection: redis });
export const inventoryAlertsQueue = new Queue(QUEUE_NAMES.inventoryAlerts, { connection: redis });
export const reservationTtlSweepQueue = new Queue(QUEUE_NAMES.reservationTtlSweep, {
  connection: redis,
});
export const cartTtlSweepQueue = new Queue(QUEUE_NAMES.cartTtlSweep, { connection: redis });
export const csvImportsQueue = new Queue(QUEUE_NAMES.csvImports, { connection: redis });
// SP-5: orders stale-payment sweep (5 min cadence) and webhook dispatch (30s
// cadence). Producers (scheduler) and consumers (worker) both reference these
// handles by name; instantiating them here keeps wiring centralized.
export const ordersStalePaymentSweepQueue = new Queue(QUEUE_NAMES.ordersStalePaymentSweep, {
  connection: redis,
});
export const webhookDispatchQueue = new Queue(QUEUE_NAMES.webhookDispatch, {
  connection: redis,
});
// SP-8: image.post-process. Producers (web finalize endpoint) reference this
// handle by name; the worker constructs its own Worker for it.
export const imagePostProcessQueue = new Queue(QUEUE_NAMES.imagePostProcess, {
  connection: redis,
});
