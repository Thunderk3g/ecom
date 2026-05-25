/**
 * Supplier SKUs module — manage the (supplier, variant) mapping table.
 *
 * Each row records what a given supplier calls a given variant, its unit
 * cost in minor currency units (cents), and the minimum order quantity.
 * Primary key is composite `(supplier_id, variant_id)`, so `setSupplierSku`
 * upserts.
 */

import { and, asc, eq } from 'drizzle-orm';
import { withTenant } from '@/modules/tenant/with-tenant';
import { supplierSkus, suppliers } from '@/db/schema/inventory';
import { SupplierNotFoundError } from './errors';

export interface SupplierSkuRow {
  supplierId: string;
  variantId: string;
  storeId: string;
  supplierSku: string;
  costCents: number;
  moq: number;
}

export interface SetSupplierSkuInput {
  supplierId: string;
  variantId: string;
  supplierSku: string;
  costCents: number;
  moq?: number;
}

export interface ListSupplierSkusOptions {
  supplierId?: string;
  variantId?: string;
}

function toRow(r: {
  supplierId: string;
  variantId: string;
  storeId: string;
  supplierSku: string;
  costCents: number;
  moq: number;
}): SupplierSkuRow {
  return {
    supplierId: r.supplierId,
    variantId: r.variantId,
    storeId: r.storeId,
    supplierSku: r.supplierSku,
    costCents: r.costCents,
    moq: r.moq,
  };
}

/**
 * List supplier SKUs for the current tenant. Typically scoped by `supplierId`
 * (the admin "show me everything this supplier carries" screen) or by
 * `variantId` ("which suppliers carry this product"). Counts are bounded by
 * `suppliers × variants`; if this grows beyond a few thousand a cursor can
 * be added without breaking callers.
 */
export async function listSupplierSkus(
  storeId: string,
  opts: ListSupplierSkusOptions = {},
): Promise<SupplierSkuRow[]> {
  return withTenant(storeId, async tx => {
    const filters = [];
    if (opts.supplierId) filters.push(eq(supplierSkus.supplierId, opts.supplierId));
    if (opts.variantId) filters.push(eq(supplierSkus.variantId, opts.variantId));

    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const rows = await tx
      .select()
      .from(supplierSkus)
      .where(whereClause)
      .orderBy(asc(supplierSkus.supplierId), asc(supplierSkus.variantId));
    return rows.map(toRow);
  });
}

/**
 * Upsert a supplier SKU mapping. Validates that the supplier exists under
 * the current tenant before insert (the FK would also catch it, but the
 * domain error is friendlier upstream).
 */
export async function setSupplierSku(
  storeId: string,
  input: SetSupplierSkuInput,
): Promise<SupplierSkuRow> {
  return withTenant(storeId, async tx => {
    const [supplier] = await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(eq(suppliers.id, input.supplierId));
    if (!supplier) throw new SupplierNotFoundError(input.supplierId);

    const [row] = await tx
      .insert(supplierSkus)
      .values({
        storeId,
        supplierId: input.supplierId,
        variantId: input.variantId,
        supplierSku: input.supplierSku,
        costCents: input.costCents,
        moq: input.moq ?? 1,
      })
      .onConflictDoUpdate({
        target: [supplierSkus.supplierId, supplierSkus.variantId],
        set: {
          supplierSku: input.supplierSku,
          costCents: input.costCents,
          moq: input.moq ?? 1,
        },
      })
      .returning();
    if (!row) throw new Error('supplier_skus upsert returned no row');
    return toRow(row);
  });
}

export async function deleteSupplierSku(
  storeId: string,
  supplierId: string,
  variantId: string,
): Promise<void> {
  return withTenant(storeId, async tx => {
    await tx
      .delete(supplierSkus)
      .where(
        and(
          eq(supplierSkus.supplierId, supplierId),
          eq(supplierSkus.variantId, variantId),
        ),
      );
  });
}
