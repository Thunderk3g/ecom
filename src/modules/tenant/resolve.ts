import Redis from 'ioredis';
import { sql } from 'drizzle-orm';
import { migratorDb } from '@/db/client';
import { storeDomains } from '@/db/schema/tenancy';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

const redis = new Redis(env.REDIS_URL);
const CACHE_TTL_SECONDS = 600; // 10 min
const NEG_TTL_SECONDS = 60;    // 1 min for misses, to avoid hammering DB

/**
 * Normalise an inbound Host header to the bare hostname we store in
 * `store_domains.domain`: lowercase, port stripped. Browsers send
 * `localhost:3000` (and any non-80/443 dev/staging port), but domains are
 * registered without a port, so an exact match would 404 the whole tenant.
 * The trailing `:\d+` strip leaves IPv6 literals like `[::1]` intact.
 */
function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/:\d+$/, '');
}

function key(host: string) { return `tenant:domain:${normalizeHost(host)}`; }

export async function resolveTenant(host: string): Promise<string | null> {
  const h = normalizeHost(host);
  const cached = await redis.get(key(h));
  if (cached === '__miss__') return null;
  if (cached) return cached;

  const rows = await migratorDb
    .select({ storeId: storeDomains.storeId })
    .from(storeDomains)
    .where(sql`${storeDomains.domain} = ${h}`)
    .limit(1);

  if (rows.length === 0) {
    await redis.set(key(h), '__miss__', 'EX', NEG_TTL_SECONDS);
    logger.debug({ host: h }, 'tenant resolve: miss');
    return null;
  }

  const storeId = rows[0]!.storeId;
  await redis.set(key(h), storeId, 'EX', CACHE_TTL_SECONDS);
  logger.debug({ host: h, storeId }, 'tenant resolve: hit');
  return storeId;
}

export async function invalidateTenantCache(host: string): Promise<void> {
  await redis.del(key(host.toLowerCase()));
}
