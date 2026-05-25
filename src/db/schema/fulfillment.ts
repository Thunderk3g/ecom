import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  timestamp,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { stores } from './tenancy';
import { orders, orderItems } from './orders';

// ──────────────────────────────────────────────────────────────────────────────
// Enums
// ──────────────────────────────────────────────────────────────────────────────

export const fulfillmentStatus = pgEnum('fulfillment_status', [
  'pending',
  'shipped',
  'delivered',
  'cancelled',
]);

export const shipmentStatus = pgEnum('shipment_status', [
  'pending',
  'shipped',
  'delivered',
  'cancelled',
]);

// ──────────────────────────────────────────────────────────────────────────────
// Fulfillments — operational picking/packing unit; one order can have N.
// ──────────────────────────────────────────────────────────────────────────────

export const fulfillments = pgTable(
  'fulfillments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    status: fulfillmentStatus('status').notNull().default('pending'),
    trackingNumber: text('tracking_number'),
    carrier: text('carrier'),
    shippedAt: timestamp('shipped_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => ({
    orderIdx: index('fulfillments_order_idx').on(t.orderId),
    storeStatusIdx: index('fulfillments_store_status_idx').on(t.storeId, t.status),
  }),
);

// ──────────────────────────────────────────────────────────────────────────────
// Fulfillment items — N:1 to fulfillment, partial qty against an order_item.
// No store_id column; RLS via parent fulfillment.
// ──────────────────────────────────────────────────────────────────────────────

export const fulfillmentItems = pgTable(
  'fulfillment_items',
  {
    fulfillmentId: uuid('fulfillment_id')
      .notNull()
      .references(() => fulfillments.id, { onDelete: 'cascade' }),
    orderItemId: uuid('order_item_id')
      .notNull()
      .references(() => orderItems.id, { onDelete: 'restrict' }),
    qty: integer('qty').notNull(),
  },
  t => ({
    pk: primaryKey({ columns: [t.fulfillmentId, t.orderItemId] }),
  }),
);

// ──────────────────────────────────────────────────────────────────────────────
// Shipments — carrier-side dispatch with tracking. An order may have multiple
// shipments (partial fulfillment); each shipment carries its own label.
// ──────────────────────────────────────────────────────────────────────────────

export const shipments = pgTable(
  'shipments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    carrier: text('carrier'),
    trackingNumber: text('tracking_number'),
    status: shipmentStatus('status').notNull().default('pending'),
    shippedAt: timestamp('shipped_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    labelUrl: text('label_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => ({
    orderIdx: index('shipments_order_idx').on(t.orderId),
  }),
);

// ──────────────────────────────────────────────────────────────────────────────
// Shipment items — RLS via parent shipment.
// ──────────────────────────────────────────────────────────────────────────────

export const shipmentItems = pgTable(
  'shipment_items',
  {
    shipmentId: uuid('shipment_id')
      .notNull()
      .references(() => shipments.id, { onDelete: 'cascade' }),
    orderItemId: uuid('order_item_id')
      .notNull()
      .references(() => orderItems.id, { onDelete: 'restrict' }),
    qty: integer('qty').notNull(),
  },
  t => ({
    pk: primaryKey({ columns: [t.shipmentId, t.orderItemId] }),
  }),
);
