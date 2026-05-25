import type { Job } from 'bullmq';
import { emailsQueue } from '@/queue/queues';
import { logger } from '@/lib/logger';

/**
 * Payload published by the Postgres `inventory_alerts` NOTIFY channel and
 * mirrored when the alerts listener in `src/modules/inventory/alerts.ts`
 * enqueues this job. Fields are id-only; the eventual email renderer (later SP)
 * is responsible for enriching with product name / supplier contact / etc.
 */
export interface InventoryAlertPayload {
  storeId: string;
  variantId: string;
  locationId: string;
  available: number;
  reorderPoint: number;
}

/**
 * Inventory alert handler (SP-3 stub).
 *
 * Spec §7 — `inventory.alerts` queue. Final email rendering and SMTP send land
 * in a later SP (the `emails` queue plus an email provider integration); for
 * now the handler just logs and forwards a job onto the `emails` queue so
 * downstream wiring is testable and the queue isn't dead-lettered.
 */
export async function inventoryAlerts(
  job: Job<InventoryAlertPayload>,
): Promise<{ forwarded: true }> {
  logger.info(
    {
      jobId: job.id,
      storeId: job.data.storeId,
      variantId: job.data.variantId,
      locationId: job.data.locationId,
      available: job.data.available,
      reorderPoint: job.data.reorderPoint,
    },
    'inventory alert received',
  );

  await emailsQueue.add(
    'inventory-low-stock',
    {
      template: 'inventory-low-stock',
      storeId: job.data.storeId,
      variantId: job.data.variantId,
      locationId: job.data.locationId,
      available: job.data.available,
      reorderPoint: job.data.reorderPoint,
    },
    {
      attempts: 5,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: true,
      removeOnFail: 50,
    },
  );

  return { forwarded: true };
}
