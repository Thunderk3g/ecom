import 'server-only';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { resolveTenant } from '@/modules/tenant/resolve';
import { loadSiteConfig } from '@/modules/config/loader';
import type { SiteConfig } from '@/platform.defaults';

/**
 * Resolved per-request storefront context for server components.
 *
 * Every storefront page calls `getStoreContext()` once at the top of its render
 * to learn (a) which tenant it is serving (from the `x-store-host` header the
 * middleware stamps) and (b) that tenant's merged `site_config`. An unknown
 * host triggers a 404 — the storefront only serves recognised tenants.
 */
export type StoreContext = {
  storeId: string;
  config: SiteConfig;
};

/**
 * Resolve the tenant + its site_config for the current request. Throws Next's
 * `notFound()` (→ 404) when the host header does not map to a known store, so
 * callers can use the return value unconditionally.
 */
export async function getStoreContext(): Promise<StoreContext> {
  const h = await headers();
  const host = h.get('x-store-host') ?? '';
  const storeId = host ? await resolveTenant(host) : null;
  if (!storeId) notFound();
  const config = await loadSiteConfig(storeId);
  return { storeId, config };
}
