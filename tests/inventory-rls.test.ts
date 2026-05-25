/**
 * Inventory RLS isolation — cross-store visibility and append-only enforcement.
 *
 * Two stores A and B each have a variant + location + movement. Under
 * `withTenant(A)`:
 *   - SELECT on stock_movements only returns A's rows.
 *   - UPDATE on stock_movements is enforced as append-only: the 0009 policy
 *     `no_update FOR UPDATE USING(false)` makes every row invisible to UPDATE,
 *     so no row in the table can ever be modified. Postgres reports this as
 *     "0 rows updated", not as a thrown exception (USING-false filters rows
 *     out of the candidate set rather than raising on a WITH CHECK violation).
 *     We assert that the targeted row's `reason` is unchanged after the call.
 *   - DELETE follows the same shape: `no_delete` filters everything out,
 *     resulting in 0 rows deleted and the data still present.
 *
 * Cross-store: a tenant-A-scoped UPDATE/DELETE targeting B's rows also affects
 * zero rows (B's rows are invisible under A's RLS policies).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { resetAndMigrate } from './_setup/db';
import { appClient, migratorClient } from '@/db/client';
import { withTenant } from '@/modules/tenant/with-tenant';
import {
  createLocationFixture,
  createStore,
  createVariant,
  seedOnHand,
} from './_setup/inventory-fixtures';

describe('inventory RLS isolation', () => {
  let storeA: string;
  let storeB: string;
  let variantA: string;
  let variantB: string;
  let locationA: string;
  let locationB: string;

  beforeAll(async () => {
    await resetAndMigrate();
    const a = await createStore('rls-a');
    const b = await createStore('rls-b');
    storeA = a.id;
    storeB = b.id;

    const va = await createVariant(storeA, { sku: 'rls-a-sku', productSlug: 'rls-a-prod' });
    const vb = await createVariant(storeB, { sku: 'rls-b-sku', productSlug: 'rls-b-prod' });
    variantA = va.variantId;
    variantB = vb.variantId;

    const la = await createLocationFixture(storeA, { code: 'rls-a-loc' });
    const lb = await createLocationFixture(storeB, { code: 'rls-b-loc' });
    locationA = la.id;
    locationB = lb.id;

    await seedOnHand(storeA, variantA, locationA, 5);
    await seedOnHand(storeB, variantB, locationB, 7);
  });

  afterAll(async () => {
    await appClient.end();
    await migratorClient.end();
  });

  it('SELECT stock_movements under tenant A only returns A rows', async () => {
    const rows = await withTenant(storeA, async tx =>
      tx.execute(sql`SELECT store_id, variant_id, qty FROM stock_movements`),
    );
    const list = rows as unknown as { store_id: string; variant_id: string; qty: number }[];
    expect(list.length).toBeGreaterThanOrEqual(1);
    for (const r of list) {
      expect(r.store_id).toBe(storeA);
      expect(r.variant_id).toBe(variantA);
    }
    // Sanity: B's rows DO exist in the table (visible to migrator).
    const bRows = await migratorClient<{ store_id: string }[]>`
      SELECT store_id FROM stock_movements WHERE store_id = ${storeB}
    `;
    expect(bRows.length).toBeGreaterThanOrEqual(1);
  });

  it('UPDATE stock_movements is rejected by append-only RLS policy (0 rows affected)', async () => {
    // The `no_update FOR UPDATE USING(false)` policy makes every row invisible
    // to UPDATE — Postgres reports "0 rows updated" rather than raising.
    const result = await withTenant(storeA, async tx =>
      tx.execute(
        sql`UPDATE stock_movements SET reason = 'tampered' WHERE store_id = ${storeA} RETURNING id`,
      ),
    );
    const updated = result as unknown as { id: string }[];
    expect(updated).toHaveLength(0);

    // Verify data untouched (use migratorClient to bypass RLS).
    const allRows = await migratorClient<{ reason: string | null }[]>`
      SELECT reason FROM stock_movements WHERE store_id = ${storeA}
    `;
    for (const r of allRows) {
      expect(r.reason).not.toBe('tampered');
    }
  });

  it('DELETE stock_movements is rejected by append-only RLS policy (0 rows affected)', async () => {
    const before = await migratorClient<{ count: string }[]>`
      SELECT count(*)::text AS count FROM stock_movements WHERE store_id = ${storeA}
    `;
    const beforeCount = Number(before[0]!.count);

    const result = await withTenant(storeA, async tx =>
      tx.execute(sql`DELETE FROM stock_movements WHERE store_id = ${storeA} RETURNING id`),
    );
    const deleted = result as unknown as { id: string }[];
    expect(deleted).toHaveLength(0);

    const after = await migratorClient<{ count: string }[]>`
      SELECT count(*)::text AS count FROM stock_movements WHERE store_id = ${storeA}
    `;
    expect(Number(after[0]!.count)).toBe(beforeCount);
  });
});
