import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { stores } from './tenancy';
import { productVariants } from './catalog';

// ──────────────────────────────────────────────────────────────────────────────
// Address — single source of truth for shipping/billing addresses across cart
// and orders. JSONB so we keep history at the order level without joining to
// a mutable customer-address table.
// ──────────────────────────────────────────────────────────────────────────────

export type Address = {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postal: string;
  country: string;
  phone?: string;
};

// ──────────────────────────────────────────────────────────────────────────────
// Carts
// ──────────────────────────────────────────────────────────────────────────────
// Guest carts: customer_id IS NULL, keyed by session_id (cookie value).
// Customer carts: customer_id set, possibly with session_id from pre-login.
// Partial unique indexes for guest vs customer carts are added in 0013.

export const carts = pgTable(
  'carts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    // FK to customers added later (SP-5 finalizes customers table); nullable here.
    customerId: uuid('customer_id'),
    sessionId: text('session_id').notNull(),
    currency: text('currency').notNull().default('INR'),
    couponCode: text('coupon_code'),
    shippingAddress: jsonb('shipping_address').$type<Address>(),
    billingAddress: jsonb('billing_address').$type<Address>(),
    note: text('note'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => ({
    sessionIdx: index('carts_session_idx').on(t.storeId, t.sessionId),
    customerIdx: index('carts_customer_idx').on(t.storeId, t.customerId),
  }),
);

// ──────────────────────────────────────────────────────────────────────────────
// Cart items
// ──────────────────────────────────────────────────────────────────────────────
// store_id denormalized to keep RLS off the carts join hot-path. A trigger in
// 0012 enforces cart_items.store_id = parent carts.store_id (defense in depth).
// qty > 0 constraint added in 0013.

export const cartItems = pgTable(
  'cart_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cartId: uuid('cart_id').notNull().references(() => carts.id, { onDelete: 'cascade' }),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),
    qty: integer('qty').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(), // snapshot at add time
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => ({
    cartVariantUq: uniqueIndex('cart_items_cart_variant_uq').on(t.cartId, t.variantId),
  }),
);
