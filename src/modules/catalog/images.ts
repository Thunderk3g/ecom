import { and, eq, inArray, sql } from 'drizzle-orm';
import { withTenant } from '@/modules/tenant/with-tenant';
import { productImages, products, productVariants } from '@/db/schema/catalog';
import {
  ProductNotFoundError,
  VariantNotFoundError,
  ImageNotFoundError,
} from './errors';

export type ProductImageRow = typeof productImages.$inferSelect;

export type AttachImageInput = {
  assetId: string; // FK to assets table in SP-8 — accepted as opaque uuid here.
  variantId?: string | null;
  alt?: string | null;
  sortOrder?: number;
};

export async function listImages(
  storeId: string,
  productId: string,
): Promise<ProductImageRow[]> {
  return withTenant(storeId, async tx => {
    return tx
      .select()
      .from(productImages)
      .where(eq(productImages.productId, productId))
      .orderBy(productImages.sortOrder, productImages.createdAt);
  });
}

export async function attachImage(
  storeId: string,
  productId: string,
  input: AttachImageInput,
): Promise<ProductImageRow> {
  return withTenant(storeId, async tx => {
    const product = await tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    if (!product[0]) throw new ProductNotFoundError(productId);

    if (input.variantId) {
      const variant = await tx
        .select({ id: productVariants.id, productId: productVariants.productId })
        .from(productVariants)
        .where(eq(productVariants.id, input.variantId))
        .limit(1);
      if (!variant[0]) throw new VariantNotFoundError(input.variantId);
      if (variant[0].productId !== productId) {
        throw new VariantNotFoundError(`${input.variantId} (not on product ${productId})`);
      }
    }

    let sortOrder = input.sortOrder;
    if (sortOrder === undefined) {
      // Default sort_order: max + 1.
      const maxRows = await tx
        .select({ max: sql<number>`coalesce(max(${productImages.sortOrder}), -1)::int` })
        .from(productImages)
        .where(eq(productImages.productId, productId));
      sortOrder = (maxRows[0]?.max ?? -1) + 1;
    }

    const inserted = await tx
      .insert(productImages)
      .values({
        productId,
        storeId,
        variantId: input.variantId ?? null,
        assetId: input.assetId,
        alt: input.alt ?? null,
        sortOrder,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error('attachImage: insert returned no row');
    return row;
  });
}

/**
 * Reorder images by providing the full ordered list of image ids. Any id not
 * belonging to `productId` is rejected. Sort order is rewritten 0..n-1.
 */
export async function reorderImages(
  storeId: string,
  productId: string,
  orderedIds: string[],
): Promise<void> {
  if (orderedIds.length === 0) return;

  // Detect duplicates in the input.
  const seen = new Set<string>();
  for (const id of orderedIds) {
    if (seen.has(id)) throw new ImageNotFoundError(`duplicate id in order: ${id}`);
    seen.add(id);
  }

  await withTenant(storeId, async tx => {
    const existing = await tx
      .select({ id: productImages.id })
      .from(productImages)
      .where(
        and(eq(productImages.productId, productId), inArray(productImages.id, orderedIds)),
      );
    if (existing.length !== orderedIds.length) {
      const existingIds = new Set(existing.map(r => r.id));
      const missing = orderedIds.find(id => !existingIds.has(id));
      throw new ImageNotFoundError(missing ?? 'unknown');
    }

    for (let i = 0; i < orderedIds.length; i++) {
      await tx
        .update(productImages)
        .set({ sortOrder: i })
        .where(eq(productImages.id, orderedIds[i]!));
    }
  });
}

export async function detachImage(storeId: string, imageId: string): Promise<void> {
  await withTenant(storeId, async tx => {
    const result = await tx
      .delete(productImages)
      .where(eq(productImages.id, imageId))
      .returning({ id: productImages.id });
    if (!result[0]) throw new ImageNotFoundError(imageId);
  });
}
