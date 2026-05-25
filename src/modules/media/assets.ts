/**
 * Assets module service (SP-8).
 *
 * CRUD-ish operations over the `assets` / `asset_derivatives` / `asset_tags`
 * tables. Every operation runs `withTenant` (NOBYPASSRLS app_user) so RLS
 * enforces store isolation — callers never filter by store_id themselves.
 *
 * Listing is cursor-paginated newest-first by `created_at` desc with `id` as
 * the deterministic tiebreaker, with optional `kind` and `tag` filters.
 */

import { and, desc, eq, inArray, lt, or, type SQL } from 'drizzle-orm';
import { withTenant } from '@/modules/tenant/with-tenant';
import { assets, assetDerivatives, assetTags, type AssetMeta } from '@/db/schema/assets';
import { decodeCursor, encodeCursor, parseLimit } from '@/lib/cursor';
import { AssetInUseError, AssetNotFoundError } from './errors';
import type { AssetKind } from './provider';

export interface AssetRow {
  id: string;
  storeId: string;
  key: string;
  kind: AssetKind;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  checksum: string | null;
  meta: AssetMeta;
  uploadedBy: string | null;
  createdAt: Date;
}

export interface DerivativeRow {
  id: string;
  assetId: string;
  preset: string;
  width: number | null;
  height: number | null;
  url: string;
  createdAt: Date;
}

export interface CreateAssetInput {
  /** Pre-allocated id (from the provider's presign) so the upload URL and the
   *  persisted row agree. */
  id?: string;
  key: string;
  kind: AssetKind;
  mime: string;
  bytes?: number;
  width?: number | null;
  height?: number | null;
  checksum?: string | null;
  meta?: AssetMeta;
  uploadedBy?: string | null;
}

export interface ListAssetsOptions {
  cursor?: string;
  limit?: number;
  kind?: AssetKind;
  tag?: string;
}

export interface ListAssetsResult {
  items: AssetRow[];
  nextCursor: string | null;
}

type AssetSelect = typeof assets.$inferSelect;

function toRow(r: AssetSelect): AssetRow {
  return {
    id: r.id,
    storeId: r.storeId,
    key: r.key,
    kind: r.kind,
    mime: r.mime,
    bytes: r.bytes,
    width: r.width,
    height: r.height,
    checksum: r.checksum,
    meta: r.meta,
    uploadedBy: r.uploadedBy,
    createdAt: r.createdAt,
  };
}

/**
 * Insert a new asset row (or a pending placeholder pre-finalize). Uses the
 * caller-provided id when present so it matches the provider's presigned key.
 */
export async function createAssetRecord(
  storeId: string,
  input: CreateAssetInput,
): Promise<AssetRow> {
  return withTenant(storeId, async tx => {
    const [row] = await tx
      .insert(assets)
      .values({
        ...(input.id ? { id: input.id } : {}),
        storeId,
        key: input.key,
        kind: input.kind,
        mime: input.mime,
        bytes: input.bytes ?? 0,
        width: input.width ?? null,
        height: input.height ?? null,
        checksum: input.checksum ?? null,
        meta: input.meta ?? {},
        uploadedBy: input.uploadedBy ?? null,
      })
      .returning();
    if (!row) throw new Error('assets insert returned no row');
    return toRow(row);
  });
}

export async function getAsset(storeId: string, assetId: string): Promise<AssetRow> {
  return withTenant(storeId, async tx => {
    const [row] = await tx.select().from(assets).where(eq(assets.id, assetId));
    if (!row) throw new AssetNotFoundError(assetId);
    return toRow(row);
  });
}

export interface UpdateAssetMetadataInput {
  bytes?: number;
  width?: number | null;
  height?: number | null;
  checksum?: string | null;
  meta?: AssetMeta;
}

/** Patch metadata on an asset (used by finalize to record validated dims/bytes). */
export async function updateAssetMetadata(
  storeId: string,
  assetId: string,
  patch: UpdateAssetMetadataInput,
): Promise<AssetRow> {
  return withTenant(storeId, async tx => {
    const set: Partial<AssetSelect> = {};
    if (patch.bytes !== undefined) set.bytes = patch.bytes;
    if (patch.width !== undefined) set.width = patch.width;
    if (patch.height !== undefined) set.height = patch.height;
    if (patch.checksum !== undefined) set.checksum = patch.checksum;
    if (patch.meta !== undefined) set.meta = patch.meta;

    if (Object.keys(set).length === 0) {
      const [row] = await tx.select().from(assets).where(eq(assets.id, assetId));
      if (!row) throw new AssetNotFoundError(assetId);
      return toRow(row);
    }
    const [row] = await tx
      .update(assets)
      .set(set)
      .where(eq(assets.id, assetId))
      .returning();
    if (!row) throw new AssetNotFoundError(assetId);
    return toRow(row);
  });
}

/**
 * Cursor-paginated listing, newest first by `created_at` desc with `id`
 * tiebreaker. Optional `kind` and `tag` filters. Cursor encodes
 * `{ k: createdAt-iso, id }`.
 */
export async function listAssets(
  storeId: string,
  opts: ListAssetsOptions = {},
): Promise<ListAssetsResult> {
  const limit = parseLimit(opts.limit?.toString());

  return withTenant(storeId, async tx => {
    const filters: SQL[] = [];

    if (opts.kind) filters.push(eq(assets.kind, opts.kind));

    if (opts.tag) {
      const tagged = tx
        .select({ id: assetTags.assetId })
        .from(assetTags)
        .where(eq(assetTags.tag, opts.tag));
      filters.push(inArray(assets.id, tagged));
    }

    if (opts.cursor) {
      const decoded = decodeCursor(opts.cursor);
      if (decoded) {
        const cutoff = new Date(decoded.k);
        filters.push(
          or(
            lt(assets.createdAt, cutoff),
            and(eq(assets.createdAt, cutoff), lt(assets.id, decoded.id)),
          ) as SQL,
        );
      }
    }

    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const rows = await tx
      .select()
      .from(assets)
      .where(whereClause)
      .orderBy(desc(assets.createdAt), desc(assets.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map(toRow);
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor({ k: last.createdAt.toISOString(), id: last.id }) : null;

    return { items, nextCursor };
  });
}

/** Idempotently attach a tag to an asset. */
export async function attachTag(storeId: string, assetId: string, tag: string): Promise<void> {
  return withTenant(storeId, async tx => {
    // Confirm the asset is visible under this tenant (RLS would also block the
    // insert via the parent-join policy, but a typed 404 is friendlier).
    const [a] = await tx.select({ id: assets.id }).from(assets).where(eq(assets.id, assetId));
    if (!a) throw new AssetNotFoundError(assetId);
    await tx.insert(assetTags).values({ assetId, tag }).onConflictDoNothing();
  });
}

export async function removeTag(storeId: string, assetId: string, tag: string): Promise<void> {
  return withTenant(storeId, async tx => {
    await tx
      .delete(assetTags)
      .where(and(eq(assetTags.assetId, assetId), eq(assetTags.tag, tag)));
  });
}

export async function listTags(storeId: string, assetId: string): Promise<string[]> {
  return withTenant(storeId, async tx => {
    const rows = await tx
      .select({ tag: assetTags.tag })
      .from(assetTags)
      .where(eq(assetTags.assetId, assetId))
      .orderBy(assetTags.tag);
    return rows.map(r => r.tag);
  });
}

/**
 * Insert (or replace) a derivative row for an asset+preset. Derivatives are
 * regenerated by the post-process job, so we delete any existing row for the
 * same (asset, preset) first to keep the set idempotent.
 */
export async function recordDerivative(
  storeId: string,
  input: { assetId: string; preset: string; width?: number | null; height?: number | null; url: string },
): Promise<DerivativeRow> {
  return withTenant(storeId, async tx => {
    const [a] = await tx.select({ id: assets.id }).from(assets).where(eq(assets.id, input.assetId));
    if (!a) throw new AssetNotFoundError(input.assetId);

    await tx
      .delete(assetDerivatives)
      .where(
        and(
          eq(assetDerivatives.assetId, input.assetId),
          eq(assetDerivatives.preset, input.preset),
        ),
      );

    const [row] = await tx
      .insert(assetDerivatives)
      .values({
        assetId: input.assetId,
        preset: input.preset,
        width: input.width ?? null,
        height: input.height ?? null,
        url: input.url,
      })
      .returning();
    if (!row) throw new Error('asset_derivatives insert returned no row');
    return {
      id: row.id,
      assetId: row.assetId,
      preset: row.preset,
      width: row.width,
      height: row.height,
      url: row.url,
      createdAt: row.createdAt,
    };
  });
}

export async function listDerivatives(
  storeId: string,
  assetId: string,
): Promise<DerivativeRow[]> {
  return withTenant(storeId, async tx => {
    const rows = await tx
      .select()
      .from(assetDerivatives)
      .where(eq(assetDerivatives.assetId, assetId))
      .orderBy(assetDerivatives.preset);
    return rows.map(r => ({
      id: r.id,
      assetId: r.assetId,
      preset: r.preset,
      width: r.width,
      height: r.height,
      url: r.url,
      createdAt: r.createdAt,
    }));
  });
}

/**
 * Delete an asset. `asset_derivatives` and `asset_tags` cascade. The FK from
 * `product_images.asset_id` is ON DELETE RESTRICT, so an asset referenced by a
 * product image surfaces as a typed AssetInUseError rather than a raw FK error.
 */
export async function deleteAsset(storeId: string, assetId: string): Promise<void> {
  return withTenant(storeId, async tx => {
    const [a] = await tx.select({ id: assets.id }).from(assets).where(eq(assets.id, assetId));
    if (!a) throw new AssetNotFoundError(assetId);
    try {
      await tx.delete(assets).where(eq(assets.id, assetId));
    } catch (err) {
      // 23503 = foreign_key_violation (product_images RESTRICT).
      if (err && typeof err === 'object' && 'code' in err && err.code === '23503') {
        throw new AssetInUseError(assetId);
      }
      throw err;
    }
  });
}
