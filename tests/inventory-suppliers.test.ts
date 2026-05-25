/**
 * Inventory suppliers module — CRUD + deletion guard against active POs.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate } from './_setup/db';
import { appClient, migratorClient } from '@/db/client';
import {
  createSupplier,
  deleteSupplier,
  getSupplier,
  listSuppliers,
  updateSupplier,
} from '@/modules/inventory/suppliers';
import { createPurchaseOrder } from '@/modules/inventory/purchase-orders';
import {
  SupplierInUseError,
  SupplierNotFoundError,
} from '@/modules/inventory/errors';
import {
  createStore,
  createVariant,
} from './_setup/inventory-fixtures';

describe('inventory suppliers', () => {
  let storeId: string;

  beforeAll(async () => {
    await resetAndMigrate();
    const store = await createStore('sup-store');
    storeId = store.id;
  });

  afterAll(async () => {
    await appClient.end();
    await migratorClient.end();
  });

  it('create + get + list round-trip', async () => {
    const created = await createSupplier(storeId, {
      name: 'Acme Stationery',
      contact: { email: 'sales@acme.test' },
      leadTimeDays: 7,
    });
    expect(created.name).toBe('Acme Stationery');
    expect(created.contact?.email).toBe('sales@acme.test');

    const fetched = await getSupplier(storeId, created.id);
    expect(fetched.id).toBe(created.id);

    const list = await listSuppliers(storeId);
    expect(list.items.map(s => s.id)).toContain(created.id);
  });

  it('update patches mutable fields', async () => {
    const created = await createSupplier(storeId, { name: 'To Rename' });
    const patched = await updateSupplier(storeId, created.id, {
      name: 'Renamed Co',
      leadTimeDays: 14,
    });
    expect(patched.name).toBe('Renamed Co');
    expect(patched.leadTimeDays).toBe(14);
  });

  it('getSupplier throws SupplierNotFoundError for unknown id', async () => {
    await expect(getSupplier(storeId, crypto.randomUUID())).rejects.toBeInstanceOf(
      SupplierNotFoundError,
    );
  });

  it('deleteSupplier succeeds when no active purchase orders reference it', async () => {
    const created = await createSupplier(storeId, { name: 'No POs' });
    await expect(deleteSupplier(storeId, created.id)).resolves.toBeUndefined();
    await expect(getSupplier(storeId, created.id)).rejects.toBeInstanceOf(
      SupplierNotFoundError,
    );
  });

  it('deleteSupplier refuses with SupplierInUseError when active PO references it', async () => {
    const supplier = await createSupplier(storeId, { name: 'In Use' });
    const v = await createVariant(storeId);

    await createPurchaseOrder(storeId, {
      supplierId: supplier.id,
      status: 'placed',
      items: [{ variantId: v.variantId, qtyOrdered: 20, costCents: 100 }],
    });

    await expect(deleteSupplier(storeId, supplier.id)).rejects.toBeInstanceOf(
      SupplierInUseError,
    );
  });
});
