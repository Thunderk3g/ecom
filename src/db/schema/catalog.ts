import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  foreignKey,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { stores } from './tenancy';
import { assets } from './assets';

// ---------- Enums ----------

export const attributeDataType = pgEnum('attribute_data_type', ['string', 'number', 'bool', 'enum']);
export const productType = pgEnum('product_type', ['simple', 'bundle']);
export const productStatus = pgEnum('product_status', ['draft', 'active', 'archived']);
export const variantStatus = pgEnum('variant_status', ['draft', 'active', 'archived']);
export const reviewStatus = pgEnum('review_status', ['pending', 'approved', 'rejected']);

// ---------- Categories (adjacency list) ----------

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  parentId: uuid('parent_id'),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  imageAssetId: uuid('image_asset_id').references(() => assets.id, { onDelete: 'set null' }), // FK added in SP-8 (0020)
  sortOrder: integer('sort_order').notNull().default(0),
  published: boolean('published').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  slugUnique: uniqueIndex('categories_store_slug_uq').on(t.storeId, t.slug),
  parentIdx: index('categories_parent_idx').on(t.parentId),
  parentFk: foreignKey({
    columns: [t.parentId],
    foreignColumns: [t.id],
    name: 'categories_parent_id_fk',
  }).onDelete('set null'),
}));

// ---------- Attribute definitions ----------

export const attributeDefinitions = pgTable('attribute_definitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  label: text('label').notNull(),
  dataType: attributeDataType('data_type').notNull(),
  unit: text('unit'),
  enumValues: jsonb('enum_values').$type<string[]>(),
  filterable: boolean('filterable').notNull().default(false),
  required: boolean('required').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  keyUnique: uniqueIndex('attr_def_store_key_uq').on(t.storeId, t.key),
}));

// ---------- Products ----------
// NOTE: search_tsv column, products_search_tsv_gin, and products_name_trgm
// indexes are added in 0007_catalog_search.sql (requires pg_trgm + unaccent).

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  descriptionMd: text('description_md'),
  brand: text('brand'),
  categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
  type: productType('type').notNull().default('simple'),
  status: productStatus('status').notNull().default('draft'),
  attributes: jsonb('attributes').$type<Record<string, unknown>>().notNull().default({}),
  taxClass: text('tax_class'),
  seo: jsonb('seo').$type<{ title?: string; description?: string; keywords?: string[] }>(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  slugUnique: uniqueIndex('products_store_slug_uq').on(t.storeId, t.slug),
  categoryIdx: index('products_category_idx').on(t.categoryId),
  statusIdx: index('products_status_idx').on(t.storeId, t.status, t.deletedAt),
  attributesGin: index('products_attributes_gin').using('gin', t.attributes),
}));

// ---------- Product variants ----------

export const productVariants = pgTable('product_variants', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  // denormalized store_id so RLS does not need a join to products
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  sku: text('sku').notNull(),
  barcode: text('barcode'),
  name: text('name'),
  axes: jsonb('axes').$type<Record<string, string | number>>().notNull().default({}),
  priceCents: integer('price_cents').notNull(),
  compareAtCents: integer('compare_at_cents'),
  costCents: integer('cost_cents'),
  weightG: integer('weight_g'),
  status: variantStatus('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  skuUnique: uniqueIndex('variants_store_sku_uq').on(t.storeId, t.sku),
  productIdx: index('variants_product_idx').on(t.productId),
  axesGin: index('variants_axes_gin').using('gin', t.axes),
}));

// ---------- Product images ----------

export const productImages = pgTable('product_images', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'cascade' }),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  assetId: uuid('asset_id').notNull().references(() => assets.id, { onDelete: 'restrict' }), // FK added in SP-8 (0020)
  alt: text('alt'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  productIdx: index('images_product_idx').on(t.productId, t.sortOrder),
}));

// ---------- Bundle components ----------

export const bundleComponents = pgTable('bundle_components', {
  bundleVariantId: uuid('bundle_variant_id')
    .notNull()
    .references(() => productVariants.id, { onDelete: 'cascade' }),
  componentVariantId: uuid('component_variant_id')
    .notNull()
    .references(() => productVariants.id, { onDelete: 'restrict' }),
  qty: integer('qty').notNull(),
}, t => ({
  pk: primaryKey({ columns: [t.bundleVariantId, t.componentVariantId] }),
}));

// ---------- Product reviews (schema only — feature-flagged off) ----------

export const productReviews = pgTable('product_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  customerId: uuid('customer_id'), // FK to customers added in SP-4 if needed
  rating: integer('rating').notNull(),
  title: text('title'),
  body: text('body'),
  status: reviewStatus('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
