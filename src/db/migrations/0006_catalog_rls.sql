-- Catalog RLS. Same convention as 0004_enable_rls.sql: NULLIF(current_setting('app.store_id', true), '')::uuid
-- collapses both "never set" and "set then released" GUCs to NULL so app_user sees no rows by default.
--
-- bundle_components has no direct store_id column; isolation is via subquery on product_variants.
-- product_variants.store_id is denormalized; a trigger keeps it in sync with products.store_id.

-- Grants for app_user on catalog tables. RLS without grants is meaningless.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  categories,
  attribute_definitions,
  products,
  product_variants,
  product_images,
  bundle_components,
  product_reviews
  TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- categories
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON categories
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);

-- attribute_definitions
ALTER TABLE attribute_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON attribute_definitions
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);

-- products
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON products
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);

-- product_variants (denormalized store_id; trigger below enforces consistency with parent product)
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON product_variants
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);

-- product_images
ALTER TABLE product_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON product_images
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);

-- product_reviews
ALTER TABLE product_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON product_reviews
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);

-- bundle_components — no store_id column; isolate via the bundle variant.
-- Both sides (bundle and component) live in the same tenant by construction (variant_store_id_check
-- trigger ensures variants belong to the tenant). Checking the bundle side is sufficient and indexed.
ALTER TABLE bundle_components ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON bundle_components
  USING (
    EXISTS (
      SELECT 1 FROM product_variants pv
      WHERE pv.id = bundle_components.bundle_variant_id
        AND pv.store_id = NULLIF(current_setting('app.store_id', true), '')::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM product_variants pv
      WHERE pv.id = bundle_components.bundle_variant_id
        AND pv.store_id = NULLIF(current_setting('app.store_id', true), '')::uuid
    )
  );

-- Trigger: enforce product_variants.store_id = products.store_id.
-- Defense in depth on top of RLS — prevents a misbehaving caller from inserting a variant
-- whose denormalized store_id disagrees with its parent product.
CREATE OR REPLACE FUNCTION variant_store_id_check() RETURNS trigger AS $$
DECLARE
  parent_store_id uuid;
BEGIN
  SELECT store_id INTO parent_store_id FROM products WHERE id = NEW.product_id;
  IF parent_store_id IS NULL THEN
    RAISE EXCEPTION 'variant references nonexistent product %', NEW.product_id;
  END IF;
  IF NEW.store_id <> parent_store_id THEN
    RAISE EXCEPTION 'variant store_id (%) must match product store_id (%)', NEW.store_id, parent_store_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pv_store_id_check
  BEFORE INSERT OR UPDATE ON product_variants
  FOR EACH ROW EXECUTE FUNCTION variant_store_id_check();
