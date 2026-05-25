import { and, eq, sql } from 'drizzle-orm';
import { withTenant } from '@/modules/tenant/with-tenant';
import { productVariants, products } from '@/db/schema/catalog';
import {
  ProductNotFoundError,
  VariantNotFoundError,
  SkuConflictError,
} from './errors';

export type VariantRow = typeof productVariants.$inferSelect;
export type VariantStatus = VariantRow['status'];

export type CreateVariantInput = {
  sku: string;
  name?: string | null;
  barcode?: string | null;
  axes?: Record<string, string | number>;
  priceCents: number;
  compareAtCents?: number | null;
  costCents?: number | null;
  weightG?: number | null;
  status?: VariantStatus;
};

export type UpdateVariantInput = Partial<Omit<CreateVariantInput, 'sku'>> & {
  sku?: string;
};

export type BaseVariantFields = Omit<CreateVariantInput, 'sku' | 'axes'> & {
  /** Optional prefix used when synthesizing SKU codes for matrix variants. */
  skuPrefix?: string;
};

export async function listVariants(storeId: string, productId: string): Promise<VariantRow[]> {
  return withTenant(storeId, async tx => {
    return tx
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, productId))
      .orderBy(productVariants.createdAt);
  });
}

export async function getVariantById(
  storeId: string,
  variantId: string,
): Promise<VariantRow | null> {
  return withTenant(storeId, async tx => {
    const rows = await tx
      .select()
      .from(productVariants)
      .where(eq(productVariants.id, variantId))
      .limit(1);
    return rows[0] ?? null;
  });
}

export async function createVariant(
  storeId: string,
  productId: string,
  input: CreateVariantInput,
): Promise<VariantRow> {
  return withTenant(storeId, async tx => {
    // Verify product exists in tenant scope (RLS hides cross-tenant rows).
    const parent = await tx
      .select({ id: products.id, storeId: products.storeId })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    if (!parent[0]) throw new ProductNotFoundError(productId);

    // SKU uniqueness within tenant (DB constraint is the ultimate authority).
    const dupe = await tx
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(eq(productVariants.sku, input.sku))
      .limit(1);
    if (dupe[0]) throw new SkuConflictError(input.sku);

    const inserted = await tx
      .insert(productVariants)
      .values({
        productId,
        storeId,
        sku: input.sku,
        name: input.name ?? null,
        barcode: input.barcode ?? null,
        axes: input.axes ?? {},
        priceCents: input.priceCents,
        compareAtCents: input.compareAtCents ?? null,
        costCents: input.costCents ?? null,
        weightG: input.weightG ?? null,
        status: input.status ?? 'active',
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error('createVariant: insert returned no row');
    return row;
  });
}

export async function updateVariant(
  storeId: string,
  variantId: string,
  patch: UpdateVariantInput,
): Promise<VariantRow> {
  return withTenant(storeId, async tx => {
    const current = await tx
      .select()
      .from(productVariants)
      .where(eq(productVariants.id, variantId))
      .limit(1);
    if (!current[0]) throw new VariantNotFoundError(variantId);

    if (patch.sku && patch.sku !== current[0].sku) {
      const dupe = await tx
        .select({ id: productVariants.id })
        .from(productVariants)
        .where(eq(productVariants.sku, patch.sku))
        .limit(1);
      if (dupe[0]) throw new SkuConflictError(patch.sku);
    }

    const updated = await tx
      .update(productVariants)
      .set({
        ...(patch.sku !== undefined ? { sku: patch.sku } : {}),
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.barcode !== undefined ? { barcode: patch.barcode } : {}),
        ...(patch.axes !== undefined ? { axes: patch.axes } : {}),
        ...(patch.priceCents !== undefined ? { priceCents: patch.priceCents } : {}),
        ...(patch.compareAtCents !== undefined ? { compareAtCents: patch.compareAtCents } : {}),
        ...(patch.costCents !== undefined ? { costCents: patch.costCents } : {}),
        ...(patch.weightG !== undefined ? { weightG: patch.weightG } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(productVariants.id, variantId))
      .returning();
    const row = updated[0];
    if (!row) throw new VariantNotFoundError(variantId);
    return row;
  });
}

export async function deleteVariant(storeId: string, variantId: string): Promise<void> {
  await withTenant(storeId, async tx => {
    const result = await tx
      .delete(productVariants)
      .where(eq(productVariants.id, variantId))
      .returning({ id: productVariants.id });
    if (!result[0]) throw new VariantNotFoundError(variantId);
  });
}

/**
 * Cartesian-product variant creation.
 *
 * Given `axes = { size: ['A4', 'A5'], color: ['red', 'blue'] }` produces 4
 * variants with axes `{size, color}` and SKUs of the form
 * `<skuPrefix>-<size>-<color>` (or `<productId-short>-<size>-<color>` when no
 * prefix supplied). Each variant gets the same `base` price/weight/status.
 *
 * Throws SkuConflictError on the first colliding SKU (transaction rolls back).
 */
export async function matrixCreate(
  storeId: string,
  productId: string,
  axes: Record<string, string[]>,
  base: BaseVariantFields,
): Promise<VariantRow[]> {
  return withTenant(storeId, async tx => {
    const parent = await tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    if (!parent[0]) throw new ProductNotFoundError(productId);

    const keys = Object.keys(axes);
    if (keys.length === 0) {
      throw new Error('matrixCreate: axes must contain at least one dimension');
    }
    for (const k of keys) {
      const vals = axes[k];
      if (!vals || vals.length === 0) {
        throw new Error(`matrixCreate: axis '${k}' must have at least one value`);
      }
    }

    // Cartesian product.
    const combos: Record<string, string>[] = [{}];
    for (const k of keys) {
      const next: Record<string, string>[] = [];
      const vals = axes[k]!;
      for (const partial of combos) {
        for (const v of vals) {
          next.push({ ...partial, [k]: v });
        }
      }
      combos.splice(0, combos.length, ...next);
    }

    const prefix = base.skuPrefix ?? productId.slice(0, 8);
    const rows: VariantRow[] = [];
    for (const combo of combos) {
      const suffix = keys.map(k => combo[k]).join('-');
      const sku = `${prefix}-${suffix}`;

      const dupe = await tx
        .select({ id: productVariants.id })
        .from(productVariants)
        .where(eq(productVariants.sku, sku))
        .limit(1);
      if (dupe[0]) throw new SkuConflictError(sku);

      const inserted = await tx
        .insert(productVariants)
        .values({
          productId,
          storeId,
          sku,
          name: base.name ?? null,
          barcode: base.barcode ?? null,
          axes: combo,
          priceCents: base.priceCents,
          compareAtCents: base.compareAtCents ?? null,
          costCents: base.costCents ?? null,
          weightG: base.weightG ?? null,
          status: base.status ?? 'active',
        })
        .returning();
      const row = inserted[0];
      if (!row) throw new Error('matrixCreate: insert returned no row');
      rows.push(row);
    }
    return rows;
  });
}

// Silence unused-import linter — re-exported for completeness.
void and;
