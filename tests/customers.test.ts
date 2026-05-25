/**
 * Customers module — upsertCustomer + linkCustomerToUser semantics.
 *
 * upsertCustomer (no userId): creates a guest row. Second call with the same
 * email returns the SAME row (deduped via partial unique index on
 * (store_id, email) WHERE user_id IS NULL).
 *
 * linkCustomerToUser: flips a guest row to a logged-in customer by setting
 * user_id.
 *
 * EmailConflictError: when an upsertCustomer with userId targets an email
 * already owned by a *different* registered user in the same store.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate } from './_setup/db';
import { appClient, migratorClient } from '@/db/client';
import {
  upsertCustomer,
  linkCustomerToUser,
} from '@/modules/customers/customers';
import { EmailConflictError } from '@/modules/customers/errors';
import { createStore } from './_setup/inventory-fixtures';

async function createUser(email: string): Promise<string> {
  const rows = await migratorClient<{ id: string }[]>`
    INSERT INTO users (email, password_hash) VALUES (${email}, 'fake-hash')
    RETURNING id
  `;
  const id = rows[0]?.id;
  if (!id) throw new Error(`createUser: insert returned no row for ${email}`);
  return id;
}

describe('customers module', () => {
  let storeId: string;

  beforeAll(async () => {
    await resetAndMigrate();
    const store = await createStore('cust-store');
    storeId = store.id;
  });

  afterAll(async () => {
    await appClient.end();
    await migratorClient.end();
  });

  it('upsertCustomer creates a guest row (no userId)', async () => {
    const c = await upsertCustomer(storeId, {
      email: 'guest1@test.local',
      phone: '+1-555-0001',
    });
    expect(c.userId).toBeNull();
    expect(c.email).toBe('guest1@test.local');
    expect(c.phone).toBe('+1-555-0001');
  });

  it('upsertCustomer second call with same email returns same row', async () => {
    const first = await upsertCustomer(storeId, { email: 'guest2@test.local' });
    const second = await upsertCustomer(storeId, {
      email: 'guest2@test.local',
      phone: '+1-555-0002',
    });
    expect(second.id).toBe(first.id);
    // Merged fields update.
    expect(second.phone).toBe('+1-555-0002');
  });

  it('linkCustomerToUser flips guest row to user-bound', async () => {
    const guest = await upsertCustomer(storeId, {
      email: 'guest3@test.local',
    });
    expect(guest.userId).toBeNull();

    const userId = await createUser('user3@test.local');
    const linked = await linkCustomerToUser(storeId, guest.id, userId);

    expect(linked.id).toBe(guest.id);
    expect(linked.userId).toBe(userId);
  });

  it('EmailConflictError when registered user uses email already owned by another registered user', async () => {
    const userA = await createUser('rega@test.local');
    const userB = await createUser('regb@test.local');

    // Register A with email shared@test.local.
    const a = await upsertCustomer(storeId, {
      userId: userA,
      email: 'shared@test.local',
    });
    expect(a.userId).toBe(userA);

    // Register B trying to claim the same email → conflict.
    await expect(
      upsertCustomer(storeId, {
        userId: userB,
        email: 'shared@test.local',
      }),
    ).rejects.toBeInstanceOf(EmailConflictError);
  });
});
