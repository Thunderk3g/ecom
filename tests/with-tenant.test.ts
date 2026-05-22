import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { resetAndMigrate } from './_setup/db';
import { migratorClient, appClient } from '@/db/client';
import { withTenant } from '@/modules/tenant/with-tenant';

describe('withTenant', () => {
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

  it('sees only current tenant rows inside the callback', async () => {
    const emails = await withTenant(storeA, async tx =>
      tx.execute(sql`SELECT email FROM customers ORDER BY email`)
    );
    expect((emails as unknown as { email: string }[]).map(r => r.email)).toEqual(['a@x.com']);
  });

  it('rolls back on thrown error', async () => {
    await expect(withTenant(storeA, async tx => {
      await tx.execute(sql`INSERT INTO customers (store_id, email) VALUES (${storeA}, 'z@x.com')`);
      throw new Error('boom');
    })).rejects.toThrow('boom');
    const countRows = await migratorClient<{ count: string }[]>`SELECT count(*) FROM customers WHERE email='z@x.com'`;
    expect(Number(countRows[0]!.count)).toBe(0);
  });
});
