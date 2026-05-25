import { pgTable, uuid, text, jsonb, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { stores } from './tenancy';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  locale: text('locale').notNull().default('en-IN'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const storeUsers = pgTable('store_users', {
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // owner | manager | staff
  permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({ pk: primaryKey({ columns: [t.storeId, t.userId] }) }));

// customers + addresses moved to ./customers.ts in SP-5 to extend with
// segment, accepts_marketing, lifetime_value_cents, and partial unique indexes.
