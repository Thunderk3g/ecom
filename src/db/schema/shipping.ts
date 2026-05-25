import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { stores } from './tenancy';

// ──────────────────────────────────────────────────────────────────────────────
// Region matcher + rate types — describe how cart addresses route to zones and
// which carrier rate applies. Stored as JSONB to keep zone authoring simple.
// ──────────────────────────────────────────────────────────────────────────────

export type RegionMatcher = {
  country: string;
  regions?: string[];
  postalPrefixes?: string[];
};

export type ShippingRate = {
  code: string;
  label: string;
  rateCents: number;
  minOrderCents?: number;
  maxOrderCents?: number;
  freeOverCents?: number;
};

// ──────────────────────────────────────────────────────────────────────────────
// Shipping zones
// ──────────────────────────────────────────────────────────────────────────────
// regions: ordered array; first match wins inside computeShipping().
// rates: array of selectable carrier options for this zone.
// isDefault: fallback zone when no region matches (e.g. 'rest of world').
// freeOverCents: zone-level threshold; the rate-level threshold takes priority.

export const shippingZones = pgTable(
  'shipping_zones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    regions: jsonb('regions').$type<RegionMatcher[]>().notNull(),
    rates: jsonb('rates').$type<ShippingRate[]>().notNull(),
    freeOverCents: integer('free_over_cents'),
    isDefault: boolean('is_default').notNull().default(false),
  },
  t => ({
    codeUnique: uniqueIndex('shipping_zones_store_code_uq').on(t.storeId, t.code),
  }),
);
