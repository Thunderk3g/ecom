# SP-3: Inventory — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the inventory domain — locations, immutable stock movements ledger, materialized stock levels, reservation flow with TTL, thresholds with low-stock alerts, suppliers, and purchase orders. Wire the BullMQ worker handlers and scheduler entries SP-1 stubbed (`reservation.ttl.sweep`, `inventory.alerts`). FK back to `product_variants` from SP-2.

**Architecture:** Event-sourced ledger (`stock_movements`) is the source of truth; `stock_levels` is a materialized snapshot maintained by a trigger that responds to ledger inserts. Reservations hold `qty` against `(variant_id, location_id)` with `expires_at`. Concurrent reservation correctness uses `SELECT ... FOR UPDATE` on the `stock_levels` row inside `withTenant`. Expiry is enforced both lazily (reads ignore expired reservations) and eagerly (scheduler enqueues `reservation.ttl.sweep` every minute; worker releases expired and updates `stock_levels.reserved`).

**Tech Stack additions:** none beyond SP-1/SP-2. BullMQ job processors land here. `ioredis` already pulled in by SP-1.

---

## Spec Coverage Map

| Spec section | Tasks |
|---|---|
| §2.2 Inventory domain (event-sourced, locations, reservation, thresholds, suppliers, batches) | 1–7 |
| §5.3 Inventory schema | 1–7 |
| §5.7 RLS policy pattern | 8 |
| §6.1 Storefront API (availability) | 13 |
| §6.2 Admin API (levels, adjust, transfers, suppliers, POs, thresholds) | 14–19 |
| §7 Queues (reservation.ttl.sweep, inventory.alerts) | 10, 11, 20, 21 |
| §6.4 Conventions (RFC 7807, cursor pagination, Idempotency-Key) | all API tasks |

---

## Assumptions (locked unless overruled)

1. **Ledger model:** `stock_movements` is **append-only**; never UPDATE or DELETE. Adjustments (negative or positive corrections) are new rows with `kind='adjustment'`. This preserves audit history and makes reconstruction possible.
2. **`stock_levels` is a real table, not a view:** updated by an AFTER INSERT trigger on `stock_movements`. Reason: faceted listings and storefront product pages join against current levels constantly — a view would re-aggregate on every read. The trigger pattern keeps the snapshot O(1) per movement.
3. **Reservation concurrency:** `SELECT ... FOR UPDATE` on the `stock_levels(variant_id, location_id)` row inside the reserving transaction. Reservation increment + level decrement happen in one transaction. This serializes concurrent reservations against the same SKU/location without advisory locks.
4. **Reservation TTL default:** 15 minutes. Configurable per store via `site_config.inventory.reservation_ttl_minutes` (SP-1 loader already supports nested keys). Reservations expire to status `'released'` after sweep; storefront reads ignore reservations with `expires_at < now() AND status = 'active'` so the user sees correct availability even before the sweep runs.
5. **Multi-location strategy:** every store has ≥ 1 location (seeded as `default-warehouse` for SP-3 acceptance). Storefront defaults to a single location (or pooled view — `site_config.inventory.pooled_availability: true` sums on_hand across locations); admin adjustments are always location-scoped.
6. **Batch tracking:** optional per variant. `product_variants` does **not** get a `batch_tracked` column (would force SP-2 schema churn); instead, batch tracking is implicit — variants with batches in `stock_batches` are batch-tracked. A `variant_inventory_settings(variant_id, batch_tracked bool)` table is added in SP-3 to avoid the SP-2 churn.
7. **Threshold alerts:** when a movement causes `stock_levels.available` to cross from `> reorder_point` to `<= reorder_point`, the AFTER INSERT trigger on `stock_movements` enqueues a `inventory.alerts` job (via a Postgres NOTIFY → a Node listener in the worker process). Simpler alternative considered (poll-only): rejected because alerts must fire within seconds of the breach.
8. **Migration numbering:** SP-3 takes 0008, 0009, 0010 (one schema, one RLS, one trigger/extension). If SP-2 hasn't merged yet at implementation time and our numbers collide, renumber to the next available slot before pushing. Forward-only ordering preserves history.
9. **FK to product_variants:** `inventory_levels.variant_id`, `stock_movements.variant_id`, `stock_reservations.variant_id`, `stock_thresholds.variant_id`, `supplier_skus.variant_id`, `purchase_order_items.variant_id`, `stock_batches.variant_id`, `variant_inventory_settings.variant_id` all FK to `product_variants(id)` with `ON DELETE RESTRICT` — inventory rows pin variants in place so accidental product deletion fails loudly.
10. **Cursor pagination:** same opaque cursor pattern SP-2 uses (`src/lib/cursor.ts`). Default 50, max 200.
11. **NOTIFY channel name:** `inventory_alerts` — listened to by the worker process started by `src/entrypoints/worker.ts`.

---

## File Structure (SP-3 final state)

```
src/db/schema/
├── (existing) tenancy.ts, identity.ts, sessions.ts, config.ts, catalog.ts, index.ts
└── inventory.ts                 ← NEW: locations, stock_movements, stock_levels, stock_reservations,
                                          stock_batches, stock_thresholds, suppliers, supplier_skus,
                                          purchase_orders, purchase_order_items, variant_inventory_settings

src/db/migrations/
├── (existing 0000–0007)
├── 0008_inventory.sql              ← drizzle-kit generated
├── 0009_inventory_rls.sql          ← hand-written RLS policies
└── 0010_inventory_triggers.sql     ← hand-written: levels materializer, alerts NOTIFY, store_id checks

src/modules/inventory/
├── availability.ts              ← checkAvailability(variantId, locationId, qty)
├── reservations.ts              ← reserve(cartId, items, ttl), release(reservationId), commit(reservationId, orderId)
├── movements.ts                 ← recordMovement(input), adjustStock(variantId, locationId, delta, reason)
├── levels.ts                    ← getLevel(variantId, locationId), getPooledLevel(variantId)
├── locations.ts                 ← list, create, update, delete (only if no levels)
├── thresholds.ts                ← setThreshold, getThresholds, checkBreach
├── suppliers.ts                 ← CRUD + supplier_skus mapping
├── purchase-orders.ts           ← create, receive (turns received qty into stock_movements)
└── alerts.ts                    ← Node listener for 'inventory_alerts' NOTIFY → enqueue email job

src/app/api/v1/inventory/
└── availability/route.ts        ← GET ?variantId=&locationId=&qty=

src/app/api/v1/admin/inventory/
├── locations/route.ts                       ← GET, POST
├── locations/[id]/route.ts                  ← PATCH, DELETE
├── levels/route.ts                          ← GET (list with filters)
├── levels/adjust/route.ts                   ← POST (adjustment movement)
├── transfers/route.ts                       ← POST (transfer between locations)
├── movements/route.ts                       ← GET (paginated ledger view)
├── reservations/route.ts                    ← GET (admin listing of active reservations)
├── reservations/[id]/release/route.ts       ← POST (manual release)
├── thresholds/route.ts                      ← GET, POST
├── thresholds/[variantId]/[locationId]/route.ts ← PATCH, DELETE
├── suppliers/route.ts                       ← GET, POST
├── suppliers/[id]/route.ts                  ← GET, PATCH, DELETE
├── suppliers/[id]/skus/route.ts             ← GET, POST
├── purchase-orders/route.ts                 ← GET, POST
├── purchase-orders/[id]/route.ts            ← GET, PATCH
└── purchase-orders/[id]/receive/route.ts    ← POST (records inbound movements)

src/queue/
├── queues.ts                    ← if not from SP-1: bullmq queue handles
└── jobs/
    ├── reservation-ttl-sweep.ts    ← worker handler
    └── inventory-alerts.ts         ← worker handler (email enqueue stub)

src/entrypoints/worker.ts        ← extend SP-1 stub: register both job processors + NOTIFY listener
src/entrypoints/scheduler.ts     ← extend SP-1 stub: schedule reservation.ttl.sweep every 60s

tests/
├── inventory-locations.test.ts
├── inventory-availability.test.ts
├── inventory-reservations.test.ts        ← happy + concurrency + TTL expiry
├── inventory-movements.test.ts
├── inventory-thresholds.test.ts          ← breach triggers NOTIFY
├── inventory-suppliers.test.ts
├── inventory-purchase-orders.test.ts
├── inventory-rls.test.ts                 ← cross-store isolation
└── inventory-api-pagination.test.ts
```

---

## Execution Notes for the Engineer

- Always reserve / release / commit inside one `withTenant` transaction — never split across transactions.
- Movements are append-only. If a flow needs to "undo" a movement, insert a compensating movement; never DELETE.
- The trigger that maintains `stock_levels` runs as the migrator role (BYPASSRLS), so it can touch the levels row regardless of the calling user. The trigger reads `NEW.store_id` from the inserting movement and propagates it onto the level row, which is then RLS-gated for reads.
- Worker process MUST connect to Postgres with `app_migrator` to LISTEN — the Node `pg` client's LISTEN does not interact with RLS, and the worker needs to see notifications across all stores. Be careful: this is the only place outside migrations where `app_migrator` is used at runtime. Document this in the worker entrypoint comment.
- Storefront `availability` endpoint must NOT leak per-variant stock counts; return only `inStock: boolean` and `low: boolean` (when level <= reorder_point) per common ecommerce UX. Internal admin endpoints return exact counts.
- All admin mutating endpoints require `Idempotency-Key` (SP-1 middleware).
- Storefront `reserve` is called internally by SP-4 checkout — SP-3 only exposes the function from `src/modules/inventory/reservations.ts`; no public HTTP surface for reserve/release/commit. The cart endpoint in SP-4 wraps it.

---

## Tasks

### Task 1 — Locations + variant inventory settings schema

**File:** `src/db/schema/inventory.ts` (create), `src/db/schema/index.ts` (re-export)

```ts
import { pgTable, uuid, text, integer, boolean, timestamp, jsonb, bigserial, pgEnum, uniqueIndex, index, primaryKey } from 'drizzle-orm/pg-core';
import { stores } from './tenancy';
import { productVariants } from './catalog';
import { users } from './identity';

export const locationType = pgEnum('location_type', ['warehouse', 'store', 'transit']);

export const locations = pgTable('locations', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  name: text('name').notNull(),
  type: locationType('type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  codeUnique: uniqueIndex('locations_store_code_uq').on(t.storeId, t.code),
}));

export const variantInventorySettings = pgTable('variant_inventory_settings', {
  variantId: uuid('variant_id').primaryKey().references(() => productVariants.id, { onDelete: 'restrict' }),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  batchTracked: boolean('batch_tracked').notNull().default(false),
  allowBackorder: boolean('allow_backorder').notNull().default(false),
});
```

**Acceptance:** schema compiles; unique constraint on `(store_id, code)`.

---

### Task 2 — Stock movements ledger

```ts
export const movementKind = pgEnum('movement_kind', ['inbound', 'outbound', 'adjustment', 'reservation', 'release', 'transfer_out', 'transfer_in']);

export const stockMovements = pgTable('stock_movements', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'restrict' }),
  variantId: uuid('variant_id').notNull().references(() => productVariants.id, { onDelete: 'restrict' }),
  locationId: uuid('location_id').notNull().references(() => locations.id, { onDelete: 'restrict' }),
  qty: integer('qty').notNull(),       // signed: positive inbound, negative outbound
  kind: movementKind('kind').notNull(),
  reason: text('reason'),               // 'po_receive', 'order_fulfillment', 'manual_adjust', 'shrinkage', ...
  refType: text('ref_type'),            // 'purchase_order', 'order', 'reservation'
  refId: uuid('ref_id'),
  batchId: uuid('batch_id'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  variantIdx: index('movements_variant_idx').on(t.variantId, t.createdAt.desc()),
  refIdx: index('movements_ref_idx').on(t.refType, t.refId),
}));
```

Append-only — no UPDATE/DELETE policy will be added in 0009.

**Acceptance:** schema compiles; ascending `id` ordering matches `created_at` ordering (bigserial).

---

### Task 3 — Stock levels (materialized snapshot)

```ts
export const stockLevels = pgTable('stock_levels', {
  variantId: uuid('variant_id').notNull().references(() => productVariants.id, { onDelete: 'restrict' }),
  locationId: uuid('location_id').notNull().references(() => locations.id, { onDelete: 'restrict' }),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  onHand: integer('on_hand').notNull().default(0),
  reserved: integer('reserved').notNull().default(0),
  // `available` is a generated column: on_hand - reserved (defined in 0010 SQL)
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({ pk: primaryKey({ columns: [t.variantId, t.locationId] }) }));
```

The `available` generated column is defined in `0010_inventory_triggers.sql` so drizzle-kit doesn't try to emit it.

**Acceptance:** schema compiles; primary key is composite.

---

### Task 4 — Reservations + batches

```ts
export const reservationStatus = pgEnum('reservation_status', ['active', 'committed', 'released', 'expired']);

export const stockReservations = pgTable('stock_reservations', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  variantId: uuid('variant_id').notNull().references(() => productVariants.id, { onDelete: 'restrict' }),
  locationId: uuid('location_id').notNull().references(() => locations.id, { onDelete: 'restrict' }),
  qty: integer('qty').notNull(),
  cartId: uuid('cart_id'),               // FK to carts added in SP-4
  orderId: uuid('order_id'),             // set on commit, FK in SP-5
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  status: reservationStatus('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  cartIdx: index('reservations_cart_idx').on(t.cartId),
  activeExpiresIdx: index('reservations_active_expires_idx')
    .on(t.expiresAt).where(sql`status = 'active'`),
}));

export const stockBatches = pgTable('stock_batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  variantId: uuid('variant_id').notNull().references(() => productVariants.id, { onDelete: 'restrict' }),
  locationId: uuid('location_id').notNull().references(() => locations.id, { onDelete: 'restrict' }),
  batchCode: text('batch_code').notNull(),
  qty: integer('qty').notNull(),
  expiryDate: timestamp('expiry_date', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  codeUnique: uniqueIndex('batches_variant_code_uq').on(t.variantId, t.locationId, t.batchCode),
}));
```

**Acceptance:** schema compiles; partial index `WHERE status='active'` powers the sweep query.

---

### Task 5 — Thresholds

```ts
export const stockThresholds = pgTable('stock_thresholds', {
  variantId: uuid('variant_id').notNull().references(() => productVariants.id, { onDelete: 'cascade' }),
  locationId: uuid('location_id').notNull().references(() => locations.id, { onDelete: 'cascade' }),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  reorderPoint: integer('reorder_point').notNull(),
  reorderQty: integer('reorder_qty').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({ pk: primaryKey({ columns: [t.variantId, t.locationId] }) }));
```

**Acceptance:** schema compiles.

---

### Task 6 — Suppliers + supplier_skus

```ts
export const suppliers = pgTable('suppliers', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  contact: jsonb('contact').$type<{ email?: string; phone?: string; address?: string }>(),
  leadTimeDays: integer('lead_time_days'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const supplierSkus = pgTable('supplier_skus', {
  supplierId: uuid('supplier_id').notNull().references(() => suppliers.id, { onDelete: 'cascade' }),
  variantId: uuid('variant_id').notNull().references(() => productVariants.id, { onDelete: 'restrict' }),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  supplierSku: text('supplier_sku').notNull(),
  costCents: integer('cost_cents').notNull(),
  moq: integer('moq').notNull().default(1),
}, t => ({ pk: primaryKey({ columns: [t.supplierId, t.variantId] }) }));
```

**Acceptance:** schema compiles.

---

### Task 7 — Purchase orders + items

```ts
export const poStatus = pgEnum('po_status', ['draft', 'placed', 'partial', 'received', 'cancelled']);

export const purchaseOrders = pgTable('purchase_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  supplierId: uuid('supplier_id').notNull().references(() => suppliers.id, { onDelete: 'restrict' }),
  status: poStatus('status').notNull().default('draft'),
  placedAt: timestamp('placed_at', { withTimezone: true }),
  expectedAt: timestamp('expected_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const purchaseOrderItems = pgTable('purchase_order_items', {
  poId: uuid('po_id').notNull().references(() => purchaseOrders.id, { onDelete: 'cascade' }),
  variantId: uuid('variant_id').notNull().references(() => productVariants.id, { onDelete: 'restrict' }),
  qtyOrdered: integer('qty_ordered').notNull(),
  qtyReceived: integer('qty_received').notNull().default(0),
  costCents: integer('cost_cents').notNull(),
}, t => ({ pk: primaryKey({ columns: [t.poId, t.variantId] }) }));
```

Re-export from `src/db/schema/index.ts`:

```ts
export * from './inventory';
```

**Acceptance:** all schemas compile; `pnpm db:generate -- --name inventory` produces 0008.

---

### Task 8 — Hand-written 0009 RLS migration

**File:** `src/db/migrations/0009_inventory_rls.sql`

For every tenant-scoped inventory table (locations, variant_inventory_settings, stock_movements, stock_levels, stock_reservations, stock_batches, stock_thresholds, suppliers, supplier_skus, purchase_orders):

```sql
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON locations FOR SELECT
  USING (store_id = current_setting('app.store_id', true)::uuid);
CREATE POLICY tenant_write ON locations FOR ALL
  USING (store_id = current_setting('app.store_id', true)::uuid)
  WITH CHECK (store_id = current_setting('app.store_id', true)::uuid);

-- repeat for each store_id-bearing table
```

For `purchase_order_items` (no `store_id` column), RLS via parent join:

```sql
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON purchase_order_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM purchase_orders po
    WHERE po.id = purchase_order_items.po_id
      AND po.store_id = current_setting('app.store_id', true)::uuid));
-- write policy mirrors
```

Additionally, prevent UPDATE/DELETE on `stock_movements` to enforce append-only:

```sql
CREATE POLICY no_update ON stock_movements FOR UPDATE USING (false);
CREATE POLICY no_delete ON stock_movements FOR DELETE USING (false);
```

(`app_migrator` bypasses RLS, so seeds/dev fixtures can still clean up.)

**Acceptance:** `tests/inventory-rls.test.ts` proves cross-store isolation and rejection of UPDATE/DELETE on movements.

---

### Task 9 — Hand-written 0010 triggers + generated columns

**File:** `src/db/migrations/0010_inventory_triggers.sql`

```sql
-- Generated column: available = on_hand - reserved
ALTER TABLE stock_levels
  ADD COLUMN available integer GENERATED ALWAYS AS (on_hand - reserved) STORED;

-- Materialization trigger: every stock_movement adjusts stock_levels
CREATE OR REPLACE FUNCTION apply_movement_to_levels() RETURNS trigger AS $$
DECLARE
  delta_on_hand integer := 0;
  delta_reserved integer := 0;
BEGIN
  CASE NEW.kind
    WHEN 'inbound', 'transfer_in', 'release' THEN delta_on_hand := NEW.qty;
    WHEN 'outbound', 'transfer_out' THEN delta_on_hand := -NEW.qty;
    WHEN 'adjustment' THEN delta_on_hand := NEW.qty;  -- signed input
    WHEN 'reservation' THEN delta_reserved := NEW.qty;
  END CASE;

  INSERT INTO stock_levels (variant_id, location_id, store_id, on_hand, reserved, updated_at)
  VALUES (NEW.variant_id, NEW.location_id, NEW.store_id, delta_on_hand, delta_reserved, now())
  ON CONFLICT (variant_id, location_id) DO UPDATE
    SET on_hand = stock_levels.on_hand + EXCLUDED.on_hand,
        reserved = stock_levels.reserved + EXCLUDED.reserved,
        updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
ALTER FUNCTION apply_movement_to_levels() OWNER TO app_migrator;

CREATE TRIGGER stock_movements_apply
  AFTER INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION apply_movement_to_levels();

-- Threshold breach detection -> NOTIFY
CREATE OR REPLACE FUNCTION check_threshold_breach() RETURNS trigger AS $$
DECLARE
  th record;
  was_above boolean;
  now_at_or_below boolean;
BEGIN
  SELECT reorder_point INTO th
    FROM stock_thresholds
    WHERE variant_id = NEW.variant_id AND location_id = NEW.location_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  was_above := (OLD.available > th.reorder_point);
  now_at_or_below := (NEW.available <= th.reorder_point);

  IF was_above AND now_at_or_below THEN
    PERFORM pg_notify(
      'inventory_alerts',
      json_build_object(
        'store_id', NEW.store_id,
        'variant_id', NEW.variant_id,
        'location_id', NEW.location_id,
        'available', NEW.available,
        'reorder_point', th.reorder_point
      )::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER stock_levels_threshold_check
  AFTER UPDATE ON stock_levels
  FOR EACH ROW EXECUTE FUNCTION check_threshold_breach();

-- store_id consistency: variant's store_id must match the level's store_id
CREATE OR REPLACE FUNCTION inv_store_id_check() RETURNS trigger AS $$
BEGIN
  IF NEW.store_id <> (SELECT store_id FROM product_variants WHERE id = NEW.variant_id) THEN
    RAISE EXCEPTION 'inventory row store_id must match variant store_id';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stock_movements_store_check BEFORE INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION inv_store_id_check();
CREATE TRIGGER stock_levels_store_check BEFORE INSERT OR UPDATE ON stock_levels
  FOR EACH ROW EXECUTE FUNCTION inv_store_id_check();
CREATE TRIGGER stock_reservations_store_check BEFORE INSERT ON stock_reservations
  FOR EACH ROW EXECUTE FUNCTION inv_store_id_check();
```

Update `meta/_journal.json` so drizzle-kit recognizes 0009 and 0010.

**Acceptance:** inserting a movement updates `stock_levels` atomically; crossing the reorder_point emits NOTIFY visible to a listening session.

---

### Task 10 — Availability module

**File:** `src/modules/inventory/availability.ts`

```ts
import { withTenant } from '@/modules/tenant/with-tenant';
import { stockLevels, stockReservations } from '@/db/schema/inventory';
import { eq, and, gte, lt, sql } from 'drizzle-orm';

export async function checkAvailability(
  storeId: string,
  variantId: string,
  locationId: string,
  requestedQty: number,
): Promise<{ available: number; canFulfill: boolean }> {
  return withTenant(storeId, async tx => {
    const [level] = await tx.select().from(stockLevels)
      .where(and(eq(stockLevels.variantId, variantId), eq(stockLevels.locationId, locationId)));
    if (!level) return { available: 0, canFulfill: false };

    // Lazy expiry: subtract reservations that are active AND expired (sweep hasn't run yet)
    const [stale] = await tx.select({ sum: sql<number>`coalesce(sum(qty), 0)` })
      .from(stockReservations)
      .where(and(
        eq(stockReservations.variantId, variantId),
        eq(stockReservations.locationId, locationId),
        eq(stockReservations.status, 'active'),
        lt(stockReservations.expiresAt, new Date()),
      ));
    const liveAvailable = level.available + (stale?.sum ?? 0);
    return { available: liveAvailable, canFulfill: liveAvailable >= requestedQty };
  });
}

export async function getPooledAvailable(storeId: string, variantId: string): Promise<number> {
  return withTenant(storeId, async tx => {
    const [row] = await tx.select({ sum: sql<number>`coalesce(sum(available), 0)` })
      .from(stockLevels).where(eq(stockLevels.variantId, variantId));
    return row?.sum ?? 0;
  });
}
```

**Acceptance:** integration test — seed 1 location with on_hand 10, reserved 3 → checkAvailability returns available=7; create an expired reservation of 2 → still returns 7 (lazy expiry adds back).

---

### Task 11 — Reservations module

**File:** `src/modules/inventory/reservations.ts`

```ts
export async function reserve(
  storeId: string,
  input: { cartId: string; items: { variantId: string; locationId: string; qty: number }[]; ttlSeconds?: number },
): Promise<{ reservationIds: string[] }> {
  return withTenant(storeId, async tx => {
    const ttl = input.ttlSeconds ?? 15 * 60;
    const expiresAt = new Date(Date.now() + ttl * 1000);
    const ids: string[] = [];
    for (const it of input.items) {
      // Lock the level row
      const [level] = await tx.execute(sql`
        SELECT on_hand, reserved FROM stock_levels
        WHERE variant_id = ${it.variantId} AND location_id = ${it.locationId}
        FOR UPDATE
      `);
      const available = (level?.on_hand ?? 0) - (level?.reserved ?? 0);
      if (available < it.qty) throw new InsufficientStockError(it.variantId, it.qty, available);

      // Append movement (reservation kind); trigger updates reserved
      await tx.insert(stockMovements).values({
        storeId, variantId: it.variantId, locationId: it.locationId,
        qty: it.qty, kind: 'reservation', reason: 'cart_reserve', refType: 'cart', refId: input.cartId,
      });
      const [r] = await tx.insert(stockReservations).values({
        storeId, variantId: it.variantId, locationId: it.locationId,
        qty: it.qty, cartId: input.cartId, expiresAt, status: 'active',
      }).returning({ id: stockReservations.id });
      ids.push(r!.id);
    }
    return { reservationIds: ids };
  });
}

export async function release(storeId: string, reservationId: string, reason = 'cart_abandoned'): Promise<void> {
  return withTenant(storeId, async tx => {
    const [r] = await tx.select().from(stockReservations).where(eq(stockReservations.id, reservationId));
    if (!r || r.status !== 'active') return;
    await tx.insert(stockMovements).values({
      storeId, variantId: r.variantId, locationId: r.locationId,
      qty: r.qty, kind: 'release', reason, refType: 'reservation', refId: r.id,
    });
    await tx.update(stockReservations).set({ status: 'released' }).where(eq(stockReservations.id, r.id));
  });
}

export async function commit(storeId: string, reservationIds: string[], orderId: string): Promise<void> {
  return withTenant(storeId, async tx => {
    for (const id of reservationIds) {
      const [r] = await tx.select().from(stockReservations).where(eq(stockReservations.id, id));
      if (!r || r.status !== 'active') throw new ReservationNotActiveError(id);
      // outbound movement decrements on_hand; need release of reservation as well to free up reserved.
      // Net effect: reserved -= qty, on_hand -= qty.
      await tx.insert(stockMovements).values({
        storeId, variantId: r.variantId, locationId: r.locationId,
        qty: r.qty, kind: 'release', reason: 'order_commit', refType: 'reservation', refId: r.id,
      });
      await tx.insert(stockMovements).values({
        storeId, variantId: r.variantId, locationId: r.locationId,
        qty: r.qty, kind: 'outbound', reason: 'order_fulfilled', refType: 'order', refId: orderId,
      });
      await tx.update(stockReservations).set({ status: 'committed', orderId }).where(eq(stockReservations.id, r.id));
    }
  });
}

export class InsufficientStockError extends Error { /* ... */ }
export class ReservationNotActiveError extends Error { /* ... */ }
```

**Acceptance:** concurrent reservation test — two transactions both try to reserve 6 of 10; one succeeds, the other gets InsufficientStockError.

---

### Task 12 — Movements module

**File:** `src/modules/inventory/movements.ts`

```ts
export async function recordMovement(storeId: string, input: {
  variantId: string;
  locationId: string;
  qty: number;
  kind: MovementKind;
  reason?: string;
  refType?: string;
  refId?: string;
  createdBy?: string;
}): Promise<{ id: bigint }> { /* ... */ }

export async function adjustStock(storeId: string, input: {
  variantId: string;
  locationId: string;
  delta: number;     // signed
  reason: string;    // required for audit
  createdBy: string;
}): Promise<void> {
  return recordMovement(storeId, {
    variantId: input.variantId,
    locationId: input.locationId,
    qty: input.delta,
    kind: 'adjustment',
    reason: input.reason,
    createdBy: input.createdBy,
  }).then(() => undefined);
}

export async function transfer(storeId: string, input: {
  variantId: string;
  fromLocationId: string;
  toLocationId: string;
  qty: number;
  reason?: string;
  createdBy: string;
}): Promise<void> {
  // two movements in one tx: transfer_out from source, transfer_in to dest
}

export async function listMovements(storeId: string, opts: {
  cursor?: string; limit?: number;
  variantId?: string; locationId?: string;
  from?: Date; to?: Date; kind?: MovementKind;
}): Promise<{ items: Movement[]; nextCursor: string | null }> { /* ... */ }
```

**Acceptance:** `tests/inventory-movements.test.ts` — adjustment with delta=-3 leaves on_hand decreased by 3, audit row written with reason.

---

### Task 13 — Storefront API: GET /api/v1/inventory/availability

**File:** `src/app/api/v1/inventory/availability/route.ts`

```ts
import { resolveTenant } from '@/modules/tenant/resolve';
import { checkAvailability, getPooledAvailable } from '@/modules/inventory/availability';
import { loadSiteConfig } from '@/modules/config/loader';

export async function GET(req: Request) {
  const tenant = await resolveTenant(req);
  if (!tenant) return problem({ status: 404, title: 'Unknown host', type: '/errors/tenant-not-found' });
  const url = new URL(req.url);
  const variantId = url.searchParams.get('variantId');
  const locationId = url.searchParams.get('locationId');
  const qty = parseInt(url.searchParams.get('qty') ?? '1', 10);
  if (!variantId) return problem({ status: 400, title: 'variantId required' });

  const cfg = await loadSiteConfig(tenant.storeId);
  const pooled = cfg.inventory?.pooled_availability ?? false;

  if (pooled && !locationId) {
    const avail = await getPooledAvailable(tenant.storeId, variantId);
    return Response.json({ data: { inStock: avail >= qty, low: false } });
  }

  if (!locationId) return problem({ status: 400, title: 'locationId required (pooled disabled)' });
  const { canFulfill, available } = await checkAvailability(tenant.storeId, variantId, locationId, qty);
  // Threshold lookup for "low" boolean
  const isLow = await isLow(tenant.storeId, variantId, locationId, available);
  return Response.json({ data: { inStock: canFulfill, low: isLow } });
}
```

`available` count is NOT leaked to the storefront. Admin uses a different endpoint.

**Acceptance:** `tests/inventory-availability.test.ts` — endpoint returns boolean only; exact qty hidden.

---

### Task 14 — Admin API: locations + levels

**Files:**
- `src/app/api/v1/admin/inventory/locations/route.ts` (GET, POST)
- `src/app/api/v1/admin/inventory/locations/[id]/route.ts` (PATCH, DELETE — DELETE 409s if any levels reference)
- `src/app/api/v1/admin/inventory/levels/route.ts` (GET, paginated)
- `src/app/api/v1/admin/inventory/levels/adjust/route.ts` (POST)
- `src/app/api/v1/admin/inventory/transfers/route.ts` (POST)

All admin endpoints: auth (SP-1 session) + RBAC (`inventory:*` or `*`) + CSRF + Idempotency-Key.

**Acceptance:** create location, adjust stock +5, list levels → on_hand = 5.

---

### Task 15 — Admin API: movements ledger + reservations

**Files:**
- `src/app/api/v1/admin/inventory/movements/route.ts` (GET, filterable, paginated)
- `src/app/api/v1/admin/inventory/reservations/route.ts` (GET active reservations, paginated)
- `src/app/api/v1/admin/inventory/reservations/[id]/release/route.ts` (POST)

**Acceptance:** admin can release a stuck reservation manually; ledger reflects two movements (reservation + release).

---

### Task 16 — Admin API: thresholds

**Files:**
- `src/app/api/v1/admin/inventory/thresholds/route.ts` (GET, POST)
- `src/app/api/v1/admin/inventory/thresholds/[variantId]/[locationId]/route.ts` (PATCH, DELETE)

**Acceptance:** setting reorder_point=10 then adjusting on_hand from 15 → 8 emits NOTIFY observed in test.

---

### Task 17 — Admin API: suppliers

**Files:**
- `src/app/api/v1/admin/inventory/suppliers/route.ts` (GET, POST)
- `src/app/api/v1/admin/inventory/suppliers/[id]/route.ts` (GET, PATCH, DELETE)
- `src/app/api/v1/admin/inventory/suppliers/[id]/skus/route.ts` (GET, POST)
- `src/app/api/v1/admin/inventory/suppliers/[id]/skus/[variantId]/route.ts` (PATCH, DELETE)

**Acceptance:** CRUD round-trip; deleting a supplier with active PO → 409.

---

### Task 18 — Admin API: purchase orders

**Files:**
- `src/app/api/v1/admin/inventory/purchase-orders/route.ts` (GET, POST)
- `src/app/api/v1/admin/inventory/purchase-orders/[id]/route.ts` (GET, PATCH)
- `src/app/api/v1/admin/inventory/purchase-orders/[id]/receive/route.ts` (POST)

`POST /receive` body: `{ items: [{ variantId, qty, locationId }] }`. Records inbound movements; updates `qty_received`; flips status to `partial` or `received`.

**Acceptance:** create PO with 50, receive 30 → status=partial, on_hand at location +30. Receive remaining 20 → status=received, on_hand +50 total.

---

### Task 19 — Reservation TTL sweep job

**File:** `src/queue/jobs/reservation-ttl-sweep.ts`

```ts
import type { Job } from 'bullmq';
import { migratorDb } from '@/db/client';
import { stockReservations, stockMovements } from '@/db/schema/inventory';
import { eq, and, lt, sql } from 'drizzle-orm';

export async function reservationTtlSweep(_job: Job<{}>): Promise<{ released: number }> {
  // Bypasses RLS deliberately — runs across all stores
  const expired = await migratorDb.select().from(stockReservations).where(and(
    eq(stockReservations.status, 'active'),
    lt(stockReservations.expiresAt, new Date()),
  )).limit(1000);

  let released = 0;
  for (const r of expired) {
    await migratorDb.transaction(async tx => {
      await tx.insert(stockMovements).values({
        storeId: r.storeId, variantId: r.variantId, locationId: r.locationId,
        qty: r.qty, kind: 'release', reason: 'ttl_expired', refType: 'reservation', refId: r.id,
      });
      await tx.update(stockReservations).set({ status: 'expired' }).where(eq(stockReservations.id, r.id));
    });
    released++;
  }
  return { released };
}
```

Scheduler enqueues every 60s.

**Acceptance:** test — create a reservation with `ttlSeconds=1`, sleep 2s, run sweep → reservation status='expired', `stock_levels.reserved` decremented.

---

### Task 20 — Inventory alerts listener

**File:** `src/modules/inventory/alerts.ts`

```ts
import { Client } from 'pg';
import { logger } from '@/lib/logger';
import { env } from '@/lib/env';
import { emailsQueue } from '@/queue/queues';

export async function startInventoryAlertsListener() {
  const client = new Client({ connectionString: env.DATABASE_URL_MIGRATOR });
  await client.connect();
  await client.query('LISTEN inventory_alerts');

  client.on('notification', async msg => {
    if (msg.channel !== 'inventory_alerts' || !msg.payload) return;
    try {
      const payload = JSON.parse(msg.payload);
      logger.info({ payload }, 'inventory threshold breached');
      await emailsQueue.add('inventory-low-stock', {
        storeId: payload.store_id,
        variantId: payload.variant_id,
        locationId: payload.location_id,
        available: payload.available,
        reorderPoint: payload.reorder_point,
      }, { attempts: 5, backoff: { type: 'exponential', delay: 1000 } });
    } catch (err) {
      logger.error({ err }, 'failed to handle inventory alert');
    }
  });

  client.on('error', err => logger.error({ err }, 'inventory alerts listener error'));
  return client;
}
```

**Acceptance:** worker process starts the listener; a manual NOTIFY in the DB results in a job appearing in the `emails` queue.

---

### Task 21 — Worker + scheduler entrypoint wiring

**Files (extend SP-1 stubs):**

`src/entrypoints/worker.ts`:

```ts
import { Worker } from 'bullmq';
import { redis } from '@/lib/redis';
import { reservationTtlSweep } from '@/queue/jobs/reservation-ttl-sweep';
import { inventoryAlerts } from '@/queue/jobs/inventory-alerts';
import { startInventoryAlertsListener } from '@/modules/inventory/alerts';
import { logger } from '@/lib/logger';

async function main() {
  logger.info('worker starting');
  new Worker('reservation.ttl.sweep', reservationTtlSweep, { connection: redis });
  new Worker('inventory.alerts', inventoryAlerts, { connection: redis });
  await startInventoryAlertsListener();
  logger.info('worker ready');
}
main().catch(err => { logger.error({ err }, 'worker failed'); process.exit(1); });
```

`src/entrypoints/scheduler.ts`:

```ts
import { Queue } from 'bullmq';
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';

const sweepQueue = new Queue('reservation.ttl.sweep', { connection: redis });

async function main() {
  logger.info('scheduler starting');
  await sweepQueue.upsertJobScheduler('reservation-ttl-sweep', {
    every: 60_000,
  }, { name: 'sweep', data: {} });
  logger.info('scheduler ready');
}
main().catch(err => { logger.error({ err }, 'scheduler failed'); process.exit(1); });
```

`src/queue/jobs/inventory-alerts.ts`:

```ts
import type { Job } from 'bullmq';
// SP-3 only enqueues the email; SP-9 (or SP-1's emails queue stub) renders/sends.
// Here this handler simply acknowledges receipt and logs.
export async function inventoryAlerts(job: Job): Promise<void> {
  // forward to email rendering pipeline (impl in later SP)
  return;
}
```

**Acceptance:** `pnpm worker` boots without error; `pnpm scheduler` boots and registers the sweep job; checking BullMQ UI shows recurring job.

---

### Task 22 — RLS isolation tests

**File:** `tests/inventory-rls.test.ts`

- Seed two stores (A, B), each with a location and a variant (variants come from SP-2 seed; or test seed builds minimal variants if SP-2 not yet merged).
- Insert movements via `withTenant(A, …)` and `withTenant(B, …)`.
- Assert from `withTenant(A, …)`: SELECT stock_movements returns only A's rows.
- Assert: UPDATE stock_movements raises policy violation.
- Assert: DELETE stock_movements raises policy violation.

**Acceptance:** green.

---

### Task 23 — Reservation concurrency test

**File:** `tests/inventory-reservations.test.ts`

```ts
// Seed: variant V, location L, on_hand 10
// Spawn two concurrent withTenant transactions both calling reserve(qty=6)
// Expect: one succeeds with reserved=6, other rejects with InsufficientStockError
// Final state: stock_levels.reserved = 6, stock_levels.on_hand = 10, stock_levels.available = 4
```

Also: TTL expiry test — reservation with `ttlSeconds=1`, run sweep, assert status='expired' and reserved decremented.

Also: commit test — reserve 3, then commit → reservation status='committed', on_hand=7, reserved=0.

**Acceptance:** all three scenarios green.

---

### Task 24 — Thresholds + alerts test

**File:** `tests/inventory-thresholds.test.ts`

- Use a Postgres LISTEN client on `inventory_alerts` channel.
- Set threshold(variant V, location L, reorder_point=10, reorder_qty=50).
- Adjust stock to on_hand=15 (no alert).
- Adjust delta=-8 → on_hand=7, available=7 ≤ 10 → expect notification within 1s.

**Acceptance:** green.

---

### Task 25 — Suppliers + purchase orders test

**File:** `tests/inventory-suppliers.test.ts`, `tests/inventory-purchase-orders.test.ts`

CRUD round-trip; PO receive flow with partial then full receive.

**Acceptance:** green.

---

### Task 26 — Pagination + API integration test

**File:** `tests/inventory-api-pagination.test.ts`

Create 75 movements. Walk via `?after=&limit=20` to exhaust. Same for reservations and POs.

**Acceptance:** green; no duplicates across pages.

---

### Task 27 — Seed augmentation

**File:** `src/db/seed.ts` (extend, do not replace)

Append:
- 1 location (`default-warehouse`)
- For each seeded variant from SP-2, an initial movement of qty=20 at default-warehouse
- 1 supplier ("Acme Stationery Supplies")
- 1 PO with 5 items, status='received'
- Thresholds (reorder_point=5, reorder_qty=50) on each variant

**Acceptance:** seed runs cleanly twice in a row (idempotent).

---

## Parallel Stream Groupings

### Stream A — Schemas, migrations, triggers (must finish first)
- Tasks 1, 2, 3, 4, 5, 6, 7, 8, 9
- Files: `src/db/schema/inventory.ts`, `0008_inventory.sql`, `0009_inventory_rls.sql`, `0010_inventory_triggers.sql`
- Sequential within (schema → 0008 → 0009 → 0010).

### Stream B — Core module services (after A)
- Tasks 10, 11, 12
- Files: `src/modules/inventory/{availability,reservations,movements}.ts`
- Internally: Tasks 11 and 12 can run in parallel (different files). Task 10 is read-only and independent.

### Stream C — Admin services (after B)
- Tasks: thresholds/suppliers/POs modules (parts of Task 14–18 module-service code)
- Files: `src/modules/inventory/{thresholds,suppliers,purchase-orders,locations}.ts`
- Independent files, can sub-parallelize.

### Stream D — Storefront API (after Stream B)
- Task 13
- File: `src/app/api/v1/inventory/availability/route.ts`
- Independent of Streams E, F.

### Stream E — Admin API (after Streams B + C)
- Tasks 14, 15, 16, 17, 18
- Files: `src/app/api/v1/admin/inventory/**`
- Disjoint subdirectories per task — can parallelize internally.

### Stream F — Worker + scheduler + alerts (after Stream A)
- Tasks 19, 20, 21
- Files: `src/queue/**`, `src/modules/inventory/alerts.ts`, `src/entrypoints/{worker,scheduler}.ts`
- Independent of API streams.

### Stream G — Tests + seed (after all)
- Tasks 22, 23, 24, 25, 26, 27
- Files: `tests/inventory-*.test.ts`, `src/db/seed.ts` (extend only)

### Dispatch order
1. Stream A solo (foundational).
2. Streams B + F launched together (B is the API foundation, F is worker/alerts — independent).
3. After B done: Stream C, then D + E together.
4. After everything: Stream G.

---

## Verification Plan

After all tasks done, on a clean checkout (with SP-2 merged):

```
pnpm install
pnpm db:up
pnpm db:migrate          # 0000–0010 applied
pnpm db:seed             # SP-1 + SP-2 + SP-3 seed
pnpm typecheck
pnpm test                # all tests green
pnpm worker &            # boots worker process
pnpm scheduler &         # boots scheduler
pnpm dev                 # boots Next.js

# Storefront availability
curl -H "Host: inkwell.localhost:3000" \
  "http://localhost:3000/api/v1/inventory/availability?variantId=<seeded-variant>&locationId=<seeded-loc>&qty=1"
# expect { data: { inStock: true, low: false } }

# Admin adjust (with cookie + CSRF + idempotency)
curl -X POST -H "Cookie: session=..." -H "X-CSRF-Token: ..." -H "Idempotency-Key: $(uuidgen)" \
     -H "Content-Type: application/json" \
     -d '{"variantId":"...","locationId":"...","delta":-3,"reason":"shrinkage"}' \
     "http://localhost:3000/api/v1/admin/inventory/levels/adjust"

# Watch worker logs for sweep + alert handling
```

Build: `pnpm build` succeeds with no new warnings.

---

## Risks & Open Questions

1. **NOTIFY payload size:** Postgres caps NOTIFY payloads at 8000 bytes. The JSON payload here is well under, but if we later add product names / SKUs to the payload it could grow. Mitigation: keep payload to IDs only; the worker enriches by reading the DB.
2. **`app_migrator` at runtime in worker:** the LISTEN client uses the migrator role, which has BYPASSRLS. This is deliberate but increases blast radius if the worker is compromised. Mitigation: the worker only listens (no writes via this client); all DB writes from job processors use `migratorDb` for cross-tenant sweeps, RLS-respecting `appDb` for store-scoped logic.
3. **Trigger ownership:** the materializer trigger must be SECURITY DEFINER owned by `app_migrator` so it can INSERT into `stock_levels` regardless of the calling user. Reviewers should verify in 0010.
4. **Race between commit and TTL sweep:** if a reservation is committed at the exact moment the sweep selects it as expired, the sweep's UPDATE-WHERE-status='active' will affect 0 rows — safe. Documented.
5. **Multi-location pooling vs UI confusion:** if `pooled_availability=true` but admin still adjusts per-location, the storefront shows aggregated availability while admin sees per-location numbers. This is intentional but warrants docs. Out of scope: a "pool of locations" abstraction.
6. **Backorder support:** `variant_inventory_settings.allow_backorder` is in the schema but not consulted by `checkAvailability` — backorder allows `canFulfill: true` even when available < qty. Implementation deferred to SP-4 (cart) since backorder semantics are checkout-flow concerns, not pure inventory. Schema field exists so SP-4 doesn't migrate again.
7. **Stock batches FIFO:** `stock_batches` is in schema but not exercised by reservation/commit (which doesn't pick a batch). Picking by FIFO/FEFO is a SP-5 fulfillment concern. SP-3 just persists batches; SP-5 will add the picking algorithm.
