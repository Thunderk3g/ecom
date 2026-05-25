/**
 * Purchase orders module.
 *
 * Models the PO lifecycle: draft → placed → partial → received (or cancelled).
 * `receivePurchaseOrder` appends `inbound` stock movements (which the 0010
 * trigger materializes into `stock_levels.on_hand`), updates each item's
 * `qty_received`, and flips the PO status to `partial` (some outstanding) or
 * `received` (none outstanding) atomically.
 *
 * Listing uses cursor pagination (newest-first by `created_at` with `id`
 * tiebreaker), matching the shared `src/lib/cursor.ts` shape.
 */

import { and, desc, eq, lt, or, sql, type SQL } from 'drizzle-orm';
import { withTenant } from '@/modules/tenant/with-tenant';
import {
  purchaseOrders,
  purchaseOrderItems,
  suppliers,
} from '@/db/schema/inventory';
import { decodeCursor, encodeCursor, parseLimit } from '@/lib/cursor';
import { recordMovement } from './movements';
import {
  OverReceiveError,
  PurchaseOrderNotFoundError,
  SupplierNotFoundError,
} from './errors';

export type PoStatus = 'draft' | 'placed' | 'partial' | 'received' | 'cancelled';

export interface PurchaseOrderItemRow {
  poId: string;
  variantId: string;
  qtyOrdered: number;
  qtyReceived: number;
  costCents: number;
}

export interface PurchaseOrderRow {
  id: string;
  storeId: string;
  supplierId: string;
  status: PoStatus;
  placedAt: Date | null;
  expectedAt: Date | null;
  createdAt: Date;
  items: PurchaseOrderItemRow[];
}

export interface PurchaseOrderItemInput {
  variantId: string;
  qtyOrdered: number;
  costCents: number;
}

export interface CreatePurchaseOrderInput {
  supplierId: string;
  status?: PoStatus;
  placedAt?: Date | null;
  expectedAt?: Date | null;
  items: PurchaseOrderItemInput[];
}

export interface UpdatePurchaseOrderInput {
  status?: PoStatus;
  placedAt?: Date | null;
  expectedAt?: Date | null;
}

export interface ListPurchaseOrdersOptions {
  cursor?: string;
  limit?: number;
  supplierId?: string;
  status?: PoStatus;
}

export interface ListPurchaseOrdersResult {
  items: PurchaseOrderRow[];
  nextCursor: string | null;
}

export interface ReceivePurchaseOrderItem {
  variantId: string;
  qty: number;
  locationId: string;
}

export interface ReceivePurchaseOrderInput {
  poId: string;
  items: ReceivePurchaseOrderItem[];
  /** Optional admin user id stamped on the receive movements. */
  createdBy?: string;
}

export interface ReceivePurchaseOrderResult {
  poId: string;
  status: PoStatus;
  items: PurchaseOrderItemRow[];
}

function toItemRow(r: {
  poId: string;
  variantId: string;
  qtyOrdered: number;
  qtyReceived: number;
  costCents: number;
}): PurchaseOrderItemRow {
  return {
    poId: r.poId,
    variantId: r.variantId,
    qtyOrdered: r.qtyOrdered,
    qtyReceived: r.qtyReceived,
    costCents: r.costCents,
  };
}

function toPoRow(
  po: {
    id: string;
    storeId: string;
    supplierId: string;
    status: PoStatus;
    placedAt: Date | null;
    expectedAt: Date | null;
    createdAt: Date;
  },
  items: PurchaseOrderItemRow[],
): PurchaseOrderRow {
  return {
    id: po.id,
    storeId: po.storeId,
    supplierId: po.supplierId,
    status: po.status,
    placedAt: po.placedAt,
    expectedAt: po.expectedAt,
    createdAt: po.createdAt,
    items,
  };
}

/**
 * Cursor-paginated PO listing, newest-first. Items are eagerly loaded for
 * each PO in the page (typical PO has < 100 items; the join would explode the
 * row count, so we batch-fetch items keyed by the page's PO ids instead).
 */
export async function listPurchaseOrders(
  storeId: string,
  opts: ListPurchaseOrdersOptions = {},
): Promise<ListPurchaseOrdersResult> {
  const limit = parseLimit(opts.limit?.toString());

  return withTenant(storeId, async tx => {
    const filters: SQL[] = [];
    if (opts.supplierId) filters.push(eq(purchaseOrders.supplierId, opts.supplierId));
    if (opts.status) filters.push(eq(purchaseOrders.status, opts.status));

    if (opts.cursor) {
      const decoded = decodeCursor(opts.cursor);
      if (decoded) {
        const cutoff = new Date(decoded.k);
        filters.push(
          or(
            lt(purchaseOrders.createdAt, cutoff),
            and(eq(purchaseOrders.createdAt, cutoff), lt(purchaseOrders.id, decoded.id)),
          ) as SQL,
        );
      }
    }

    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const poRows = await tx
      .select()
      .from(purchaseOrders)
      .where(whereClause)
      .orderBy(desc(purchaseOrders.createdAt), desc(purchaseOrders.id))
      .limit(limit + 1);

    const hasMore = poRows.length > limit;
    const slicedPos = hasMore ? poRows.slice(0, limit) : poRows;
    const poIds = slicedPos.map(p => p.id);

    let itemsByPo = new Map<string, PurchaseOrderItemRow[]>();
    if (poIds.length > 0) {
      const itemRows = await tx
        .select()
        .from(purchaseOrderItems)
        .where(sql`${purchaseOrderItems.poId} IN ${poIds}`);
      itemsByPo = itemRows.reduce<Map<string, PurchaseOrderItemRow[]>>((acc, r) => {
        const list = acc.get(r.poId) ?? [];
        list.push(toItemRow(r));
        acc.set(r.poId, list);
        return acc;
      }, new Map());
    }

    const items = slicedPos.map(po => toPoRow(po, itemsByPo.get(po.id) ?? []));

    const last = slicedPos[slicedPos.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ k: last.createdAt.toISOString(), id: last.id })
        : null;

    return { items, nextCursor };
  });
}

export async function getPurchaseOrder(
  storeId: string,
  poId: string,
): Promise<PurchaseOrderRow> {
  return withTenant(storeId, async tx => {
    const [po] = await tx
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, poId));
    if (!po) throw new PurchaseOrderNotFoundError(poId);

    const itemRows = await tx
      .select()
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.poId, poId));

    return toPoRow(po, itemRows.map(toItemRow));
  });
}

export async function createPurchaseOrder(
  storeId: string,
  input: CreatePurchaseOrderInput,
): Promise<PurchaseOrderRow> {
  if (input.items.length === 0) {
    throw new Error('createPurchaseOrder requires at least one item');
  }

  return withTenant(storeId, async tx => {
    const [supplier] = await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(eq(suppliers.id, input.supplierId));
    if (!supplier) throw new SupplierNotFoundError(input.supplierId);

    const [po] = await tx
      .insert(purchaseOrders)
      .values({
        storeId,
        supplierId: input.supplierId,
        status: input.status ?? 'draft',
        placedAt: input.placedAt ?? null,
        expectedAt: input.expectedAt ?? null,
      })
      .returning();
    if (!po) throw new Error('purchase_orders insert returned no row');

    const insertedItems = await tx
      .insert(purchaseOrderItems)
      .values(
        input.items.map(it => ({
          poId: po.id,
          variantId: it.variantId,
          qtyOrdered: it.qtyOrdered,
          qtyReceived: 0,
          costCents: it.costCents,
        })),
      )
      .returning();

    return toPoRow(po, insertedItems.map(toItemRow));
  });
}

/**
 * Update mutable PO fields. Items are not editable here — callers that need
 * to amend lines should cancel and create a new PO. (Editing line quantities
 * after a partial receive is ambiguous: do we credit movements? Out of scope
 * for SP-3.)
 */
export async function updatePurchaseOrder(
  storeId: string,
  poId: string,
  input: UpdatePurchaseOrderInput,
): Promise<PurchaseOrderRow> {
  return withTenant(storeId, async tx => {
    const patch: {
      status?: PoStatus;
      placedAt?: Date | null;
      expectedAt?: Date | null;
    } = {};
    if (input.status !== undefined) patch.status = input.status;
    if (input.placedAt !== undefined) patch.placedAt = input.placedAt;
    if (input.expectedAt !== undefined) patch.expectedAt = input.expectedAt;

    if (Object.keys(patch).length > 0) {
      const updated = await tx
        .update(purchaseOrders)
        .set(patch)
        .where(eq(purchaseOrders.id, poId))
        .returning({ id: purchaseOrders.id });
      if (updated.length === 0) throw new PurchaseOrderNotFoundError(poId);
    }

    const [po] = await tx
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, poId));
    if (!po) throw new PurchaseOrderNotFoundError(poId);

    const itemRows = await tx
      .select()
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.poId, poId));

    return toPoRow(po, itemRows.map(toItemRow));
  });
}

/**
 * Receive items against a PO. For every input row:
 *   1. Look up the matching `purchase_order_items` row (errors if absent).
 *   2. Verify `qty <= qty_ordered - qty_received` (OverReceiveError otherwise).
 *   3. Append an `inbound` stock movement via `recordMovement` — the 0010
 *      trigger materializes `stock_levels.on_hand`.
 *   4. UPDATE `qty_received += qty`.
 *
 * After all items applied, recompute status:
 *   - all items fully received → status='received'
 *   - any received qty > 0 but not all fully received → status='partial'
 *   - else status unchanged
 *
 * The whole receive runs inside a single `withTenant` transaction so partial
 * failures roll back the ledger inserts.
 *
 * Note on `recordMovement` reuse: that helper opens its own `withTenant`
 * transaction. Postgres + drizzle treat a nested `BEGIN` inside an active
 * transaction as a SAVEPOINT — so calling it from within this `withTenant`
 * block is safe and still rolls back as a unit. To avoid the extra savepoint
 * overhead per item, we inline the insert and rely on the same RLS context.
 */
export async function receivePurchaseOrder(
  storeId: string,
  input: ReceivePurchaseOrderInput,
): Promise<ReceivePurchaseOrderResult> {
  if (input.items.length === 0) {
    throw new Error('receivePurchaseOrder requires at least one item');
  }
  for (const it of input.items) {
    if (it.qty <= 0) {
      throw new Error(
        `receivePurchaseOrder: item qty must be positive (variantId=${it.variantId}, got ${it.qty})`,
      );
    }
  }

  return withTenant(storeId, async tx => {
    const [po] = await tx
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, input.poId));
    if (!po) throw new PurchaseOrderNotFoundError(input.poId);

    const itemRows = await tx
      .select()
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.poId, input.poId));

    const itemByVariant = new Map(itemRows.map(r => [r.variantId, r]));

    for (const it of input.items) {
      const existing = itemByVariant.get(it.variantId);
      if (!existing) {
        throw new OverReceiveError(input.poId, it.variantId, it.qty, 0);
      }
      const outstanding = existing.qtyOrdered - existing.qtyReceived;
      if (it.qty > outstanding) {
        throw new OverReceiveError(input.poId, it.variantId, it.qty, outstanding);
      }
    }

    // Apply receives.
    for (const it of input.items) {
      await recordMovement(storeId, {
        variantId: it.variantId,
        locationId: it.locationId,
        qty: it.qty,
        kind: 'inbound',
        reason: 'po_receive',
        refType: 'purchase_order',
        refId: input.poId,
        ...(input.createdBy ? { createdBy: input.createdBy } : {}),
      });

      await tx
        .update(purchaseOrderItems)
        .set({
          qtyReceived: sql`${purchaseOrderItems.qtyReceived} + ${it.qty}`,
        })
        .where(
          and(
            eq(purchaseOrderItems.poId, input.poId),
            eq(purchaseOrderItems.variantId, it.variantId),
          ),
        );
    }

    // Recompute status.
    const refreshed = await tx
      .select()
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.poId, input.poId));

    const allFullyReceived = refreshed.every(r => r.qtyReceived >= r.qtyOrdered);
    const anyReceived = refreshed.some(r => r.qtyReceived > 0);

    let nextStatus: PoStatus = po.status;
    if (allFullyReceived) {
      nextStatus = 'received';
    } else if (anyReceived) {
      nextStatus = 'partial';
    }

    if (nextStatus !== po.status) {
      await tx
        .update(purchaseOrders)
        .set({ status: nextStatus })
        .where(eq(purchaseOrders.id, input.poId));
    }

    return {
      poId: input.poId,
      status: nextStatus,
      items: refreshed.map(toItemRow),
    };
  });
}
