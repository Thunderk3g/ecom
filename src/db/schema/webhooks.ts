import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { stores } from './tenancy';

// ──────────────────────────────────────────────────────────────────────────────
// Enums
// ──────────────────────────────────────────────────────────────────────────────

export const webhookStatus = pgEnum('webhook_status', ['active', 'paused']);

export const webhookDeliveryStatus = pgEnum('webhook_delivery_status', [
  'pending',
  'succeeded',
  'failed',
  'dead',
]);

export const outboxStatus = pgEnum('outbox_status', ['pending', 'dispatched']);

// ──────────────────────────────────────────────────────────────────────────────
// Webhooks — admin-configured subscriptions per store. topics is a text[] of
// event names (e.g. ['order.placed', 'order.refunded']).
// ──────────────────────────────────────────────────────────────────────────────

export const webhooks = pgTable(
  'webhooks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    secret: text('secret').notNull(),
    topics: text('topics').array().notNull().default([]),
    status: webhookStatus('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => ({
    storeStatusIdx: index('webhooks_store_status_idx').on(t.storeId, t.status),
  }),
);

// ──────────────────────────────────────────────────────────────────────────────
// Webhook deliveries — one row per (event, webhook) attempt. attempts +
// next_try_at drive the exponential-backoff worker.
// ──────────────────────────────────────────────────────────────────────────────

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    webhookId: uuid('webhook_id').notNull().references(() => webhooks.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull(),
    responseCode: integer('response_code'),
    body: text('body'),
    attempts: integer('attempts').notNull().default(0),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    nextTryAt: timestamp('next_try_at', { withTimezone: true }),
    status: webhookDeliveryStatus('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => ({
    webhookIdx: index('webhook_deliveries_webhook_idx').on(t.webhookId, t.status),
    nextTryIdx: index('webhook_deliveries_next_try_idx').on(t.nextTryAt),
    eventIdx: index('webhook_deliveries_event_idx').on(t.eventId),
  }),
);

// ──────────────────────────────────────────────────────────────────────────────
// Outbox events — written in-transaction with the order mutation so the event
// commits atomically. A worker drains pending rows, fans out to subscribed
// webhooks, then flips the row to 'dispatched'.
// ──────────────────────────────────────────────────────────────────────────────

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    topic: text('topic').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: outboxStatus('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
  },
  t => ({
    storeStatusIdx: index('outbox_events_store_status_idx').on(t.storeId, t.status, t.createdAt),
  }),
);
