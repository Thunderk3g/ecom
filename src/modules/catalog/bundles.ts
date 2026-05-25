import { and, eq } from 'drizzle-orm';
import { withTenant } from '@/modules/tenant/with-tenant';
import { bundleComponents, productVariants, products } from '@/db/schema/catalog';
import {
  VariantNotFoundError,
  BundleSelfReferenceError,
  NotABundleError,
} from './errors';

export type BundleComponentRow = typeof bundleComponents.$inferSelect;

export type BundleComponent = {
  componentVariantId: string;
  qty: number;
};

/**
 * Add a component to a bundle. The `bundleVariantId` must point to a variant
 * whose product has `type = 'bundle'`. Self-reference is rejected.
 *
 * Idempotent: re-adding the same component updates `qty` rather than inserting
 * a duplicate row.
 */
export async function addBundleComponent(
  storeId: string,
  bundleVariantId: string,
  componentVariantId: string,
  qty: number,
): Promise<void> {
  if (qty <= 0) {
    throw new Error('addBundleComponent: qty must be a positive integer');
  }
  if (bundleVariantId === componentVariantId) {
    throw new BundleSelfReferenceError(bundleVariantId);
  }

  await withTenant(storeId, async tx => {
    // Verify bundle variant exists and belongs to a 'bundle' product.
    const bundleRows = await tx
      .select({
        variantId: productVariants.id,
        productType: products.type,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(eq(productVariants.id, bundleVariantId))
      .limit(1);
    const bundle = bundleRows[0];
    if (!bundle) throw new VariantNotFoundError(bundleVariantId);
    if (bundle.productType !== 'bundle') throw new NotABundleError(bundleVariantId);

    // Verify component variant exists.
    const componentRows = await tx
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(eq(productVariants.id, componentVariantId))
      .limit(1);
    if (!componentRows[0]) throw new VariantNotFoundError(componentVariantId);

    // Upsert via primary key (bundle_variant_id, component_variant_id).
    await tx
      .insert(bundleComponents)
      .values({ bundleVariantId, componentVariantId, qty })
      .onConflictDoUpdate({
        target: [bundleComponents.bundleVariantId, bundleComponents.componentVariantId],
        set: { qty },
      });
  });
}

export async function removeBundleComponent(
  storeId: string,
  bundleVariantId: string,
  componentVariantId: string,
): Promise<void> {
  await withTenant(storeId, async tx => {
    const result = await tx
      .delete(bundleComponents)
      .where(
        and(
          eq(bundleComponents.bundleVariantId, bundleVariantId),
          eq(bundleComponents.componentVariantId, componentVariantId),
        ),
      )
      .returning({ id: bundleComponents.bundleVariantId });
    if (!result[0]) {
      // Either the bundle variant doesn't exist or the component isn't attached.
      throw new VariantNotFoundError(`${bundleVariantId}/${componentVariantId}`);
    }
  });
}

/**
 * Return the list of components for a bundle variant. Used by SP-3 inventory
 * (to decrement components on commit) and SP-4 cart (to expand the bundle
 * into a synthetic line).
 */
export async function expandBundle(
  storeId: string,
  bundleVariantId: string,
): Promise<BundleComponent[]> {
  return withTenant(storeId, async tx => {
    const rows = await tx
      .select({
        componentVariantId: bundleComponents.componentVariantId,
        qty: bundleComponents.qty,
      })
      .from(bundleComponents)
      .where(eq(bundleComponents.bundleVariantId, bundleVariantId));
    return rows.map(r => ({ componentVariantId: r.componentVariantId, qty: r.qty }));
  });
}

/**
 * Alias to expandBundle for naming symmetry with the rest of the module
 * services (`listX` is the read primitive).
 */
export async function listComponents(
  storeId: string,
  bundleVariantId: string,
): Promise<BundleComponent[]> {
  return expandBundle(storeId, bundleVariantId);
}
