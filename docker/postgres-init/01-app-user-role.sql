-- Auto-run by the postgres image on a FRESH data volume (files in
-- /docker-entrypoint-initdb.d/ execute once, in name order, at first init).
--
-- The compose POSTGRES_USER creates `app_migrator` (the BYPASSRLS superuser used
-- for migrations + seed). The application RUNTIME, however, connects as
-- `app_user` (NOBYPASSRLS) so Row-Level Security actually gates tenant queries —
-- see src/db/client.ts deriveAppUrl(). That runtime role is NOT created by any
-- Drizzle migration (roles are cluster-global, not schema objects), so without
-- this script a freshly recreated container is missing `app_user` and every RLS
-- migration fails with: role "app_user" does not exist.
--
-- Password matches POSTGRES_PASSWORD (dev_password) because the app reuses the
-- same credentials and only swaps the username. Dev-only; production provisions
-- this role out-of-band with a real secret.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'dev_password' NOBYPASSRLS;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE ecommerce TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;
