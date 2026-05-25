/**
 * Inventory purchase orders — create, partial receive, full receive, over-receive guard.
 *
 * receivePurchaseOrder() appends `inbound` stock movements (which the 0010
 * trigger materializes into stock_levels.on_hand) and updates qty_received
 * atomically.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate } from './_setup/db';
import { appClient, migratorClient } from '@/db/client';
import {
  createPurchaseOrder,
  receivePurchaseOrder,
} from '@/modules/inventory/purchase-orders';
import { createSupplier } from '@/modules/inventory/suppliers';
import { OverReceiveError } from '@/modules/inventory/errors';
import {
  createLocationFixture,
  createStore,
  createVariant,
} from './_setup/inventory-fixtures';

describe('inventory purchase orders', () => {
  let storeId: string;
  let supplierId: string;
  let variantId: string;
  let locationId: string;

  beforeAll(async () => {
    await resetAndMigrate();
    const store = await createStore('po-store');
    storeId = store.id;
    const supplier = await createSupplier(storeId, { name: 'Acme' });
    supplierId = supplier.id;
    const v = await createVariant(storeId);
    variantId = v.variantId;
    const loc = await createLocationFixture(storeId);
    locationId = loc.id;
  });

  afterAll(async () => {
    await appClient.end();
    await migratorClient.end();
  });

  it('partial receive: status=partial, on_hand at location +30', async () => {
    const po = await createPurchaseOrder(storeId, {
      supplierId,
      status: 'placed',
      items: [{ variantId, qtyOrdered: 50, costCents: 100 }],
    });

    const receive1 = await receivePurchaseOrder(storeId, {
      poId: po.id,
      items: [{ variantId, qty: 30, locationId }],
    });
    expect(receive1.status).toBe('partial');
    expect(receive1.items[0]!.qtyReceived).toBe(30);

    const [level] = await migratorClient<{ on_hand: number }[]>`
      SELECT on_hand FROM stock_levels
        WHERE variant_id = ${variantId} AND location_id = ${locationId}
    `;
    expect(level!.on_hand).toBe(30);

    // Receive the remaining 20 → status='received', on_hand +50 total.
    const receive2 = await receivePurchaseOrder(storeId, {
      poId: po.id,
      items: [{ variantId, qty: 20, locationId }],
    });
    expect(receive2.status).toBe('received');
    expect(receive2.items[0]!.qtyReceived).toBe(50);

    const [levelFinal] = await migratorClient<{ on_hand: number }[]>`
      SELECT on_hand FROM stock_levels
        WHERE variant_id = ${variantId} AND location_id = ${locationId}
    `;
    expect(levelFinal!.on_hand).toBe(50);
  });

  it('over-receive raises OverReceiveError', async () => {
    const v2 = await createVariant(storeId);
    const po = await createPurchaseOrder(storeId, {
      supplierId,
      status: 'placed',
      items: [{ variantId: v2.variantId, qtyOrdered: 10, costCents: 50 }],
    });

    await expect(
      receivePurchaseOrder(storeId, {
        poId: po.id,
        items: [{ variantId: v2.variantId, qty: 15, locationId }],
      }),
    ).rejects.toBeInstanceOf(OverReceiveError);
  });
});
