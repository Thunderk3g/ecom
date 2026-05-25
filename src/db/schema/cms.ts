import {
  pgTable,
  pgEnum,
  uuid,
  text,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { stores } from './tenancy';
import { users } from './identity';

// ---------- Enums ----------

export const contentPageStatus = pgEnum('content_page_status', ['draft', 'published', 'archived']);
export const navigationSlot = pgEnum('navigation_slot', ['header', 'footer', 'mobile']);

// ---------- Content pages ----------
// A page is the addressable unit (by slug). Its rendered content lives in
// content_versions; the page row carries two nullable pointers:
//   - published_version_id: what the storefront serves (NULL ⇒ not live)
//   - draft_version_id: the in-progress edit (NULL ⇒ no unpublished work)
// publishPage() is a transactional pointer swap (published := draft).

export const contentPages = pgTable('content_pages', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  status: contentPageStatus('status').notNull().default('draft'),
  // Soft FKs to content_versions — declared as plain uuid to avoid a circular
  // table reference (versions reference pages). Application logic guards them.
  publishedVersionId: uuid('published_version_id'),
  draftVersionId: uuid('draft_version_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  slugUnique: uniqueIndex('content_pages_store_slug_uq').on(t.storeId, t.slug),
  statusIdx: index('content_pages_status_idx').on(t.storeId, t.status),
}));

// ---------- Content versions ----------
// Immutable-ish snapshot of a page's block tree + SEO. A new draft edit always
// creates a new version row; publishing just flips the page pointer. store_id
// is denormalized so RLS does not require a join to content_pages.

export const contentVersions = pgTable('content_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  pageId: uuid('page_id').notNull().references(() => contentPages.id, { onDelete: 'cascade' }),
  blocks: jsonb('blocks').$type<unknown[]>().notNull().default([]),
  seo: jsonb('seo').$type<{ title?: string; description?: string; keywords?: string[] }>(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  pageIdx: index('content_versions_page_idx').on(t.pageId, t.createdAt),
}));

// ---------- Content blocks library ----------
// Per-store registry of block definitions used by the admin form renderer.
// `kind` selects a server-side zod schema (see modules/cms/blocks.ts); `schema`
// is the JSON shape the admin UI uses to render a form for that block.

export const contentBlocksLib = pgTable('content_blocks_lib', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  kind: text('kind').notNull(),
  schema: jsonb('schema').$type<Record<string, unknown>>().notNull().default({}),
}, t => ({
  keyUnique: uniqueIndex('content_blocks_lib_store_key_uq').on(t.storeId, t.key),
}));

// ---------- Navigation menus ----------
// One row per (store, slot). `items` is a nested tree of nav nodes validated by
// the zod tree validator in modules/cms/navigation.ts.

export const navigationMenus = pgTable('navigation_menus', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  slot: navigationSlot('slot').notNull(),
  items: jsonb('items').$type<unknown[]>().notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  slotUnique: uniqueIndex('navigation_menus_store_slot_uq').on(t.storeId, t.slot),
}));
