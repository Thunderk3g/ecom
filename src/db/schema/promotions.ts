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
} from 'drizzle-orm/pg-core';
import { stores } from './tenancy';

// ──────────────────────────────────────────────────────────────────────────────
// Enums
// ──────────────────────────────────────────────────────────────────────────────

export const promotionType = pgEnum('promotion_type', [
  'percent',
  'amount',
  'free_shipping',
  'bxgy',
]);

export const promotionStatus = pgEnum('promotion_status', [
  'draft',
  'active',
  'paused',
  'archived',
]);

// ──────────────────────────────────────────────────────────────────────────────
// Conditions JSON shape — single source of truth for the promotion rule
// evaluator. SP-4 covers minSubtotal, variant/category scoping, and bxgy fields;
// customerSegments is reserved for future segmentation work.
// ──────────────────────────────────────────────────────────────────────────────

export type PromotionConditions = {
  minSubtotalCents?: number;
  variantIds?: string[];
  categoryIds?: string[];
  bxgyBuy?: number;
  bxgyGet?: number;
  customerSegments?: string[];
};

// ──────────────────────────────────────────────────────────────────────────────
// Promotions
// ──────────────────────────────────────────────────────────────────────────────
// code IS NULL → auto-promotion (no coupon required).
// usedCount is incremented by recordRedemption; usageLimit / perCustomerLimit
// are enforced in the application layer (cheap counts on promotion_redemptions).

export const promotions = pgTable(
  'promotions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    code: text('code'),
    name: text('name').notNull(),
    type: promotionType('type').notNull(),
    status: promotionStatus('status').notNull().default('draft'),
    valueCents: integer('value_cents'),
    percent: integer('percent'),
    conditions: jsonb('conditions').$type<PromotionConditions>().notNull().default({}),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    usageLimit: integer('usage_limit'),
    perCustomerLimit: integer('per_customer_limit'),
    usedCount: integer('used_count').notNull().default(0),
    stackable: boolean('stackable').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => ({
    codeUnique: uniqueIndex('promotions_store_code_uq').on(t.storeId, t.code),
  }),
);

// ──────────────────────────────────────────────────────────────────────────────
// Promotion redemptions
// ──────────────────────────────────────────────────────────────────────────────
// Captures every applied discount. cartId / orderId / customerId are nullable
// because a redemption can be tied to a cart (pre-payment), an order
// (post-payment), or neither (admin manual credit, future).

export const promotionRedemptions = pgTable('promotion_redemptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  promotionId: uuid('promotion_id')
    .notNull()
    .references(() => promotions.id, { onDelete: 'restrict' }),
  cartId: uuid('cart_id'),
  orderId: uuid('order_id'),
  customerId: uuid('customer_id'),
  amountCents: integer('amount_cents').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
