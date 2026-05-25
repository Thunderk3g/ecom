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
} from 'drizzle-orm/pg-core';
import { stores } from './tenancy';
import { carts } from './carts';

// ──────────────────────────────────────────────────────────────────────────────
// Enums
// ──────────────────────────────────────────────────────────────────────────────

export const paymentProvider = pgEnum('payment_provider', ['razorpay', 'stripe', 'manual']);

export const paymentStatus = pgEnum('payment_status', [
  'pending',
  'succeeded',
  'failed',
  'refunded',
  'partially_refunded',
]);

export const intentStatus = pgEnum('intent_status', [
  'pending',
  'attached',
  'succeeded',
  'failed',
  'cancelled',
]);

// ──────────────────────────────────────────────────────────────────────────────
// Payment intents
// ──────────────────────────────────────────────────────────────────────────────
// One per checkout attempt. providerRef = razorpay_order_id / stripe_pi_id.
// reservationIds: stock_reservations.id values held against the cart.
// raw: full provider response payload (debugging / dispute support).

export const paymentIntents = pgTable(
  'payment_intents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    cartId: uuid('cart_id').references(() => carts.id, { onDelete: 'set null' }),
    provider: paymentProvider('provider').notNull(),
    providerRef: text('provider_ref'),
    clientSecret: text('client_secret'),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull(),
    status: intentStatus('status').notNull().default('pending'),
    reservationIds: jsonb('reservation_ids').$type<string[]>().notNull().default([]),
    raw: jsonb('raw').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => ({
    providerRefIdx: index('intents_provider_ref_idx').on(t.provider, t.providerRef),
  }),
);

// ──────────────────────────────────────────────────────────────────────────────
// Payments
// ──────────────────────────────────────────────────────────────────────────────
// Recorded after a payment_succeeded / failed webhook. orderId FK is added in
// migration 0014 (after orders table exists). Leaving as plain uuid column for
// now per plan.

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  orderId: uuid('order_id'),
  intentId: uuid('intent_id').references(() => paymentIntents.id, { onDelete: 'set null' }),
  provider: paymentProvider('provider').notNull(),
  providerRef: text('provider_ref'),
  amountCents: integer('amount_cents').notNull(),
  status: paymentStatus('status').notNull(),
  method: text('method'),
  raw: jsonb('raw').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ──────────────────────────────────────────────────────────────────────────────
// Payment events — raw webhook log
// ──────────────────────────────────────────────────────────────────────────────
// (provider, provider_event_id) unique → natural idempotency for redelivered
// webhooks. processed/processedAt set after apply; error filled if apply throws
// so the retry queue can pick it up.

export const paymentEvents = pgTable(
  'payment_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    provider: paymentProvider('provider').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    processed: boolean('processed').notNull().default(false),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => ({
    providerEventUq: uniqueIndex('payment_events_provider_event_uq').on(
      t.provider,
      t.providerEventId,
    ),
  }),
);
