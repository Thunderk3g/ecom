import {
  pgTable,
  uuid,
  text,
  boolean,
  numeric,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { stores } from './tenancy';

// ──────────────────────────────────────────────────────────────────────────────
// Tax rates
// ──────────────────────────────────────────────────────────────────────────────
// regionCode is freeform but uses ISO 3166 country / country-region pattern
// ('IN', 'IN-MH'). rate is fractional (0.18 = 18%). taxClass matches
// products.tax_class for per-product overrides; 'default' applies to all.
// inclusive default is true per spec §16 (India GST is price-inclusive).

export const taxRates = pgTable(
  'tax_rates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    regionCode: text('region_code').notNull(),
    rate: numeric('rate', { precision: 6, scale: 4 }).notNull(),
    label: text('label').notNull(),
    inclusive: boolean('inclusive').notNull().default(true),
    taxClass: text('tax_class').notNull().default('default'),
  },
  t => ({
    regionClassUnique: uniqueIndex('tax_rates_store_region_class_uq').on(
      t.storeId,
      t.regionCode,
      t.taxClass,
    ),
  }),
);
