import postgres, { type Sql } from 'postgres';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { inventoryAlertsQueue, QUEUE_NAMES } from '@/queue/queues';

/**
 * Listens to the Postgres `inventory_alerts` NOTIFY channel and forwards each
 * notification onto the `inventory.alerts` BullMQ queue.
 *
 * Why `DATABASE_URL` (the `app_migrator` role) and not `appDb` (`app_user`,
 * RLS-bound)? LISTEN/NOTIFY in Postgres is **not** filtered by RLS — but a
 * connection that opens with a tenant `SET LOCAL app.store_id` only sees that
 * tenant's life. The worker is a long-lived background process serving every
 * store; it must observe alerts across all stores, so it deliberately uses
 * the BYPASSRLS migrator role. This is the ONLY runtime path outside of
 * migrations that uses the migrator role — the listener never writes, and
 * the BullMQ job it enqueues carries the `store_id` from the payload so the
 * downstream email render (later SP) can re-scope back into a tenant
 * transaction via `withTenant(storeId, …)`.
 */
const NOTIFY_CHANNEL = 'inventory_alerts';

interface RawAlertPayload {
  store_id: string;
  variant_id: string;
  location_id: string;
  available: number;
  reorder_point: number;
}

function isAlertPayload(value: unknown): value is RawAlertPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.store_id === 'string' &&
    typeof v.variant_id === 'string' &&
    typeof v.location_id === 'string' &&
    typeof v.available === 'number' &&
    typeof v.reorder_point === 'number'
  );
}

export interface InventoryAlertsListener {
  /** Close the listener connection. Idempotent. */
  stop(): Promise<void>;
}

export async function startInventoryAlertsListener(): Promise<InventoryAlertsListener> {
  // Dedicated connection: postgres-js holds the underlying socket open for
  // the lifetime of the LISTEN, so it must not be pulled from a pool that may
  // recycle / time out idle connections.
  const sql: Sql = postgres(env.DATABASE_URL, {
    max: 1,
    prepare: false,
    onnotice: () => {},
  });

  const handle = await sql.listen(
    NOTIFY_CHANNEL,
    payload => {
      void handleNotification(payload);
    },
    () => {
      logger.info({ channel: NOTIFY_CHANNEL }, 'inventory alerts listener connected');
    },
  );

  return {
    async stop(): Promise<void> {
      try {
        await handle.unlisten();
      } catch (err) {
        logger.warn({ err }, 'inventory alerts listener: unlisten failed');
      }
      try {
        await sql.end({ timeout: 5 });
      } catch (err) {
        logger.warn({ err }, 'inventory alerts listener: close failed');
      }
    },
  };
}

async function handleNotification(payload: string): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (err) {
    logger.error({ err, payload }, 'inventory alerts: invalid JSON payload');
    return;
  }

  if (!isAlertPayload(parsed)) {
    logger.error({ payload: parsed }, 'inventory alerts: payload schema mismatch');
    return;
  }

  try {
    await inventoryAlertsQueue.add(
      'threshold-breach',
      {
        storeId: parsed.store_id,
        variantId: parsed.variant_id,
        locationId: parsed.location_id,
        available: parsed.available,
        reorderPoint: parsed.reorder_point,
      },
      {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );
    logger.info(
      {
        queue: QUEUE_NAMES.inventoryAlerts,
        storeId: parsed.store_id,
        variantId: parsed.variant_id,
        locationId: parsed.location_id,
      },
      'inventory alert enqueued',
    );
  } catch (err) {
    logger.error({ err, payload: parsed }, 'inventory alerts: enqueue failed');
  }
}
