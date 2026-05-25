/**
 * SP-8 asset registry.
 *
 * - `assets`        — one row per stored object. `key` is the content-addressed
 *                     object key (`<storeSlug>/<hash>.<ext>`); `checksum` is the
 *                     sha256 of the bytes used to build it. Tenant-scoped via
 *                     `store_id` (RLS in 0020).
 * - `asset_derivatives` — imgproxy/stub-generated renditions of an image asset
 *                     at named presets (thumb/card/detail/hero). No own
 *                     `store_id`; RLS scopes via a join to the parent asset.
 * - `asset_tags`    — free-form taxonomy on an asset; pk(asset_id, tag). Same
 *                     parent-join RLS approach.
 *
 * `product_images.asset_id` and `categories.image_asset_id` gain FKs to
 * `assets.id` in migration 0020 (they were bare uuids in SP-2's catalog schema).
 */

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { stores } from './tenancy';
import { users } from './identity';

// ──────────────────────────────────────────────────────────────────────────────
// Enums
// ──────────────────────────────────────────────────────────────────────────────

export const assetKind = pgEnum('asset_kind', ['image', 'svg', 'doc']);

// ──────────────────────────────────────────────────────────────────────────────
// assets
// ──────────────────────────────────────────────────────────────────────────────

export interface AssetMeta {
  /** Original client filename, if known. */
  originalFilename?: string;
  /** Whether the upload has been finalized (object validated + metadata set). */
  pending?: boolean;
  [k: string]: unknown;
}

export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    // Content-addressed object key: `<storeSlug>/<hash-or-uuid>.<ext>`.
    key: text('key').notNull(),
    kind: assetKind('kind').notNull(),
    mime: text('mime').notNull(),
    bytes: integer('bytes').notNull().default(0),
    width: integer('width'),
    height: integer('height'),
    checksum: text('checksum'),
    meta: jsonb('meta').$type<AssetMeta>().notNull().default({}),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => ({
    // Content-addressed key is unique per store (free dedupe within a store).
    storeKeyIdx: index('assets_store_key_idx').on(t.storeId, t.key),
    storeKindIdx: index('assets_store_kind_idx').on(t.storeId, t.kind, t.createdAt.desc()),
  }),
);

// ──────────────────────────────────────────────────────────────────────────────
// asset_derivatives — renditions of an image asset (no own store_id; RLS joins)
// ──────────────────────────────────────────────────────────────────────────────

export const assetDerivatives = pgTable(
  'asset_derivatives',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetId: uuid('asset_id').notNull().references(() => assets.id, { onDelete: 'cascade' }),
    preset: text('preset').notNull(),
    width: integer('width'),
    height: integer('height'),
    url: text('url').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => ({
    assetPresetIdx: index('asset_derivatives_asset_preset_idx').on(t.assetId, t.preset),
  }),
);

// ──────────────────────────────────────────────────────────────────────────────
// asset_tags — free-form taxonomy (no own store_id; RLS joins)
// ──────────────────────────────────────────────────────────────────────────────

export const assetTags = pgTable(
  'asset_tags',
  {
    assetId: uuid('asset_id').notNull().references(() => assets.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
  },
  t => ({ pk: primaryKey({ columns: [t.assetId, t.tag] }) }),
);
