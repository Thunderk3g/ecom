import { pgTable, uuid, text, jsonb, boolean, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { stores } from './tenancy';
import { users } from './identity';

export const siteConfig = pgTable('site_config', {
  storeId: uuid('store_id').primaryKey().references(() => stores.id, { onDelete: 'cascade' }),
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
});

export const featureFlags = pgTable('feature_flags', {
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  payload: jsonb('payload').$type<Record<string, unknown>>(),
}, t => ({ pk: primaryKey({ columns: [t.storeId, t.key] }) }));
