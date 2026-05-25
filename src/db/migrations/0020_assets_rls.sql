-- SP-8 asset tables: RLS + GRANTs, plus the catalog FK additions that SP-2
-- deferred (product_images.asset_id and categories.image_asset_id were bare
-- uuids until the assets table existed).
--
-- Conventions match 0009_inventory_rls.sql:
--   - app_user MUST NOT bypass; app_migrator has BYPASSRLS for seeds / jobs.
--   - Policies use NULLIF(current_setting('app.store_id', true), '')::uuid so
--     both "never set" and "released after COMMIT" collapse to NULL → no rows.
--   - GRANTs are explicit; without them RLS denials never fire because app_user
--     would hit permission-denied at the table layer first.
--   - asset_derivatives + asset_tags carry no own store_id; they are scoped via
--     a parent-join policy on the owning asset's store_id (same shape as
--     purchase_order_items in 0009).

-- Grants for app_user on the new asset tables.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  assets,
  asset_derivatives,
  asset_tags
  TO app_user;
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- assets — direct tenant isolation on store_id
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON assets
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- asset_derivatives — scoped via parent assets.store_id
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE asset_derivatives ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON asset_derivatives
  USING (EXISTS (
    SELECT 1 FROM assets a
    WHERE a.id = asset_derivatives.asset_id
      AND a.store_id = NULLIF(current_setting('app.store_id', true), '')::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM assets a
    WHERE a.id = asset_derivatives.asset_id
      AND a.store_id = NULLIF(current_setting('app.store_id', true), '')::uuid
  ));
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- asset_tags — scoped via parent assets.store_id
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE asset_tags ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON asset_tags
  USING (EXISTS (
    SELECT 1 FROM assets a
    WHERE a.id = asset_tags.asset_id
      AND a.store_id = NULLIF(current_setting('app.store_id', true), '')::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM assets a
    WHERE a.id = asset_tags.asset_id
      AND a.store_id = NULLIF(current_setting('app.store_id', true), '')::uuid
  ));
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- Catalog FK additions deferred from SP-2 (the assets table now exists).
--   - product_images.asset_id → assets.id ON DELETE RESTRICT: an asset cannot
--     be deleted while a product image still references it.
--   - categories.image_asset_id → assets.id ON DELETE SET NULL: dropping a
--     category hero image simply clears the reference.
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE product_images
  ADD CONSTRAINT product_images_asset_id_assets_id_fk
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE categories
  ADD CONSTRAINT categories_image_asset_id_assets_id_fk
  FOREIGN KEY (image_asset_id) REFERENCES assets(id) ON DELETE SET NULL;
