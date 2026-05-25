import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { stores } from './tenancy';
import { orders } from './orders';

// ──────────────────────────────────────────────────────────────────────────────
// Order events — append-only timeline per order. Each transition, fulfillment,
// refund, and webhook delivery attempt writes a row. No_update / no_delete RLS
// policies enforce append-only at the database layer (see 0017 RLS migration).
// actor_type: 'user' | 'system' | 'webhook' | 'job'; actor_id is nullable so
// system / job actors don't require a fake user row.
// ──────────────────────────────────────────────────────────────────────────────

export const orderEvents = pgTable(
  'order_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    actorType: text('actor_type').notNull(),
    actorId: uuid('actor_id'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => ({
    orderIdx: index('order_events_order_idx').on(t.orderId, t.createdAt),
    storeKindIdx: index('order_events_store_kind_idx').on(t.storeId, t.kind, t.createdAt),
  }),
);

// ──────────────────────────────────────────────────────────────────────────────
// Audit log — cross-entity admin action log. entity_type / entity_id is a
// polymorphic pointer (e.g. 'product:<uuid>', 'order:<uuid>'). diff captures
// before/after for diffable updates; for create/delete events one side is null.
// ──────────────────────────────────────────────────────────────────────────────

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    actorType: text('actor_type').notNull(),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    diff: jsonb('diff').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => ({
    storeEntityIdx: index('audit_log_store_entity_idx').on(t.storeId, t.entityType, t.entityId),
    storeCreatedIdx: index('audit_log_store_created_idx').on(t.storeId, t.createdAt),
  }),
);
