import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  bigserial,
  pgEnum,
  uniqueIndex,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { stores } from './tenancy';
import { productVariants } from './catalog';
import { users } from './identity';

// ──────────────────────────────────────────────────────────────────────────────
// Enums
// ──────────────────────────────────────────────────────────────────────────────

export const locationType = pgEnum('location_type', ['warehouse', 'store', 'transit']);

export const movementKind = pgEnum('movement_kind', [
  'inbound',
  'outbound',
  'adjustment',
  'reservation',
  'release',
  'transfer_out',
  'transfer_in',
]);

export const reservationStatus = pgEnum('reservation_status', [
  'active',
  'committed',
  'released',
  'expired',
]);

export const poStatus = pgEnum('po_status', [
  'draft',
  'placed',
  'partial',
  'received',
  'cancelled',
]);

// ──────────────────────────────────────────────────────────────────────────────
// Locations
// ──────────────────────────────────────────────────────────────────────────────

export const locations = pgTable(
  'locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: locationType('type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => ({
    codeUnique: uniqueIndex('locations_store_code_uq').on(t.storeId, t.code),
  }),
);

// ──────────────────────────────────────────────────────────────────────────────
// Variant inventory settings (per-variant toggles that didn't belong in SP-2)
// ──────────────────────────────────────────────────────────────────────────────

export const variantInventorySettings = pgTable('variant_inventory_settings', {
  variantId: uuid('variant_id')
    .primaryKey()
    .references(() => productVariants.id, { onDelete: 'restrict' }),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  batchTracked: boolean('batch_tracked').notNull().default(false),
  allowBackorder: boolean('allow_backorder').notNull().default(false),
});

// ──────────────────────────────────────────────────────────────────────────────
// Stock movements — append-only ledger
// ──────────────────────────────────────────────────────────────────────────────

export const stockMovements = pgTable(
  'stock_movements',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'restrict' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),
    locationId: uuid('location_id').notNull().references(() => locations.id, { onDelete: 'restrict' }),
    qty: integer('qty').notNull(), // signed: positive inbound, negative outbound (for adjustment)
    kind: movementKind('kind').notNull(),
    reason: text('reason'),
    refType: text('ref_type'),
    refId: uuid('ref_id'),
    batchId: uuid('batch_id'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => ({
    variantIdx: index('movements_variant_idx').on(t.variantId, t.createdAt.desc()),
    refIdx: index('movements_ref_idx').on(t.refType, t.refId),
  }),
);

// ──────────────────────────────────────────────────────────────────────────────
// Stock levels — materialized snapshot (trigger-maintained)
// `available` generated column is added in 0010_inventory_triggers.sql so
// drizzle-kit does not try to emit it.
// ──────────────────────────────────────────────────────────────────────────────

export const stockLevels = pgTable(
  'stock_levels',
  {
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),
    locationId: uuid('location_id').notNull().references(() => locations.id, { onDelete: 'restrict' }),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    onHand: integer('on_hand').notNull().default(0),
    reserved: integer('reserved').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => ({ pk: primaryKey({ columns: [t.variantId, t.locationId] }) }),
);

// ──────────────────────────────────────────────────────────────────────────────
// Reservations
// ──────────────────────────────────────────────────────────────────────────────

export const stockReservations = pgTable(
  'stock_reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),
    locationId: uuid('location_id').notNull().references(() => locations.id, { onDelete: 'restrict' }),
    qty: integer('qty').notNull(),
    cartId: uuid('cart_id'), // FK to carts added in SP-4
    orderId: uuid('order_id'), // set on commit, FK in SP-5
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    status: reservationStatus('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => ({
    cartIdx: index('reservations_cart_idx').on(t.cartId),
    activeExpiresIdx: index('reservations_active_expires_idx')
      .on(t.expiresAt)
      .where(sql`status = 'active'`),
  }),
);

// ──────────────────────────────────────────────────────────────────────────────
// Stock batches
// ──────────────────────────────────────────────────────────────────────────────

export const stockBatches = pgTable(
  'stock_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),
    locationId: uuid('location_id').notNull().references(() => locations.id, { onDelete: 'restrict' }),
    batchCode: text('batch_code').notNull(),
    qty: integer('qty').notNull(),
    expiryDate: timestamp('expiry_date', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => ({
    codeUnique: uniqueIndex('batches_variant_code_uq').on(t.variantId, t.locationId, t.batchCode),
  }),
);

// ──────────────────────────────────────────────────────────────────────────────
// Thresholds
// ──────────────────────────────────────────────────────────────────────────────

export const stockThresholds = pgTable(
  'stock_thresholds',
  {
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id').notNull().references(() => locations.id, { onDelete: 'cascade' }),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    reorderPoint: integer('reorder_point').notNull(),
    reorderQty: integer('reorder_qty').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => ({ pk: primaryKey({ columns: [t.variantId, t.locationId] }) }),
);

// ──────────────────────────────────────────────────────────────────────────────
// Suppliers + supplier SKUs
// ──────────────────────────────────────────────────────────────────────────────

export const suppliers = pgTable('suppliers', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  contact: jsonb('contact').$type<{ email?: string; phone?: string; address?: string }>(),
  leadTimeDays: integer('lead_time_days'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const supplierSkus = pgTable(
  'supplier_skus',
  {
    supplierId: uuid('supplier_id').notNull().references(() => suppliers.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    supplierSku: text('supplier_sku').notNull(),
    costCents: integer('cost_cents').notNull(),
    moq: integer('moq').notNull().default(1),
  },
  t => ({ pk: primaryKey({ columns: [t.supplierId, t.variantId] }) }),
);

// ──────────────────────────────────────────────────────────────────────────────
// Purchase orders + items
// ──────────────────────────────────────────────────────────────────────────────

export const purchaseOrders = pgTable('purchase_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  supplierId: uuid('supplier_id').notNull().references(() => suppliers.id, { onDelete: 'restrict' }),
  status: poStatus('status').notNull().default('draft'),
  placedAt: timestamp('placed_at', { withTimezone: true }),
  expectedAt: timestamp('expected_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const purchaseOrderItems = pgTable(
  'purchase_order_items',
  {
    poId: uuid('po_id').notNull().references(() => purchaseOrders.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),
    qtyOrdered: integer('qty_ordered').notNull(),
    qtyReceived: integer('qty_received').notNull().default(0),
    costCents: integer('cost_cents').notNull(),
  },
  t => ({ pk: primaryKey({ columns: [t.poId, t.variantId] }) }),
);
