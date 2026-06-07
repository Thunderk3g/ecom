-- =============================================================================
-- Supabase bootstrap — run ONCE per Supabase project, in the SQL Editor, BEFORE
-- applying Drizzle migrations. Provisions the NOBYPASSRLS runtime role that the
-- app connects as at request time (mirrors docker/postgres-init for local dev).
--
-- Why a separate runtime role: the platform's multi-tenancy is enforced by
-- Postgres Row-Level Security keyed on `current_setting('app.store_id')`. The
-- migrator (`postgres` on Supabase) is privileged and would BYPASS RLS; the
-- runtime MUST connect as a role that does NOT bypass RLS, or tenant isolation
-- silently disappears. See src/db/client.ts (resolveAppUrl / APP_DATABASE_URL).
--
-- After running this once: set APP_DATABASE_URL to a connection string using the
-- `app_user` role, and DATABASE_URL to the `postgres` (migrator) string.
-- =============================================================================

-- 1. Runtime role: login, NOBYPASSRLS. Replace the password with a real secret
--    and store it only in your deployment env (never commit it).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'REPLACE_WITH_A_STRONG_SECRET' NOBYPASSRLS;
  END IF;
END
$$;

-- 2. Connect + schema usage.
GRANT CONNECT ON DATABASE postgres TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;

-- 3. DML on every existing table/sequence (covers anything already created).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- 4. Default privileges so EVERY future table a migration creates (as `postgres`)
--    is automatically reachable by app_user — no re-grant needed per migration.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- 5. The `app.store_id` GUC needs no grant — custom namespaced run-time params
--    (anything with a dot, e.g. `app.*`) are settable by any role via SET LOCAL.
--    RLS policies read it with current_setting('app.store_id', true).

-- Note: app_user does NOT get BYPASSRLS and is NOT a member of any privileged
-- Supabase role (authenticated/service_role). That is intentional — RLS is the
-- isolation boundary and this role must be subject to it.
