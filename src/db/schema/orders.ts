import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { stores } from './tenancy';
import { productVariants } from './catalog';
import { customers } from './customers';
import type { Address } from './carts';

// ──────────────────────────────────────────────────────────────────────────────
// Enums
// ──────────────────────────────────────────────────────────────────────────────
// NOTE: 'completed' is appended for SP-5's state machine (fulfilled → completed
// terminal happy-path). Older rows seeded before SP-5 use the original set.

export const orderStatus = pgEnum('order_status', [
  'pending_payment',
  'paid',
  'cancelled',
  'fulfilled',
  'refunded',
  'completed',
]);

export const orderPaymentStatus = pgEnum('order_payment_status', [
  'pending',
  'paid',
  'failed',
  'refunded',
]);

export const orderFulfillmentStatus = pgEnum('order_fulfillment_status', [
  'unfulfilled',
  'partial',
  'fulfilled',
]);

// ──────────────────────────────────────────────────────────────────────────────
// Orders (minimal — SP-5 extends with fulfillment_status, shipments, refunds)
// ──────────────────────────────────────────────────────────────────────────────
// number: minted by mint_order_number(store_slug) sequence helper in 0014.
// Address snapshots (billing/shipping) — kept as JSONB so post-placement
// edits to customer's address book don't mutate historical orders.

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    number: text('number').notNull(),
    customerId: uuid('customer_id'),
    email: text('email').notNull(),
    status: orderStatus('status').notNull().default('pending_payment'),
    paymentStatus: orderPaymentStatus('payment_status').notNull().default('pending'),
    fulfillmentStatus: orderFulfillmentStatus('fulfillment_status')
      .notNull()
      .default('unfulfilled'),
    billingAddress: jsonb('billing_address').$type<Address>(),
    shippingAddress: jsonb('shipping_address').$type<Address>(),
    currency: text('currency').notNull(),
    subtotalCents: integer('subtotal_cents').notNull(),
    discountCents: integer('discount_cents').notNull().default(0),
    taxCents: integer('tax_cents').notNull().default(0),
    shippingCents: integer('shipping_cents').notNull().default(0),
    totalCents: integer('total_cents').notNull(),
    couponCode: text('coupon_code'),
    note: text('note'),
    placedAt: timestamp('placed_at', { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  },
  t => ({
    numberUnique: uniqueIndex('orders_store_number_uq').on(t.storeId, t.number),
    customerIdx: index('orders_customer_idx').on(t.storeId, t.customerId, t.placedAt.desc()),
    customerFk: foreignKey({
      columns: [t.customerId],
      foreignColumns: [customers.id],
      name: 'orders_customer_id_fk',
    }).onDelete('set null'),
  }),
);

// ──────────────────────────────────────────────────────────────────────────────
// Order items
// ──────────────────────────────────────────────────────────────────────────────
// sku / name / attributes snapshotted at placement so product edits don't
// mutate historical orders. store_id denormalized; trigger in 0012 enforces
// match with parent orders.store_id.

export const orderItems = pgTable('order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  variantId: uuid('variant_id')
    .notNull()
    .references(() => productVariants.id, { onDelete: 'restrict' }),
  sku: text('sku').notNull(),
  name: text('name').notNull(),
  qty: integer('qty').notNull(),
  unitPriceCents: integer('unit_price_cents').notNull(),
  lineTotalCents: integer('line_total_cents').notNull(),
  taxCents: integer('tax_cents').notNull().default(0),
  attributes: jsonb('attributes').$type<Record<string, unknown>>(),
});
