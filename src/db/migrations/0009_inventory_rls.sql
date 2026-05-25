-- Inventory RLS: tenant isolation for every store_id-bearing inventory table,
-- parent-join policy for purchase_order_items (no direct store_id), and an
-- append-only guard on stock_movements (no UPDATE, no DELETE for app_user).
--
-- Conventions match 0004_enable_rls.sql:
--   - app_user MUST NOT bypass; app_migrator has BYPASSRLS for seeds / cron / triggers.
--   - Policies use NULLIF(current_setting('app.store_id', true), '')::uuid so that
--     both "never set" and "released after COMMIT" collapse to NULL → no rows.
--   - GRANTs are explicit; without them RLS denials never get a chance to fire because
--     app_user would hit permission-denied at the table layer first.

-- Grants for app_user on every new inventory table + sequence for bigserial.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  locations,
  variant_inventory_settings,
  stock_movements,
  stock_levels,
  stock_reservations,
  stock_batches,
  stock_thresholds,
  suppliers,
  supplier_skus,
  purchase_orders,
  purchase_order_items
  TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- locations
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON locations
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- variant_inventory_settings
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE variant_inventory_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON variant_inventory_settings
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- stock_movements — tenant isolation + append-only (no UPDATE, no DELETE)
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_read ON stock_movements FOR SELECT
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY tenant_insert ON stock_movements FOR INSERT
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY no_update ON stock_movements FOR UPDATE USING (false);
--> statement-breakpoint
CREATE POLICY no_delete ON stock_movements FOR DELETE USING (false);
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- stock_levels
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE stock_levels ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON stock_levels
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- stock_reservations
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE stock_reservations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON stock_reservations
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- stock_batches
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE stock_batches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON stock_batches
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- stock_thresholds
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE stock_thresholds ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON stock_thresholds
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- suppliers
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON suppliers
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- supplier_skus
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE supplier_skus ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON supplier_skus
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- purchase_orders
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON purchase_orders
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- purchase_order_items — scoped via parent purchase_orders.store_id
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON purchase_order_items
  USING (EXISTS (
    SELECT 1 FROM purchase_orders po
    WHERE po.id = purchase_order_items.po_id
      AND po.store_id = NULLIF(current_setting('app.store_id', true), '')::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM purchase_orders po
    WHERE po.id = purchase_order_items.po_id
      AND po.store_id = NULLIF(current_setting('app.store_id', true), '')::uuid
  ));
