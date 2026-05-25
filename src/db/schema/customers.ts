import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { stores } from './tenancy';
import { users } from './identity';

// ──────────────────────────────────────────────────────────────────────────────
// Enums
// ──────────────────────────────────────────────────────────────────────────────

export const addressType = pgEnum('address_type', ['billing', 'shipping', 'both']);

// ──────────────────────────────────────────────────────────────────────────────
// Customers — store-scoped denormalization on top of shared `users`.
// One row per (store_id, user_id) when the customer has an account; guest
// customers have user_id IS NULL and are deduped per (store_id, email).
// ──────────────────────────────────────────────────────────────────────────────

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    email: text('email').notNull(),
    phone: text('phone'),
    locale: text('locale').notNull().default('en-IN'),
    segment: text('segment'),
    acceptsMarketing: boolean('accepts_marketing').notNull().default(false),
    lifetimeValueCents: integer('lifetime_value_cents').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => ({
    // Logged-in customer: one row per (store, user). Partial — guest rows excluded.
    userUq: uniqueIndex('customers_store_user_uq')
      .on(t.storeId, t.userId)
      .where(sql`${t.userId} IS NOT NULL`),
    // Guest customer: one row per (store, email). Partial — registered rows excluded.
    guestEmailUq: uniqueIndex('customers_store_guest_email_uq')
      .on(t.storeId, t.email)
      .where(sql`${t.userId} IS NULL`),
    emailIdx: index('customers_store_email_idx').on(t.storeId, t.email),
  }),
);

// ──────────────────────────────────────────────────────────────────────────────
// Addresses — saved address book per customer. Scoped via parent customer's
// store_id (no direct store_id column); RLS uses a parent-join policy.
// ──────────────────────────────────────────────────────────────────────────────

export const addresses = pgTable(
  'addresses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
    type: addressType('type').notNull(),
    name: text('name').notNull(),
    line1: text('line1').notNull(),
    line2: text('line2'),
    city: text('city').notNull(),
    region: text('region').notNull(),
    postal: text('postal').notNull(),
    country: text('country').notNull(),
    phone: text('phone'),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => ({
    customerIdx: index('addresses_customer_idx').on(t.customerId),
  }),
);
