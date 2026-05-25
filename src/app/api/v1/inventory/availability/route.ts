/**
 * Storefront inventory availability endpoint.
 *
 * GET /api/v1/inventory/availability?variantId=&locationId=&qty=
 *
 * Returns a boolean-only view of stock for a variant:
 *   { data: { inStock: boolean, low: boolean } }
 *
 * Exact quantities are never leaked to the storefront — admin endpoints
 * (SP-3 task 14+) expose raw counts behind auth/RBAC.
 *
 * If `site_config.inventory.pooled_availability === true` and the caller did
 * not pass a `locationId`, availability is summed across every location for
 * the variant; `low` is forced to `false` in pooled mode because thresholds
 * are per-location.
 */

import { NextResponse } from 'next/server';
import { resolveTenant } from '@/modules/tenant/resolve';
import { loadSiteConfig } from '@/modules/config/loader';
import { checkAvailability, getPooledAvailable, isLow } from '@/modules/inventory/availability';
import { problem } from '@/lib/errors';

export async function GET(req: Request): Promise<NextResponse> {
  const host = req.headers.get('x-store-host') ?? req.headers.get('host') ?? '';
  const storeId = host ? await resolveTenant(host) : null;
  if (!storeId) {
    return problem(404, 'tenant-not-found', 'Unknown host', []);
  }

  const url = new URL(req.url);
  const variantId = url.searchParams.get('variantId');
  const locationId = url.searchParams.get('locationId');
  const qtyRaw = url.searchParams.get('qty');

  if (!variantId) {
    return problem(400, 'invalid-query', 'variantId is required', [
      { path: ['variantId'], message: 'required' },
    ]);
  }

  const qty = qtyRaw === null ? 1 : Number.parseInt(qtyRaw, 10);
  if (!Number.isFinite(qty) || qty <= 0) {
    return problem(400, 'invalid-query', 'qty must be a positive integer', [
      { path: ['qty'], message: 'must be a positive integer' },
    ]);
  }

  const cfg = await loadSiteConfig(storeId);
  const inventoryCfg = (cfg as { inventory?: { pooled_availability?: unknown } }).inventory;
  const pooled = inventoryCfg?.pooled_availability === true;

  if (pooled && !locationId) {
    const pooledAvailable = await getPooledAvailable(storeId, variantId);
    return NextResponse.json({ data: { inStock: pooledAvailable >= qty, low: false } });
  }

  if (!locationId) {
    return problem(400, 'invalid-query', 'locationId is required when pooled availability is disabled', [
      { path: ['locationId'], message: 'required' },
    ]);
  }

  const { canFulfill, available } = await checkAvailability(storeId, variantId, locationId, qty);
  const low = await isLow(storeId, variantId, locationId, available);
  return NextResponse.json({ data: { inStock: canFulfill, low } });
}
