import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate } from './_setup/db';
import { migratorClient } from '@/db/client';
import { resolveTenant, invalidateTenantCache } from '@/modules/tenant/resolve';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!);

describe('resolveTenant', () => {
  let storeId: string;
  beforeAll(async () => {
    await resetAndMigrate();
    await migratorClient`INSERT INTO stores (slug, name) VALUES ('shop', 'Shop')`;
    const rows = await migratorClient<{ id: string }[]>`SELECT id FROM stores`;
    storeId = rows[0]!.id;
    await migratorClient`INSERT INTO store_domains (store_id, domain, is_primary) VALUES (${storeId}, 'shop.example.com', true)`;
    await redis.flushdb();
  });
  afterAll(async () => { await redis.quit(); await migratorClient.end(); });

  it('resolves a known domain to its store_id', async () => {
    const resolved = await resolveTenant('shop.example.com');
    expect(resolved).toBe(storeId);
  });

  it('returns null for unknown domain', async () => {
    expect(await resolveTenant('nope.example.com')).toBeNull();
  });

  it('caches successful lookups in Redis', async () => {
    await resolveTenant('shop.example.com');
    const cached = await redis.get('tenant:domain:shop.example.com');
    expect(cached).toBe(storeId);
  });

  it('invalidateTenantCache clears a domain', async () => {
    await resolveTenant('shop.example.com');
    await invalidateTenantCache('shop.example.com');
    expect(await redis.get('tenant:domain:shop.example.com')).toBeNull();
  });
});
