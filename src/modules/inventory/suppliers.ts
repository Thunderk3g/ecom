/**
 * Suppliers module — CRUD for `suppliers`.
 *
 * Suppliers carry purchase orders. Deletion is blocked when any purchase
 * order is still active (status NOT IN ('received', 'cancelled')) — surface
 * as SupplierInUseError so the HTTP layer can return 409. Listing uses cursor
 * pagination (newest-first by `created_at` with `id` tiebreaker).
 */

import { and, count, desc, eq, lt, notInArray, or, type SQL } from 'drizzle-orm';
import { withTenant } from '@/modules/tenant/with-tenant';
import { suppliers, purchaseOrders } from '@/db/schema/inventory';
import { decodeCursor, encodeCursor, parseLimit } from '@/lib/cursor';
import { SupplierInUseError, SupplierNotFoundError } from './errors';

export interface SupplierContact {
  email?: string;
  phone?: string;
  address?: string;
}

export interface SupplierRow {
  id: string;
  storeId: string;
  name: string;
  contact: SupplierContact | null;
  leadTimeDays: number | null;
  createdAt: Date;
}

export interface CreateSupplierInput {
  name: string;
  contact?: SupplierContact;
  leadTimeDays?: number;
}

export interface UpdateSupplierInput {
  name?: string;
  contact?: SupplierContact | null;
  leadTimeDays?: number | null;
}

export interface ListSuppliersOptions {
  cursor?: string;
  limit?: number;
}

export interface ListSuppliersResult {
  items: SupplierRow[];
  nextCursor: string | null;
}

function toRow(r: {
  id: string;
  storeId: string;
  name: string;
  contact: SupplierContact | null;
  leadTimeDays: number | null;
  createdAt: Date;
}): SupplierRow {
  return {
    id: r.id,
    storeId: r.storeId,
    name: r.name,
    contact: r.contact,
    leadTimeDays: r.leadTimeDays,
    createdAt: r.createdAt,
  };
}

/**
 * Cursor-paginated listing, newest first by `created_at` desc with `id`
 * as the deterministic tiebreaker. Cursor encodes `{ k: createdAt-iso, id }`.
 */
export async function listSuppliers(
  storeId: string,
  opts: ListSuppliersOptions = {},
): Promise<ListSuppliersResult> {
  const limit = parseLimit(opts.limit?.toString());

  return withTenant(storeId, async tx => {
    const filters: SQL[] = [];

    if (opts.cursor) {
      const decoded = decodeCursor(opts.cursor);
      if (decoded) {
        const cutoff = new Date(decoded.k);
        // (created_at < cutoff) OR (created_at = cutoff AND id < cursorId)
        filters.push(
          or(
            lt(suppliers.createdAt, cutoff),
            and(eq(suppliers.createdAt, cutoff), lt(suppliers.id, decoded.id)),
          ) as SQL,
        );
      }
    }

    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const rows = await tx
      .select()
      .from(suppliers)
      .where(whereClause)
      .orderBy(desc(suppliers.createdAt), desc(suppliers.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    const items = sliced.map(toRow);

    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ k: last.createdAt.toISOString(), id: last.id })
        : null;

    return { items, nextCursor };
  });
}

export async function getSupplier(
  storeId: string,
  supplierId: string,
): Promise<SupplierRow> {
  return withTenant(storeId, async tx => {
    const [row] = await tx
      .select()
      .from(suppliers)
      .where(eq(suppliers.id, supplierId));
    if (!row) throw new SupplierNotFoundError(supplierId);
    return toRow(row);
  });
}

export async function createSupplier(
  storeId: string,
  input: CreateSupplierInput,
): Promise<SupplierRow> {
  return withTenant(storeId, async tx => {
    const [row] = await tx
      .insert(suppliers)
      .values({
        storeId,
        name: input.name,
        contact: input.contact ?? null,
        leadTimeDays: input.leadTimeDays ?? null,
      })
      .returning();
    if (!row) throw new Error('suppliers insert returned no row');
    return toRow(row);
  });
}

export async function updateSupplier(
  storeId: string,
  supplierId: string,
  input: UpdateSupplierInput,
): Promise<SupplierRow> {
  return withTenant(storeId, async tx => {
    const patch: {
      name?: string;
      contact?: SupplierContact | null;
      leadTimeDays?: number | null;
    } = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.contact !== undefined) patch.contact = input.contact;
    if (input.leadTimeDays !== undefined) patch.leadTimeDays = input.leadTimeDays;

    if (Object.keys(patch).length === 0) {
      const [row] = await tx
        .select()
        .from(suppliers)
        .where(eq(suppliers.id, supplierId));
      if (!row) throw new SupplierNotFoundError(supplierId);
      return toRow(row);
    }

    const [row] = await tx
      .update(suppliers)
      .set(patch)
      .where(eq(suppliers.id, supplierId))
      .returning();
    if (!row) throw new SupplierNotFoundError(supplierId);
    return toRow(row);
  });
}

/**
 * Active PO statuses that block supplier deletion. 'received' and 'cancelled'
 * are terminal — past business with the supplier shouldn't keep their record
 * pinned. Anything else (draft, placed, partial) represents in-flight work.
 */
const TERMINAL_PO_STATUSES = ['received', 'cancelled'] as const;

/**
 * Delete a supplier. Refuses with SupplierInUseError when any non-terminal
 * purchase order references it. We do NOT cascade-delete POs: orders are an
 * audit record. Cancel or complete them first.
 *
 * Note: the schema's FK on `purchase_orders.supplier_id` already uses
 * `ON DELETE RESTRICT`, so the DB would reject the delete anyway — but
 * surfacing a typed error with the count is friendlier than catching a
 * raw FK violation upstream.
 */
export async function deleteSupplier(
  storeId: string,
  supplierId: string,
): Promise<void> {
  return withTenant(storeId, async tx => {
    const [existing] = await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(eq(suppliers.id, supplierId));
    if (!existing) throw new SupplierNotFoundError(supplierId);

    const [activity] = await tx
      .select({ n: count() })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.supplierId, supplierId),
          notInArray(purchaseOrders.status, [...TERMINAL_PO_STATUSES]),
        ),
      );

    const activeCount = Number(activity?.n ?? 0);
    if (activeCount > 0) {
      throw new SupplierInUseError(supplierId, activeCount);
    }

    await tx.delete(suppliers).where(eq(suppliers.id, supplierId));
  });
}
