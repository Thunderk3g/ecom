/**
 * Address book — CRUD + default-slot semantics.
 *
 * Default rules:
 *   - 'shipping' slot is satisfied by addresses typed 'shipping' OR 'both'.
 *   - 'billing'  slot is satisfied by addresses typed 'billing'  OR 'both'.
 *   - setDefaultAddress(slot=shipping) unsets prior shipping defaults but
 *     LEAVES the billing default alone.
 *   - A 'both' address can fill either slot — setting it as default for one
 *     slot does NOT unset other 'both' defaults that fill the OTHER slot
 *     (since at this point the test only sets one slot at a time).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate } from './_setup/db';
import { appClient, migratorClient } from '@/db/client';
import {
  createAddress,
  deleteAddress,
  listAddresses,
  setDefaultAddress,
  updateAddress,
} from '@/modules/customers/addresses';
import { upsertCustomer } from '@/modules/customers/customers';
import { createStore } from './_setup/inventory-fixtures';

const SAMPLE_ADDRESS = {
  name: 'Test Customer',
  line1: '1 Example Rd',
  city: 'Mumbai',
  region: 'MH',
  postal: '400001',
  country: 'IN',
} as const;

describe('addresses module', () => {
  let storeId: string;
  let customerId: string;

  beforeAll(async () => {
    await resetAndMigrate();
    const store = await createStore('addr-store');
    storeId = store.id;
    const customer = await upsertCustomer(storeId, {
      email: 'addr-customer@test.local',
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    await appClient.end();
    await migratorClient.end();
  });

  it('CRUD: create, list, update, delete', async () => {
    const created = await createAddress(storeId, customerId, {
      ...SAMPLE_ADDRESS,
      type: 'shipping',
    });
    expect(created.customerId).toBe(customerId);
    expect(created.type).toBe('shipping');

    const list = await listAddresses(storeId, customerId);
    expect(list.some(a => a.id === created.id)).toBe(true);

    const updated = await updateAddress(storeId, created.id, {
      line1: '99 Updated St',
      city: 'Pune',
    });
    expect(updated.line1).toBe('99 Updated St');
    expect(updated.city).toBe('Pune');

    await deleteAddress(storeId, created.id);
    const afterDelete = await listAddresses(storeId, customerId);
    expect(afterDelete.some(a => a.id === created.id)).toBe(false);
  });

  it('setDefaultAddress(shipping) unsets prior shipping default, leaves billing alone', async () => {
    // Create a billing default + a shipping default first.
    const billing = await createAddress(storeId, customerId, {
      ...SAMPLE_ADDRESS,
      type: 'billing',
      isDefault: true,
    });
    const shipping1 = await createAddress(storeId, customerId, {
      ...SAMPLE_ADDRESS,
      type: 'shipping',
      isDefault: true,
    });

    // Add another shipping and promote it.
    const shipping2 = await createAddress(storeId, customerId, {
      ...SAMPLE_ADDRESS,
      type: 'shipping',
    });
    const promoted = await setDefaultAddress(
      storeId,
      customerId,
      shipping2.id,
      'shipping',
    );
    expect(promoted.isDefault).toBe(true);

    const all = await listAddresses(storeId, customerId);
    const map = new Map(all.map(a => [a.id, a]));
    // shipping1 lost its default.
    expect(map.get(shipping1.id)?.isDefault).toBe(false);
    // billing kept its default.
    expect(map.get(billing.id)?.isDefault).toBe(true);
    // shipping2 is the new default.
    expect(map.get(shipping2.id)?.isDefault).toBe(true);
  });

  it("'both' address counts for both billing and shipping slots", async () => {
    // Fresh customer to keep this test's default-state isolated.
    const c = await upsertCustomer(storeId, {
      email: 'addr-both@test.local',
    });

    const both = await createAddress(storeId, c.id, {
      ...SAMPLE_ADDRESS,
      type: 'both',
      isDefault: true,
    });
    expect(both.isDefault).toBe(true);

    // Promoting the 'both' address as billing default works (its type is
    // compatible with the slot).
    const asBilling = await setDefaultAddress(storeId, c.id, both.id, 'billing');
    expect(asBilling.isDefault).toBe(true);
    // Same row promoted as shipping default works too.
    const asShipping = await setDefaultAddress(
      storeId,
      c.id,
      both.id,
      'shipping',
    );
    expect(asShipping.isDefault).toBe(true);

    // Adding a NEW 'shipping' default should unset the 'both' row's default
    // (since 'both' fills the shipping slot).
    const newShipping = await createAddress(storeId, c.id, {
      ...SAMPLE_ADDRESS,
      type: 'shipping',
      isDefault: true,
    });
    const all = await listAddresses(storeId, c.id);
    const map = new Map(all.map(a => [a.id, a]));
    expect(map.get(both.id)?.isDefault).toBe(false);
    expect(map.get(newShipping.id)?.isDefault).toBe(true);
  });
});
