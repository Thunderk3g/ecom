/**
 * Inventory movements module — adjustStock and transfer.
 *
 * `stock_movements` is append-only (0009 RLS policies block UPDATE/DELETE),
 * so each operation should produce an additional row in the ledger and the
 * 0010 trigger maintains `stock_levels.on_hand` in lock step.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate } from './_setup/db';
import { appClient, migratorClient } from '@/db/client';
import { adjustStock, transfer } from '@/modules/inventory/movements';
import {
  createLocationFixture,
  createStore,
  createVariant,
  seedOnHand,
} from './_setup/inventory-fixtures';

describe('inventory movements', () => {
  let storeId: string;
  let adminUserId: string;

  beforeAll(async () => {
    await resetAndMigrate();
    const store = await createStore('mov-store');
    storeId = store.id;
    // Movements module accepts an optional createdBy uuid for audit; seed a
    // throwaway user so we can pin it.
    const userRows = await migratorClient<{ id: string }[]>`
      INSERT INTO users (email, password_hash) VALUES ('mov-admin@test.local', 'x')
      RETURNING id
    `;
    adminUserId = userRows[0]!.id;
  });

  afterAll(async () => {
    await appClient.end();
    await migratorClient.end();
  });

  it('adjustStock delta=-3 decrements on_hand by 3 and writes a kind=adjustment row', async () => {
    const v = await createVariant(storeId);
    const loc = await createLocationFixture(storeId);
    await seedOnHand(storeId, v.variantId, loc.id, 10);

    await adjustStock(storeId, {
      variantId: v.variantId,
      locationId: loc.id,
      delta: -3,
      reason: 'shrinkage',
      createdBy: adminUserId,
    });

    const [level] = await migratorClient<{ on_hand: number }[]>`
      SELECT on_hand FROM stock_levels
        WHERE variant_id = ${v.variantId} AND location_id = ${loc.id}
    `;
    expect(level!.on_hand).toBe(7);

    const movements = await migratorClient<{ kind: string; qty: number; reason: string | null }[]>`
      SELECT kind, qty, reason FROM stock_movements
        WHERE variant_id = ${v.variantId} AND location_id = ${loc.id}
          AND kind = 'adjustment'
    `;
    expect(movements).toHaveLength(1);
    expect(movements[0]!.qty).toBe(-3);
    expect(movements[0]!.reason).toBe('shrinkage');
  });

  it('transfer moves qty between two locations atomically (two movements, levels balanced)', async () => {
    const v = await createVariant(storeId);
    const src = await createLocationFixture(storeId, { code: 'src-wh' });
    const dst = await createLocationFixture(storeId, { code: 'dst-wh' });

    await seedOnHand(storeId, v.variantId, src.id, 10);

    await transfer(storeId, {
      variantId: v.variantId,
      fromLocationId: src.id,
      toLocationId: dst.id,
      qty: 4,
      reason: 'rebalance',
      createdBy: adminUserId,
    });

    const [srcLevel] = await migratorClient<{ on_hand: number }[]>`
      SELECT on_hand FROM stock_levels
        WHERE variant_id = ${v.variantId} AND location_id = ${src.id}
    `;
    const [dstLevel] = await migratorClient<{ on_hand: number }[]>`
      SELECT on_hand FROM stock_levels
        WHERE variant_id = ${v.variantId} AND location_id = ${dst.id}
    `;
    expect(srcLevel!.on_hand).toBe(6);
    expect(dstLevel!.on_hand).toBe(4);

    const transferMovements = await migratorClient<{ kind: string; location_id: string; qty: number }[]>`
      SELECT kind, location_id, qty FROM stock_movements
        WHERE variant_id = ${v.variantId}
          AND kind IN ('transfer_in', 'transfer_out')
        ORDER BY id
    `;
    expect(transferMovements).toHaveLength(2);
    expect(transferMovements.map(m => m.kind).sort()).toEqual(['transfer_in', 'transfer_out']);
  });
});
