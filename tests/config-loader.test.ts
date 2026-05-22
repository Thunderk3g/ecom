import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import Redis from 'ioredis';
import { resetAndMigrate } from './_setup/db';
import { migratorClient } from '@/db/client';
import { loadSiteConfig, invalidateSiteConfigCache } from '@/modules/config/loader';
import { platformDefaults } from '@/platform.defaults';

const redis = new Redis(process.env.REDIS_URL!);

describe('loadSiteConfig', () => {
  let storeId: string;
  beforeEach(async () => {
    await resetAndMigrate();
    await migratorClient`INSERT INTO stores (slug, name) VALUES ('s', 'S')`;
    const rows = await migratorClient<{ id: string }[]>`SELECT id FROM stores`;
    storeId = rows[0]!.id;
    await redis.flushdb();
  });
  afterAll(async () => { await redis.quit(); await migratorClient.end(); });

  it('returns platform defaults when no DB row and no env override', async () => {
    const cfg = await loadSiteConfig(storeId);
    expect(cfg.brand.name).toBe(platformDefaults.brand.name);
  });

  it('DB row overrides platform defaults', async () => {
    await migratorClient`INSERT INTO site_config (store_id, config) VALUES (${storeId}, ${JSON.stringify({ brand: { name: 'Inkwell' } })}::jsonb)`;
    const cfg = await loadSiteConfig(storeId);
    expect(cfg.brand.name).toBe('Inkwell');
    expect(cfg.theme.color.bg).toBe(platformDefaults.theme.color.bg); // untouched
  });

  it('env override wins over DB row', async () => {
    await migratorClient`INSERT INTO site_config (store_id, config) VALUES (${storeId}, ${JSON.stringify({ brand: { name: 'Inkwell' } })}::jsonb)`;
    vi.stubEnv('SITE_CONFIG_OVERRIDE__brand__name', 'EmergencyOverride');
    const cfg = await loadSiteConfig(storeId);
    expect(cfg.brand.name).toBe('EmergencyOverride');
    vi.unstubAllEnvs();
  });

  it('invalidate clears cache', async () => {
    await loadSiteConfig(storeId);
    expect(await redis.get(`site_config:${storeId}`)).not.toBeNull();
    await invalidateSiteConfigCache(storeId);
    expect(await redis.get(`site_config:${storeId}`)).toBeNull();
  });
});
