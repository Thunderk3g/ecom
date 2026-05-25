/**
 * Shared fixture helpers for SP-3 inventory tests.
 *
 * All inserts go through `migratorClient` (BYPASSRLS) so test setup does not
 * depend on the runtime tenant scoping. Tests then exercise the module
 * services, which run under `withTenant` and the NOBYPASSRLS `app_user`.
 *
 * Variants are inserted minimally (one product + one variant per call) so the
 * inventory tests do not depend on SP-2's `seed.ts` running.
 */

import { migratorClient } from '@/db/client';

export interface StoreFixture {
  id: string;
  slug: string;
}

export async function createStore(slug: string, name?: string): Promise<StoreFixture> {
  const rows = await migratorClient<{ id: string; slug: string }[]>`
    INSERT INTO stores (slug, name) VALUES (${slug}, ${name ?? slug})
    RETURNING id, slug
  `;
  const row = rows[0];
  if (!row) throw new Error(`createStore: insert returned no row for slug=${slug}`);
  return row;
}

export interface VariantFixture {
  productId: string;
  variantId: string;
  sku: string;
}

/**
 * Insert a minimal product + variant pair under `storeId`. The variant is
 * what inventory rows hang off; product fields (slug, name) carry no semantic
 * weight for SP-3 tests.
 */
export async function createVariant(
  storeId: string,
  opts: { sku?: string; productSlug?: string; productName?: string } = {},
): Promise<VariantFixture> {
  const sku = opts.sku ?? `sku-${crypto.randomUUID().slice(0, 8)}`;
  const productSlug = opts.productSlug ?? `product-${crypto.randomUUID().slice(0, 8)}`;
  const productName = opts.productName ?? `Product ${productSlug}`;

  const prodRows = await migratorClient<{ id: string }[]>`
    INSERT INTO products (store_id, slug, name, type, status)
    VALUES (${storeId}, ${productSlug}, ${productName}, 'simple', 'active')
    RETURNING id
  `;
  const productId = prodRows[0]?.id;
  if (!productId) throw new Error('createVariant: products insert returned no row');

  const variantRows = await migratorClient<{ id: string }[]>`
    INSERT INTO product_variants (product_id, store_id, sku, price_cents, status)
    VALUES (${productId}, ${storeId}, ${sku}, 1000, 'active')
    RETURNING id
  `;
  const variantId = variantRows[0]?.id;
  if (!variantId) throw new Error('createVariant: product_variants insert returned no row');

  return { productId, variantId, sku };
}

export interface LocationFixture {
  id: string;
  code: string;
}

export async function createLocationFixture(
  storeId: string,
  opts: { code?: string; name?: string; type?: 'warehouse' | 'store' | 'transit' } = {},
): Promise<LocationFixture> {
  const code = opts.code ?? `loc-${crypto.randomUUID().slice(0, 8)}`;
  const name = opts.name ?? `Location ${code}`;
  const type = opts.type ?? 'warehouse';

  const rows = await migratorClient<{ id: string; code: string }[]>`
    INSERT INTO locations (store_id, code, name, type)
    VALUES (${storeId}, ${code}, ${name}, ${type})
    RETURNING id, code
  `;
  const row = rows[0];
  if (!row) throw new Error('createLocationFixture: insert returned no row');
  return row;
}

/**
 * Convenience: seed an initial on_hand count via a single `inbound` movement
 * (which the 0010 trigger materializes into stock_levels.on_hand).
 */
export async function seedOnHand(
  storeId: string,
  variantId: string,
  locationId: string,
  qty: number,
): Promise<void> {
  await migratorClient`
    INSERT INTO stock_movements (store_id, variant_id, location_id, qty, kind, reason)
    VALUES (${storeId}, ${variantId}, ${locationId}, ${qty}, 'inbound', 'fixture_seed')
  `;
}

/**
 * Direct reserved increment via a `reservation` movement — useful when a test
 * needs reserved > 0 without going through the reservations module (e.g.
 * availability seeding).
 */
export async function seedReserved(
  storeId: string,
  variantId: string,
  locationId: string,
  qty: number,
): Promise<void> {
  await migratorClient`
    INSERT INTO stock_movements (store_id, variant_id, location_id, qty, kind, reason)
    VALUES (${storeId}, ${variantId}, ${locationId}, ${qty}, 'reservation', 'fixture_seed')
  `;
}
