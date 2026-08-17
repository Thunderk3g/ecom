import { eq } from 'drizzle-orm';
import { withTenant } from '@/modules/tenant/with-tenant';
import { stores } from '@/db/schema/tenancy';

/**
 * Resolve a store's slug — the first path segment of every object key, so every
 * MediaProvider call that builds or derives a key needs it.
 *
 * Falls back to 'store' rather than throwing: a missing slug should not fail an
 * asset render. Callers that need to distinguish "no such store" use the
 * tenant resolver instead.
 */
export async function getStoreSlug(storeId: string): Promise<string> {
  return withTenant(storeId, async tx => {
    const [row] = await tx.select({ slug: stores.slug }).from(stores).where(eq(stores.id, storeId));
    return row?.slug ?? 'store';
  });
}
