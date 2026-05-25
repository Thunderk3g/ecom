import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { resetAndMigrate } from './_setup/db';
import { migratorClient } from '@/db/client';
import { withTenant } from '@/modules/tenant/with-tenant';
import { products } from '@/db/schema/catalog';
import { createProduct, listProducts } from '@/modules/catalog/products';

describe('catalog RLS — cross-tenant isolation', () => {
  let storeA: string;
  let storeB: string;
  let productAId: string;
  let productBId: string;

  beforeAll(async () => {
    await resetAndMigrate();

    // Two tenants seeded via migratorDb (BYPASSRLS).
    await migratorClient`INSERT INTO stores (slug, name) VALUES ('a', 'A'), ('b', 'B')`;
    const rows = await migratorClient<{ id: string; slug: string }[]>`
      SELECT id, slug FROM stores ORDER BY slug
    `;
    storeA = rows.find(r => r.slug === 'a')!.id;
    storeB = rows.find(r => r.slug === 'b')!.id;

    // Insert a product in each store via the tenant-scoped module service.
    const pA = await createProduct(storeA, {
      slug: 'item-a',
      name: 'Item A',
      status: 'active',
    });
    productAId = pA.id;
    const pB = await createProduct(storeB, {
      slug: 'item-b',
      name: 'Item B',
      status: 'active',
    });
    productBId = pB.id;
  });

  afterAll(async () => {
    await migratorClient.end();
  });

  it("under withTenant(A) only A's rows are visible", async () => {
    const { items: aItems } = await listProducts(storeA, { limit: 200 });
    const aIds = aItems.map(p => p.id);
    expect(aIds).toContain(productAId);
    expect(aIds).not.toContain(productBId);

    const { items: bItems } = await listProducts(storeB, { limit: 200 });
    const bIds = bItems.map(p => p.id);
    expect(bIds).toContain(productBId);
    expect(bIds).not.toContain(productAId);
  });

  it("INSERT with another store's store_id raises policy violation", async () => {
    // Inside withTenant(storeA) any INSERT with storeId=storeB must be
    // rejected by the WITH CHECK clause of the products RLS policy.
    // drizzle wraps the underlying postgres error; assert on the cause's
    // sqlstate (42501 = insufficient_privilege / RLS violation) and message.
    let caught: unknown;
    try {
      await withTenant(storeA, async tx => {
        await tx.insert(products).values({
          storeId: storeB,
          slug: 'sneaky',
          name: 'Sneaky cross-tenant insert',
          status: 'active',
        });
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    // The drizzle-wrapped error exposes the postgres cause via `cause`.
    const root = (caught as { cause?: unknown }).cause ?? caught;
    const rootMessage = String((root as Error).message ?? '');
    const rootCode = (root as { code?: string }).code;
    const matches =
      /row-level security|policy|new row violates/i.test(rootMessage) ||
      rootCode === '42501';
    expect(matches).toBe(true);
  });

  it("migratorDb (BYPASSRLS) sees both stores' rows; proves RLS is the filter", async () => {
    // Migrator role bypasses RLS, so it should see all rows regardless of
    // app.store_id. This proves the isolation we asserted above came from
    // the RLS policy, not from the application filtering by store_id.
    const allRows = await migratorClient<{ id: string; slug: string; store_id: string }[]>`
      SELECT id, slug, store_id FROM products ORDER BY slug
    `;
    const ids = allRows.map(r => r.id);
    expect(ids).toContain(productAId);
    expect(ids).toContain(productBId);
  });

  it('app_user inside withTenant uses NOBYPASSRLS role', async () => {
    const result = await withTenant(storeA, async tx => {
      return tx.execute(sql`SELECT current_user::text AS u`);
    });
    const rows = result as unknown as { u: string }[];
    expect(rows[0]!.u).toBe('app_user');
  });
});
