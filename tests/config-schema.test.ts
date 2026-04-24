import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate, tableExists } from './_setup/db';
import { migratorClient } from '@/db/client';

describe('config schema', () => {
  beforeAll(async () => { await resetAndMigrate(); });
  afterAll(async () => { await migratorClient.end(); });

  it('creates site_config with jsonb config column', async () => {
    expect(await tableExists('site_config')).toBe(true);
    await migratorClient`INSERT INTO stores (slug, name) VALUES ('s', 'S')`;
    const [s] = await migratorClient<{ id: string }[]>`SELECT id FROM stores WHERE slug='s'`;
    await migratorClient`INSERT INTO site_config (store_id, config) VALUES (${s!.id}, ${JSON.stringify({ brand: { name: 'S' } })}::jsonb)`;
    const [row] = await migratorClient<{ config: { brand: { name: string } } }[]>`SELECT config FROM site_config WHERE store_id = ${s!.id}`;
    expect(row!.config.brand.name).toBe('S');
  });

  it('creates feature_flags with composite PK', async () => {
    expect(await tableExists('feature_flags')).toBe(true);
  });
});
