/**
 * Stock movements module — record, adjust, transfer, list.
 *
 * Append-only ledger. Every state change to `stock_levels` happens via a
 * `stock_movements` insert; the 0010 AFTER INSERT trigger materializes the level.
 * Never UPDATE or DELETE — the 0009 RLS policies block both.
 */

import { and, eq, gte, lte, lt, sql, desc, type SQL } from 'drizzle-orm';
import { withTenant } from '@/modules/tenant/with-tenant';
import { stockMovements, locations } from '@/db/schema/inventory';
import { LocationMismatchError } from './errors';

// Match the schema enum from src/db/schema/inventory.ts.
export type MovementKind =
  | 'inbound'
  | 'outbound'
  | 'adjustment'
  | 'reservation'
  | 'release'
  | 'transfer_out'
  | 'transfer_in';

export interface RecordMovementInput {
  variantId: string;
  locationId: string;
  qty: number;
  kind: MovementKind;
  reason?: string;
  refType?: string;
  refId?: string;
  batchId?: string;
  createdBy?: string;
}

export interface RecordMovementResult {
  id: bigint;
}

export async function recordMovement(
  storeId: string,
  input: RecordMovementInput,
): Promise<RecordMovementResult> {
  return withTenant(storeId, async tx => {
    const [row] = await tx
      .insert(stockMovements)
      .values({
        storeId,
        variantId: input.variantId,
        locationId: input.locationId,
        qty: input.qty,
        kind: input.kind,
        reason: input.reason ?? null,
        refType: input.refType ?? null,
        refId: input.refId ?? null,
        batchId: input.batchId ?? null,
        createdBy: input.createdBy ?? null,
      })
      .returning({ id: stockMovements.id });

    if (!row) {
      throw new Error('stock_movements insert returned no row');
    }
    return { id: row.id };
  });
}

export interface AdjustStockInput {
  variantId: string;
  locationId: string;
  /** Signed delta: positive grows on_hand, negative shrinks it. */
  delta: number;
  /** Required for audit (e.g., 'shrinkage', 'recount', 'manual_correction'). */
  reason: string;
  createdBy: string;
}

export async function adjustStock(storeId: string, input: AdjustStockInput): Promise<void> {
  await recordMovement(storeId, {
    variantId: input.variantId,
    locationId: input.locationId,
    qty: input.delta,
    kind: 'adjustment',
    reason: input.reason,
    createdBy: input.createdBy,
  });
}

export interface TransferInput {
  variantId: string;
  fromLocationId: string;
  toLocationId: string;
  qty: number;
  reason?: string;
  createdBy: string;
}

/**
 * Atomic transfer between two locations. Inserts a `transfer_out` movement at
 * the source and a `transfer_in` movement at the destination in one transaction.
 * Validates that both locations exist in the current tenant and are distinct.
 */
export async function transfer(storeId: string, input: TransferInput): Promise<void> {
  if (input.qty <= 0) {
    throw new LocationMismatchError(
      input.fromLocationId,
      input.toLocationId,
      `Transfer qty must be positive (got ${input.qty})`,
    );
  }
  if (input.fromLocationId === input.toLocationId) {
    throw new LocationMismatchError(
      input.fromLocationId,
      input.toLocationId,
      'Transfer from and to locations must differ',
    );
  }

  return withTenant(storeId, async tx => {
    // Verify both locations are visible under the current tenant (RLS-gated).
    const locs = await tx
      .select({ id: locations.id })
      .from(locations)
      .where(
        sql`${locations.id} in (${input.fromLocationId}::uuid, ${input.toLocationId}::uuid)`,
      );
    if (locs.length !== 2) {
      throw new LocationMismatchError(
        input.fromLocationId,
        input.toLocationId,
        'One or both locations not found in current tenant',
      );
    }

    const transferRefId = crypto.randomUUID();

    await tx.insert(stockMovements).values({
      storeId,
      variantId: input.variantId,
      locationId: input.fromLocationId,
      qty: input.qty,
      kind: 'transfer_out',
      reason: input.reason ?? 'transfer',
      refType: 'transfer',
      refId: transferRefId,
      createdBy: input.createdBy,
    });

    await tx.insert(stockMovements).values({
      storeId,
      variantId: input.variantId,
      locationId: input.toLocationId,
      qty: input.qty,
      kind: 'transfer_in',
      reason: input.reason ?? 'transfer',
      refType: 'transfer',
      refId: transferRefId,
      createdBy: input.createdBy,
    });
  });
}

export interface ListMovementsOptions {
  cursor?: string;
  limit?: number;
  variantId?: string;
  locationId?: string;
  kind?: MovementKind;
  from?: Date;
  to?: Date;
}

export interface MovementRow {
  id: string; // bigint serialized to string for JSON safety
  storeId: string;
  variantId: string;
  locationId: string;
  qty: number;
  kind: MovementKind;
  reason: string | null;
  refType: string | null;
  refId: string | null;
  batchId: string | null;
  createdBy: string | null;
  createdAt: Date;
}

export interface ListMovementsResult {
  items: MovementRow[];
  nextCursor: string | null;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// TODO(SP-2 Stream B): replace with `src/lib/cursor.ts` once that lands. Keep the
// opaque base64 JSON shape so the eventual shared helper can decode in-flight cursors.
interface MovementCursor {
  id: string;
}

function encodeCursor(c: MovementCursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): MovementCursor | null {
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'id' in parsed &&
      typeof (parsed as { id: unknown }).id === 'string'
    ) {
      return { id: (parsed as { id: string }).id };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Cursor-paginated ledger view, newest-first by `id` (bigserial ⇒ matches
 * created_at ordering per Assumption 2). Cursor is the last `id` seen.
 */
export async function listMovements(
  storeId: string,
  opts: ListMovementsOptions = {},
): Promise<ListMovementsResult> {
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  return withTenant(storeId, async tx => {
    const filters: SQL[] = [];
    if (opts.variantId) filters.push(eq(stockMovements.variantId, opts.variantId));
    if (opts.locationId) filters.push(eq(stockMovements.locationId, opts.locationId));
    if (opts.kind) filters.push(eq(stockMovements.kind, opts.kind));
    if (opts.from) filters.push(gte(stockMovements.createdAt, opts.from));
    if (opts.to) filters.push(lte(stockMovements.createdAt, opts.to));

    if (opts.cursor) {
      const decoded = decodeCursor(opts.cursor);
      if (decoded) {
        filters.push(lt(stockMovements.id, BigInt(decoded.id)));
      }
    }

    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const rows = await tx
      .select()
      .from(stockMovements)
      .where(whereClause)
      .orderBy(desc(stockMovements.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;

    const items: MovementRow[] = sliced.map(r => ({
      id: r.id.toString(),
      storeId: r.storeId,
      variantId: r.variantId,
      locationId: r.locationId,
      qty: r.qty,
      kind: r.kind,
      reason: r.reason,
      refType: r.refType,
      refId: r.refId,
      batchId: r.batchId,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
    }));

    const last = items[items.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ id: last.id }) : null;

    return { items, nextCursor };
  });
}
