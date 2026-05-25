/**
 * Cart RLS — cross-tenant isolation for the `carts` table.
 *
 * Mirrors catalog-rls.test.ts. Two stores; a cart created in store A must
 * not be visible from a `withTenant(B)` transaction, and a direct INSERT
 * with another store's store_id must be rejected by the WITH CHECK clause.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { resetAndMigrate } from './_setup/db';
import { migratorClient, migratorDb } from '@/db/client';
import { withTenant } from '@/modules/tenant/with-tenant';
import { carts } from '@/db/schema/carts';
import { createCart, getCart } from '@/modules/cart/cart';
import { createCartTenant } from './_setup/cart-fixtures';

describe('cart RLS — cross-tenant isolation', () => {
  let storeA: string;
  let storeB: string;
  let cartA: string;

  beforeAll(async () => {
    await resetAndMigrate();
    const a = await createCartTenant('rls-a');
    const b = await createCartTenant('rls-b');
    storeA = a.storeId;
    storeB = b.storeId;
    // Cart in store A.
    const created = await createCart(storeA, { sessionId: 'rls-A-sess' });
    cartA = created.id;
  });

  afterAll(async () => {
    await migratorClient.end();
  });

  it("withTenant(B) cannot see store A's cart via getCart", async () => {
    const fromB = await getCart(storeB, cartA);
    expect(fromB).toBeNull();
    const fromA = await getCart(storeA, cartA);
    expect(fromA?.id).toBe(cartA);
  });

  it("INSERT INTO carts with another store's store_id raises policy violation", async () => {
    let caught: unknown;
    try {
      await withTenant(storeA, async tx => {
        await tx.insert(carts).values({
          storeId: storeB,
          sessionId: 'sneaky',
          expiresAt: new Date(Date.now() + 86400_000),
        });
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const root = (caught as { cause?: unknown }).cause ?? caught;
    const rootMessage = String((root as Error).message ?? '');
    const rootCode = (root as { code?: string }).code;
    const matches =
      /row-level security|policy|new row violates/i.test(rootMessage) || rootCode === '42501';
    expect(matches).toBe(true);
  });

  it('migratorDb (BYPASSRLS) sees both stores rows; proves RLS is the filter', async () => {
    const allRows = await migratorDb.select().from(carts);
    const storeIds = new Set(allRows.map(r => r.storeId));
    expect(storeIds.has(storeA)).toBe(true);

    // Insert a cart for store B via migrator to prove BYPASSRLS sees it too.
    const inserted = await migratorClient<{ id: string }[]>`
      INSERT INTO carts (store_id, session_id, expires_at)
      VALUES (${storeB}, 'rls-B-direct', ${new Date(Date.now() + 86400_000).toISOString()}::timestamptz)
      RETURNING id
    `;
    const bCartId = inserted[0]!.id;
    const allRows2 = await migratorDb.select().from(carts).where(eq(carts.storeId, storeB));
    expect(allRows2.map(r => r.id)).toContain(bCartId);

    // Confirm store A's withTenant view doesn't include the B cart.
    const aView = await withTenant(storeA, async tx =>
      tx.select().from(carts).where(eq(carts.storeId, storeB)),
    );
    expect(aView).toHaveLength(0);
  });
});
