import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate, tableExists } from './_setup/db';
import { migratorClient } from '@/db/client';

describe('tenancy schema', () => {
  beforeAll(async () => { await resetAndMigrate(); });
  afterAll(async () => { await migratorClient.end(); });

  it('creates stores table', async () => {
    expect(await tableExists('stores')).toBe(true);
  });

  it('creates store_domains table with unique domain', async () => {
    expect(await tableExists('store_domains')).toBe(true);
    await migratorClient`INSERT INTO stores (slug, name) VALUES ('a', 'A')`;
    const [store] = await migratorClient<{ id: string }[]>`SELECT id FROM stores WHERE slug = 'a'`;
    await migratorClient`INSERT INTO store_domains (store_id, domain) VALUES (${store!.id}, 'a.example.com')`;
    await expect(
      migratorClient`INSERT INTO store_domains (store_id, domain) VALUES (${store!.id}, 'a.example.com')`
    ).rejects.toThrow(/store_domains_domain_uq/);
  });
});
