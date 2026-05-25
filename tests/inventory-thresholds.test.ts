/**
 * Inventory thresholds — NOTIFY emission when available crosses reorder_point.
 *
 * The 0010 trigger `check_threshold_breach()` fires AFTER UPDATE ON stock_levels.
 * When the materialized `available` column transitions from `> reorder_point` to
 * `<= reorder_point`, it emits a Postgres `NOTIFY inventory_alerts` with a JSON
 * payload. This test opens a dedicated postgres-js LISTEN connection (the
 * migratorClient role can't be reused because postgres-js multiplexes — we use
 * a fresh `postgres()` instance) and waits for the message.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { resetAndMigrate } from './_setup/db';
import { appClient, migratorClient } from '@/db/client';
import { adjustStock } from '@/modules/inventory/movements';
import { setThreshold } from '@/modules/inventory/thresholds';
import {
  createLocationFixture,
  createStore,
  createVariant,
  seedOnHand,
} from './_setup/inventory-fixtures';

interface AlertPayload {
  store_id: string;
  variant_id: string;
  location_id: string;
  available: number;
  reorder_point: number;
}

describe('inventory thresholds NOTIFY', () => {
  let storeId: string;
  let variantId: string;
  let locationId: string;
  let adminUserId: string;
  let listenSql: Sql;

  beforeAll(async () => {
    await resetAndMigrate();
    const store = await createStore('thr-store');
    storeId = store.id;
    const v = await createVariant(storeId);
    variantId = v.variantId;
    const loc = await createLocationFixture(storeId);
    locationId = loc.id;

    // Seed a user so the createdBy FK on stock_movements is satisfied.
    const userRows = await migratorClient<{ id: string }[]>`
      INSERT INTO users (email, password_hash) VALUES ('thr-admin@test.local', 'x')
      RETURNING id
    `;
    adminUserId = userRows[0]!.id;

    // Dedicated LISTEN client (uses migrator role for BYPASSRLS — NOTIFY is
    // cross-tenant anyway). `max: 1` keeps a single dedicated socket so the
    // LISTEN sticks.
    listenSql = postgres(process.env.DATABASE_URL!, {
      max: 1,
      prepare: false,
      onnotice: () => {},
    });
  });

  afterAll(async () => {
    // Close the LISTEN client first so its connection is released before the
    // shared pools tear down.
    try {
      await listenSql.end({ timeout: 5 });
    } catch {
      // best-effort
    }
    await appClient.end();
    await migratorClient.end();
  });

  it('NOTIFY fires when adjustment drives available below reorder_point', async () => {
    // Seed on_hand=15 (above threshold), then set threshold reorder_point=10.
    await seedOnHand(storeId, variantId, locationId, 15);
    await setThreshold(storeId, {
      variantId,
      locationId,
      reorderPoint: 10,
      reorderQty: 50,
    });

    // Subscribe to the channel. Collect the first matching payload.
    const received: AlertPayload[] = [];
    await listenSql.listen('inventory_alerts', payload => {
      try {
        const parsed = JSON.parse(payload) as AlertPayload;
        received.push(parsed);
      } catch {
        // ignore non-matching payloads
      }
    });

    // Drive available from 15 → 7 (8 below threshold). Trigger emits NOTIFY.
    await adjustStock(storeId, {
      variantId,
      locationId,
      delta: -8,
      reason: 'test_breach',
      createdBy: adminUserId,
    });

    // Wait up to 2s for the notification.
    const deadline = Date.now() + 2_000;
    while (received.length === 0 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    const match = received.find(
      p => p.variant_id === variantId && p.location_id === locationId,
    );
    expect(match).toBeDefined();
    expect(match!.store_id).toBe(storeId);
    expect(match!.available).toBe(7);
    expect(match!.reorder_point).toBe(10);
  });
});
