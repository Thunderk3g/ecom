-- Inventory triggers + generated column.
--   1. `available` generated column on stock_levels (on_hand - reserved).
--   2. apply_movement_to_levels(): AFTER INSERT ON stock_movements upserts the
--      stock_levels row. SECURITY DEFINER owned by app_migrator so it can touch
--      the levels row regardless of the calling user (the row is then RLS-gated
--      for reads via store_id).
--   3. check_threshold_breach(): AFTER UPDATE ON stock_levels emits a
--      pg_notify('inventory_alerts', …) when available crosses from > reorder_point
--      to <= reorder_point.
--   4. inv_store_id_check(): BEFORE INSERT/UPDATE consistency guard — refuses to
--      record inventory whose store_id disagrees with the variant's store_id.

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Generated `available` column
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE stock_levels
  ADD COLUMN available integer GENERATED ALWAYS AS (on_hand - reserved) STORED;
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. apply_movement_to_levels()
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION apply_movement_to_levels() RETURNS trigger AS $$
DECLARE
  delta_on_hand integer := 0;
  delta_reserved integer := 0;
BEGIN
  CASE NEW.kind
    WHEN 'inbound', 'transfer_in' THEN
      delta_on_hand := NEW.qty;
    WHEN 'outbound', 'transfer_out' THEN
      delta_on_hand := -NEW.qty;
    WHEN 'adjustment' THEN
      delta_on_hand := NEW.qty; -- signed input from caller
    WHEN 'reservation' THEN
      delta_reserved := NEW.qty;
    WHEN 'release' THEN
      delta_reserved := -NEW.qty;
    ELSE
      -- unknown kind: no-op (defensive; enum constrains this anyway)
      NULL;
  END CASE;

  INSERT INTO stock_levels (variant_id, location_id, store_id, on_hand, reserved, updated_at)
  VALUES (NEW.variant_id, NEW.location_id, NEW.store_id, delta_on_hand, delta_reserved, now())
  ON CONFLICT (variant_id, location_id) DO UPDATE
    SET on_hand    = stock_levels.on_hand + EXCLUDED.on_hand,
        reserved   = stock_levels.reserved + EXCLUDED.reserved,
        updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
--> statement-breakpoint

ALTER FUNCTION apply_movement_to_levels() OWNER TO app_migrator;
--> statement-breakpoint

CREATE TRIGGER stock_movements_apply
  AFTER INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION apply_movement_to_levels();
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. check_threshold_breach() — NOTIFY when available falls to/below reorder_point.
--    Triggered AFTER UPDATE so OLD/NEW.available are both defined.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION check_threshold_breach() RETURNS trigger AS $$
DECLARE
  th_reorder_point integer;
  was_above boolean;
  now_at_or_below boolean;
BEGIN
  SELECT reorder_point INTO th_reorder_point
    FROM stock_thresholds
    WHERE variant_id = NEW.variant_id
      AND location_id = NEW.location_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  was_above := (OLD.available > th_reorder_point);
  now_at_or_below := (NEW.available <= th_reorder_point);

  IF was_above AND now_at_or_below THEN
    PERFORM pg_notify(
      'inventory_alerts',
      json_build_object(
        'store_id',      NEW.store_id,
        'variant_id',    NEW.variant_id,
        'location_id',   NEW.location_id,
        'available',     NEW.available,
        'reorder_point', th_reorder_point
      )::text
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
--> statement-breakpoint

ALTER FUNCTION check_threshold_breach() OWNER TO app_migrator;
--> statement-breakpoint

CREATE TRIGGER stock_levels_threshold_check
  AFTER UPDATE ON stock_levels
  FOR EACH ROW EXECUTE FUNCTION check_threshold_breach();
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. inv_store_id_check() — variant.store_id must match inventory row.store_id.
--    Catches code paths that derive store_id from the request but a variant
--    belonging to a different tenant.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION inv_store_id_check() RETURNS trigger AS $$
DECLARE
  variant_store uuid;
BEGIN
  SELECT store_id INTO variant_store FROM product_variants WHERE id = NEW.variant_id;
  IF variant_store IS NULL THEN
    RAISE EXCEPTION 'inventory row references unknown variant %', NEW.variant_id;
  END IF;
  IF NEW.store_id <> variant_store THEN
    RAISE EXCEPTION 'inventory row store_id (%) does not match variant store_id (%)',
      NEW.store_id, variant_store;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
--> statement-breakpoint

ALTER FUNCTION inv_store_id_check() OWNER TO app_migrator;
--> statement-breakpoint

CREATE TRIGGER stock_movements_store_check
  BEFORE INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION inv_store_id_check();
--> statement-breakpoint

CREATE TRIGGER stock_levels_store_check
  BEFORE INSERT OR UPDATE ON stock_levels
  FOR EACH ROW EXECUTE FUNCTION inv_store_id_check();
--> statement-breakpoint

CREATE TRIGGER stock_reservations_store_check
  BEFORE INSERT ON stock_reservations
  FOR EACH ROW EXECUTE FUNCTION inv_store_id_check();
