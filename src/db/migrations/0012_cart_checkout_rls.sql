-- Cart / checkout RLS. Same convention as 0004_enable_rls.sql:
--   - app_user MUST NOT bypass; app_migrator has BYPASSRLS for seeds / cron / webhooks
--     that legitimately span tenants (e.g. provider webhook routing payload to the
--     right store before app.store_id is known).
--   - Policies use NULLIF(current_setting('app.store_id', true), '')::uuid so that
--     both "never set" and "set then released" collapse to NULL → no rows.
--   - GRANTs are explicit; without them RLS denials never fire because app_user would
--     hit permission-denied at the table layer first.
--
-- Defense-in-depth triggers enforce that cart_items.store_id matches its parent
-- carts.store_id, and order_items.store_id matches its parent orders.store_id —
-- analogous to SP-2's variant_store_id_check.

-- ──────────────────────────────────────────────────────────────────────────────
-- Grants for app_user on every new SP-4 table.
-- ──────────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON
  carts,
  cart_items,
  promotions,
  promotion_redemptions,
  tax_rates,
  shipping_zones,
  payment_intents,
  payments,
  payment_events,
  orders,
  order_items
  TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- carts
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE carts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON carts
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- cart_items (store_id denormalized; trigger below enforces parent consistency)
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE cart_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON cart_items
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- promotions
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON promotions
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- promotion_redemptions
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE promotion_redemptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON promotion_redemptions
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- tax_rates
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE tax_rates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON tax_rates
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- shipping_zones
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE shipping_zones ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON shipping_zones
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- payment_intents
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE payment_intents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON payment_intents
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- payments
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON payments
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- payment_events
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON payment_events
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- orders
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON orders
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- order_items (store_id denormalized; trigger below enforces parent consistency)
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON order_items
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- Trigger: enforce cart_items.store_id = parent carts.store_id.
-- Defense in depth on top of RLS — prevents a misbehaving caller from inserting
-- a cart_item whose denormalized store_id disagrees with its parent cart.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cart_item_store_id_check() RETURNS trigger AS $$
DECLARE
  parent_store_id uuid;
BEGIN
  SELECT store_id INTO parent_store_id FROM carts WHERE id = NEW.cart_id;
  IF parent_store_id IS NULL THEN
    RAISE EXCEPTION 'cart_item references nonexistent cart %', NEW.cart_id;
  END IF;
  IF NEW.store_id <> parent_store_id THEN
    RAISE EXCEPTION 'cart_item store_id (%) must match cart store_id (%)', NEW.store_id, parent_store_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER cart_item_store_id_check
  BEFORE INSERT OR UPDATE ON cart_items
  FOR EACH ROW EXECUTE FUNCTION cart_item_store_id_check();
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- Trigger: enforce order_items.store_id = parent orders.store_id.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION order_item_store_id_check() RETURNS trigger AS $$
DECLARE
  parent_store_id uuid;
BEGIN
  SELECT store_id INTO parent_store_id FROM orders WHERE id = NEW.order_id;
  IF parent_store_id IS NULL THEN
    RAISE EXCEPTION 'order_item references nonexistent order %', NEW.order_id;
  END IF;
  IF NEW.store_id <> parent_store_id THEN
    RAISE EXCEPTION 'order_item store_id (%) must match order store_id (%)', NEW.store_id, parent_store_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER order_item_store_id_check
  BEFORE INSERT OR UPDATE ON order_items
  FOR EACH ROW EXECUTE FUNCTION order_item_store_id_check();
