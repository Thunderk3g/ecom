import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { resetAndMigrate } from './_setup/db';
import { migratorClient } from '@/db/client';

const appUrl = process.env.DATABASE_URL!.replace('app_migrator:', 'app_user:');
const appClient = postgres(appUrl, { max: 1, prepare: false });

describe('RLS isolation', () => {
  let storeA: string;
  let storeB: string;

  beforeAll(async () => {
    await resetAndMigrate();
    await migratorClient`INSERT INTO stores (slug, name) VALUES ('a', 'A'), ('b', 'B')`;
    const rows = await migratorClient<{ id: string; slug: string }[]>`SELECT id, slug FROM stores`;
    storeA = rows.find(r => r.slug === 'a')!.id;
    storeB = rows.find(r => r.slug === 'b')!.id;
    await migratorClient`INSERT INTO customers (store_id, email) VALUES (${storeA}, 'a@x.com'), (${storeB}, 'b@x.com')`;
  });

  afterAll(async () => { await appClient.end(); await migratorClient.end(); });

  it('app_user sees only current tenant customers', async () => {
    const rows = await appClient.begin(async tx => {
      await tx`SELECT set_config('app.store_id', ${storeA}, true)`;
      return tx<{ email: string }[]>`SELECT email FROM customers`;
    });
    const emails = (rows as unknown as { email: string }[]).map(r => r.email);
    expect(emails).toEqual(['a@x.com']);
  });

  it('app_user sees no rows without app.store_id set', async () => {
    const rows = await appClient`SELECT email FROM customers`;
    expect((rows as unknown as unknown[]).length).toBe(0);
  });

  it('app_user cannot insert cross-tenant', async () => {
    await expect(appClient.begin(async tx => {
      await tx`SELECT set_config('app.store_id', ${storeA}, true)`;
      await tx`INSERT INTO customers (store_id, email) VALUES (${storeB}, 'x@x.com')`;
    })).rejects.toThrow(/row-level security|policy/i);
  });
});
