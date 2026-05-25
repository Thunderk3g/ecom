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
import { orders, orderItems } from './orders';
import { payments } from './payments';

// ──────────────────────────────────────────────────────────────────────────────
// Enums
// ──────────────────────────────────────────────────────────────────────────────

export const refundStatus = pgEnum('refund_status', ['pending', 'succeeded', 'failed']);

// ──────────────────────────────────────────────────────────────────────────────
// Refunds — partial or full. payment_id is nullable to support manual refunds
// (e.g. store credit) recorded outside the payment provider.
// ──────────────────────────────────────────────────────────────────────────────

export const refunds = pgTable(
  'refunds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'set null' }),
    amountCents: integer('amount_cents').notNull(),
    reason: text('reason'),
    status: refundStatus('status').notNull().default('pending'),
    providerRef: text('provider_ref'),
    raw: jsonb('raw').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => ({
    orderIdx: index('refunds_order_idx').on(t.orderId),
    storeStatusIdx: index('refunds_store_status_idx').on(t.storeId, t.status),
  }),
);

// ──────────────────────────────────────────────────────────────────────────────
// Refund items — per-line allocation. RLS via parent refund.
// ──────────────────────────────────────────────────────────────────────────────

export const refundItems = pgTable(
  'refund_items',
  {
    refundId: uuid('refund_id')
      .notNull()
      .references(() => refunds.id, { onDelete: 'cascade' }),
    orderItemId: uuid('order_item_id')
      .notNull()
      .references(() => orderItems.id, { onDelete: 'restrict' }),
    qty: integer('qty').notNull(),
    amountCents: integer('amount_cents').notNull(),
  },
  t => ({
    pk: primaryKey({ columns: [t.refundId, t.orderItemId] }),
  }),
);
