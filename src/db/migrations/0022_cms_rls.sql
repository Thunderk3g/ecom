-- SP-7 CMS RLS: tenant isolation for all four CMS tables. Every table carries a
-- store_id column (content_versions denormalizes it so no join to content_pages
-- is needed), so each gets the standard direct-column policy.
--
-- Conventions match 0006_catalog_rls.sql / 0017_order_lifecycle_rls.sql:
--   - app_user MUST NOT bypass RLS; app_migrator has BYPASSRLS for seeds/cron.
--   - Policies use NULLIF(current_setting('app.store_id', true), '')::uuid so that
--     both "never set" and "released after COMMIT" collapse to NULL → no rows.
--   - GRANTs are explicit; without them RLS denials never fire because app_user
--     would hit permission-denied at the table layer first.

-- ──────────────────────────────────────────────────────────────────────────────
-- Grants for app_user on every CMS table.
-- ──────────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON
  content_pages,
  content_versions,
  content_blocks_lib,
  navigation_menus
  TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- content_pages
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE content_pages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON content_pages
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- content_versions — store_id is denormalized; use it directly.
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE content_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON content_versions
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- content_blocks_lib
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE content_blocks_lib ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON content_blocks_lib
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- navigation_menus
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE navigation_menus ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON navigation_menus
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
