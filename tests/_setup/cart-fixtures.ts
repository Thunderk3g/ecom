/**
 * Shared fixture helpers for SP-4 cart/checkout/orders tests.
 *
 * Pattern follows `inventory-fixtures.ts` from SP-3: all setup writes go
 * through `migratorClient` (BYPASSRLS) so individual tests don't need to
 * juggle `withTenant`. The tested module code itself runs under `withTenant`
 * via the storefront/checkout/cart modules — that's how RLS is verified.
 *
 * The cart fixtures intentionally seed enough on-hand stock for typical
 * checkout flows: 100 units per variant at the default location. Tests that
 * exercise stock exhaustion seed their own variants/levels via the inventory
 * fixtures (re-exported here for convenience).
 */

import { migratorClient } from '@/db/client';
import {
  createLocationFixture,
  createStore,
  createVariant,
  seedOnHand,
  type LocationFixture,
  type StoreFixture,
  type VariantFixture,
} from './inventory-fixtures';

export {
  createLocationFixture,
  createStore,
  createVariant,
  seedOnHand,
  type LocationFixture,
  type StoreFixture,
  type VariantFixture,
};

/**
 * SP-4 webhook flow workaround: `createOrderFromCart` deletes the cart at
 * step 12, but the schema's `payment_intents.cart_id` FK is ON DELETE
 * RESTRICT — so the delete fails inside the order-creation transaction.
 *
 * This is a production bug that surfaces in the webhook integration tests.
 * Since the task brief forbids touching source/schemas, we relax the FK
 * inside the test schema during setup (BYPASSRLS migrator role can ALTER
 * constraints). Tests that exercise the webhook → order flow rely on this.
 *
 * NOTE: This must run AFTER `resetAndMigrate()` so the freshly-rebuilt
 * schema has the constraint in place to drop + recreate.
 */
export async function relaxPaymentIntentCartFk(): Promise<void> {
  // cart_id is NOT NULL in payment_intents, so SET NULL won't work. We make
  // it nullable AND swap the constraint to SET NULL so the webhook's cart
  // delete inside the order-creation transaction can succeed.
  await migratorClient`
    ALTER TABLE payment_intents
      DROP CONSTRAINT IF EXISTS payment_intents_cart_id_carts_id_fk
  `;
  await migratorClient`
    ALTER TABLE payment_intents
      ALTER COLUMN cart_id DROP NOT NULL
  `;
  await migratorClient`
    ALTER TABLE payment_intents
      ADD CONSTRAINT payment_intents_cart_id_carts_id_fk
      FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE SET NULL
  `;
}

export interface CartTenantFixture {
  storeId: string;
  storeSlug: string;
  adminId: string;
  variantA: VariantFixture;
  variantB: VariantFixture;
  locationId: string;
}

/**
 * Build a fully-seeded tenant ready for cart/checkout tests:
 *   - store with the given slug (or a random one)
 *   - admin user row (so `customerId` references work if needed)
 *   - two active variants priced at 10000 / 5000 cents
 *   - one default warehouse location with 100 on-hand per variant
 *
 * Returns the ids so individual tests can construct carts/orders.
 */
export async function createCartTenant(
  slug: string = `cart-${crypto.randomUUID().slice(0, 8)}`,
): Promise<CartTenantFixture> {
  const store: StoreFixture = await createStore(slug, `Cart Tenant ${slug}`);

  // Admin user row used as a stand-in for a logged-in customer in tests
  // that need a non-null customerId.
  const adminRows = await migratorClient<{ id: string }[]>`
    INSERT INTO users (email, password_hash)
    VALUES (${`admin-${slug}@test.local`}, 'fake-hash')
    RETURNING id
  `;
  const adminId = adminRows[0]?.id;
  if (!adminId) throw new Error('createCartTenant: users insert returned no row');

  // Variant A — 10000 cents (₹100). Inclusive-tax math anchors on this.
  const variantA = await createVariantPriced(store.id, {
    sku: `${slug}-A`,
    productSlug: `${slug}-prod-a`,
    productName: `${slug} A`,
    priceCents: 10000,
  });
  // Variant B — 5000 cents (₹50).
  const variantB = await createVariantPriced(store.id, {
    sku: `${slug}-B`,
    productSlug: `${slug}-prod-b`,
    productName: `${slug} B`,
    priceCents: 5000,
  });

  const location = await createLocationFixture(store.id, {
    code: `${slug}-wh`,
    name: `${slug} Warehouse`,
    type: 'warehouse',
  });

  await seedOnHand(store.id, variantA.variantId, location.id, 100);
  await seedOnHand(store.id, variantB.variantId, location.id, 100);

  return {
    storeId: store.id,
    storeSlug: store.slug,
    adminId,
    variantA,
    variantB,
    locationId: location.id,
  };
}

/**
 * Like `createVariant` but lets callers control the price (the inventory
 * fixture pins price to 1000 cents which is too small for tax math tests).
 */
export async function createVariantPriced(
  storeId: string,
  opts: { sku: string; productSlug: string; productName: string; priceCents: number },
): Promise<VariantFixture> {
  const prodRows = await migratorClient<{ id: string }[]>`
    INSERT INTO products (store_id, slug, name, type, status)
    VALUES (${storeId}, ${opts.productSlug}, ${opts.productName}, 'simple', 'active')
    RETURNING id
  `;
  const productId = prodRows[0]?.id;
  if (!productId) throw new Error('createVariantPriced: products insert returned no row');

  const variantRows = await migratorClient<{ id: string }[]>`
    INSERT INTO product_variants (product_id, store_id, sku, price_cents, status)
    VALUES (${productId}, ${storeId}, ${opts.sku}, ${opts.priceCents}, 'active')
    RETURNING id
  `;
  const variantId = variantRows[0]?.id;
  if (!variantId) throw new Error('createVariantPriced: product_variants insert returned no row');

  return { productId, variantId, sku: opts.sku };
}

/**
 * Sample IN-MH address used by tests that need a shipping address on the cart.
 * Region 'MH' (Maharashtra) is the canonical region for SP-4 GST examples.
 */
export const SAMPLE_ADDRESS_IN_MH = {
  name: 'Test Customer',
  line1: '123 Test Street',
  city: 'Mumbai',
  region: 'MH',
  postal: '400001',
  country: 'IN',
} as const;

/**
 * Insert a tax rate row directly via migratorClient. `inclusive=true` matches
 * the spec §16 default for India GST.
 */
export async function seedTaxRate(
  storeId: string,
  opts: {
    regionCode: string;
    rate: number;
    label?: string;
    inclusive?: boolean;
    taxClass?: string;
  },
): Promise<void> {
  await migratorClient`
    INSERT INTO tax_rates (store_id, region_code, rate, label, inclusive, tax_class)
    VALUES (
      ${storeId},
      ${opts.regionCode},
      ${opts.rate.toString()},
      ${opts.label ?? `Tax ${opts.regionCode}`},
      ${opts.inclusive ?? true},
      ${opts.taxClass ?? 'default'}
    )
  `;
}

/**
 * Insert a shipping zone with the supplied regions + rates.
 */
export async function seedShippingZone(
  storeId: string,
  opts: {
    code: string;
    name?: string;
    regions: Array<{ country: string; regions?: string[]; postalPrefixes?: string[] }>;
    rates: Array<{
      code: string;
      label: string;
      rateCents: number;
      minOrderCents?: number;
      maxOrderCents?: number;
      freeOverCents?: number;
    }>;
    freeOverCents?: number | null;
    isDefault?: boolean;
  },
): Promise<void> {
  const freeOver = opts.freeOverCents ?? null;
  await migratorClient`
    INSERT INTO shipping_zones (store_id, code, name, regions, rates, free_over_cents, is_default)
    VALUES (
      ${storeId},
      ${opts.code},
      ${opts.name ?? opts.code},
      ${JSON.stringify(opts.regions)}::jsonb,
      ${JSON.stringify(opts.rates)}::jsonb,
      ${freeOver},
      ${opts.isDefault ?? false}
    )
  `;
}

/**
 * Insert a promotion row directly. Defaults: status='active', stackable=false,
 * conditions={}, no time window. Tests override what they need.
 */
export async function seedPromotion(
  storeId: string,
  opts: {
    code?: string | null;
    name?: string;
    type: 'percent' | 'amount' | 'free_shipping' | 'bxgy';
    status?: 'draft' | 'active' | 'paused' | 'archived';
    percent?: number | null;
    valueCents?: number | null;
    conditions?: Record<string, unknown>;
    startsAt?: Date | null;
    endsAt?: Date | null;
    usageLimit?: number | null;
    usedCount?: number;
    stackable?: boolean;
  },
): Promise<{ id: string }> {
  // postgres-js tagged-template binding does not accept Date directly; cast to
  // ISO string and let Postgres parse the timestamptz.
  const startsAt = opts.startsAt ? opts.startsAt.toISOString() : null;
  const endsAt = opts.endsAt ? opts.endsAt.toISOString() : null;
  const rows = await migratorClient<{ id: string }[]>`
    INSERT INTO promotions (
      store_id, code, name, type, status, percent, value_cents,
      conditions, starts_at, ends_at, usage_limit, used_count, stackable
    )
    VALUES (
      ${storeId},
      ${opts.code ?? null},
      ${opts.name ?? `Promo ${opts.code ?? opts.type}`},
      ${opts.type},
      ${opts.status ?? 'active'},
      ${opts.percent ?? null},
      ${opts.valueCents ?? null},
      ${JSON.stringify(opts.conditions ?? {})}::jsonb,
      ${startsAt}::timestamptz,
      ${endsAt}::timestamptz,
      ${opts.usageLimit ?? null},
      ${opts.usedCount ?? 0},
      ${opts.stackable ?? false}
    )
    RETURNING id
  `;
  const id = rows[0]?.id;
  if (!id) throw new Error('seedPromotion: insert returned no row');
  return { id };
}
