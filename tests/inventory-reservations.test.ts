/**
 * Inventory reservations — happy path, concurrency, TTL sweep, commit.
 *
 * The concurrency test uses two `Promise.allSettled` reserve calls racing on
 * the same (variant, location) row. The reservations module takes a
 * `SELECT ... FOR UPDATE` lock on the `stock_levels` row inside `withTenant`,
 * which serializes the two transactions — one observes the other's reserved
 * increment before deciding to throw `InsufficientStockError`.
 *
 * The TTL sweep test calls the worker job handler directly (no BullMQ); the
 * handler uses `migratorDb` (BYPASSRLS) to scan across stores.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate } from './_setup/db';
import { appClient, migratorClient } from '@/db/client';
import { commit, reserve } from '@/modules/inventory/reservations';
import { InsufficientStockError } from '@/modules/inventory/errors';
import { reservationTtlSweep } from '@/queue/jobs/reservation-ttl-sweep';
import {
  createLocationFixture,
  createStore,
  createVariant,
  seedOnHand,
} from './_setup/inventory-fixtures';
import type { Job } from 'bullmq';

describe('inventory reservations', () => {
  let storeId: string;

  beforeAll(async () => {
    await resetAndMigrate();
    const store = await createStore('res-store');
    storeId = store.id;
  });

  afterAll(async () => {
    await appClient.end();
    await migratorClient.end();
  });

  async function freshCell(): Promise<{ variantId: string; locationId: string }> {
    const v = await createVariant(storeId);
    const loc = await createLocationFixture(storeId);
    await seedOnHand(storeId, v.variantId, loc.id, 10);
    return { variantId: v.variantId, locationId: loc.id };
  }

  it('happy path: reserve 3 of 10 sets reserved=3 and available=7', async () => {
    const { variantId, locationId } = await freshCell();

    const result = await reserve(storeId, {
      cartId: crypto.randomUUID(),
      items: [{ variantId, locationId, qty: 3 }],
    });
    expect(result.reservationIds).toHaveLength(1);

    const [level] = await migratorClient<
      { on_hand: number; reserved: number; available: number }[]
    >`SELECT on_hand, reserved, available FROM stock_levels
        WHERE variant_id = ${variantId} AND location_id = ${locationId}`;
    expect(level!.on_hand).toBe(10);
    expect(level!.reserved).toBe(3);
    expect(level!.available).toBe(7);
  });

  it('concurrent reserve race: only one of two qty=6 reservers wins', async () => {
    const { variantId, locationId } = await freshCell();

    // Two reserves of 6 against an on_hand of 10 → only one fits.
    const results = await Promise.allSettled([
      reserve(storeId, {
        cartId: crypto.randomUUID(),
        items: [{ variantId, locationId, qty: 6 }],
      }),
      reserve(storeId, {
        cartId: crypto.randomUUID(),
        items: [{ variantId, locationId, qty: 6 }],
      }),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason as unknown;
    expect(reason).toBeInstanceOf(InsufficientStockError);

    const [level] = await migratorClient<{ on_hand: number; reserved: number }[]>`
      SELECT on_hand, reserved FROM stock_levels
        WHERE variant_id = ${variantId} AND location_id = ${locationId}
    `;
    expect(level!.on_hand).toBe(10);
    expect(level!.reserved).toBe(6);
  });

  it('TTL sweep: invoking the job handler flips status=expired and decrements reserved', async () => {
    const { variantId, locationId } = await freshCell();

    const { reservationIds } = await reserve(storeId, {
      cartId: crypto.randomUUID(),
      items: [{ variantId, locationId, qty: 4 }],
      ttlSeconds: 1,
    });
    const reservationId = reservationIds[0]!;

    // Wait past the 1-second TTL so the sweep query sees expires_at < now().
    await new Promise(resolve => setTimeout(resolve, 1500));

    const result = await reservationTtlSweep({} as Job<Record<string, unknown>>);
    expect(result.released).toBeGreaterThanOrEqual(1);

    const [row] = await migratorClient<{ status: string }[]>`
      SELECT status FROM stock_reservations WHERE id = ${reservationId}
    `;
    expect(row!.status).toBe('expired');

    const [level] = await migratorClient<{ on_hand: number; reserved: number }[]>`
      SELECT on_hand, reserved FROM stock_levels
        WHERE variant_id = ${variantId} AND location_id = ${locationId}
    `;
    expect(level!.on_hand).toBe(10);
    expect(level!.reserved).toBe(0);
  });

  it('commit: reserve 3 then commit flips status=committed and decrements on_hand', async () => {
    const { variantId, locationId } = await freshCell();

    const { reservationIds } = await reserve(storeId, {
      cartId: crypto.randomUUID(),
      items: [{ variantId, locationId, qty: 3 }],
    });
    expect(reservationIds).toHaveLength(1);

    const orderId = crypto.randomUUID();
    await commit(storeId, reservationIds, orderId);

    const [row] = await migratorClient<{ status: string; order_id: string | null }[]>`
      SELECT status, order_id FROM stock_reservations WHERE id = ${reservationIds[0]!}
    `;
    expect(row!.status).toBe('committed');
    expect(row!.order_id).toBe(orderId);

    const [level] = await migratorClient<{ on_hand: number; reserved: number }[]>`
      SELECT on_hand, reserved FROM stock_levels
        WHERE variant_id = ${variantId} AND location_id = ${locationId}
    `;
    expect(level!.on_hand).toBe(7);
    expect(level!.reserved).toBe(0);
  });
});
