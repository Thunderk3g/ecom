import Redis from 'ioredis';
import { eq } from 'drizzle-orm';
import { migratorDb } from '@/db/client';
import { siteConfig } from '@/db/schema/config';
import { platformDefaults, type SiteConfig } from '@/platform.defaults';
import { env } from '@/lib/env';

const redis = new Redis(env.REDIS_URL);
const CACHE_TTL = 300;
const KEY = (storeId: string) => `site_config:${storeId}`;

function deepMerge<T>(base: T, override: Partial<T>): T {
  if (typeof base !== 'object' || base === null) return (override as T) ?? base;
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...(base as any) };
  for (const [k, v] of Object.entries(override ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && k in (base as any) && typeof (base as any)[k] === 'object') {
      out[k] = deepMerge((base as any)[k], v as any);
    } else out[k] = v;
  }
  return out;
}

function applyEnvOverrides<T extends object>(base: T): T {
  // Pattern: SITE_CONFIG_OVERRIDE__<dot.path>=<json> — double underscore separates path segments.
  // Example: SITE_CONFIG_OVERRIDE__brand__name="EmergencyOverride"
  const prefix = 'SITE_CONFIG_OVERRIDE__';
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith(prefix) || v === undefined) continue;
    const path = k.slice(prefix.length).split('__');
    let parsed: unknown = v;
    try { parsed = JSON.parse(v); } catch { /* leave as string */ }
    let cursor: any = patch;
    for (let i = 0; i < path.length - 1; i++) {
      cursor[path[i]!] = cursor[path[i]!] ?? {};
      cursor = cursor[path[i]!];
    }
    cursor[path[path.length - 1]!] = parsed;
  }
  return deepMerge(base, patch as Partial<T>);
}

export async function loadSiteConfig(storeId: string): Promise<SiteConfig> {
  const cached = await redis.get(KEY(storeId));
  if (cached) return JSON.parse(cached);

  const [row] = await migratorDb
    .select({ config: siteConfig.config })
    .from(siteConfig)
    .where(eq(siteConfig.storeId, storeId))
    .limit(1);

  const merged = deepMerge(platformDefaults, (row?.config ?? {}) as Partial<SiteConfig>);
  const withEnv = applyEnvOverrides(merged);

  await redis.set(KEY(storeId), JSON.stringify(withEnv), 'EX', CACHE_TTL);
  return withEnv as SiteConfig;
}

export async function invalidateSiteConfigCache(storeId: string): Promise<void> {
  await redis.del(KEY(storeId));
}
