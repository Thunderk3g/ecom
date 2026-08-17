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

-- 0. Migrator owner role: NOLOGIN, BYPASSRLS. Mirrors the local `app_migrator`.
--    On Supabase the migrator connection logs in as `postgres`, but several
--    migrations (0010) do `ALTER FUNCTION ... OWNER TO app_migrator` so the
--    SECURITY DEFINER trigger functions (stock-level / threshold maintenance)
--    run with BYPASSRLS and can write across tenant RLS. That role must exist,
--    and `postgres` must be a MEMBER of it to transfer ownership. `postgres` on
--    Supabase has BYPASSRLS + CREATEROLE, so it can provision this.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_migrator') THEN
    CREATE ROLE app_migrator NOLOGIN BYPASSRLS;
  END IF;
END
$$;
GRANT app_migrator TO postgres;  -- lets postgres set OWNER TO app_migrator
-- Postgres requires the NEW owner to hold CREATE on the schema during an
-- ownership transfer, so app_migrator needs USAGE + CREATE on public.
GRANT USAGE, CREATE ON SCHEMA public TO app_migrator;
-- app_migrator owns + must DML every table the SECURITY DEFINER functions touch.
GRANT ALL ON ALL TABLES IN SCHEMA public TO app_migrator;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO app_migrator;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO app_migrator;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO app_migrator;

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

-- 6. Keep the Supabase Data API (PostgREST) out of `public`.
--    Supabase ships `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES TO anon,
--    authenticated` for the `postgres` role in `public`. Migrations run as
--    `postgres`, so WITHOUT this block every table they create is born
--    SELECT/INSERT/UPDATE/DELETE-able through https://<ref>.supabase.co/rest/v1
--    using the publishable key that ships to every browser. RLS covers the
--    tenant tables, but `users`/`sessions` are global (no store_id) and would
--    leak `password_hash` and live session tokens outright.
--
--    This app's data path is Drizzle as `app_user`; it never uses the Data API.
--    Revoking here — BEFORE migrations create any tables — means nothing is ever
--    exposed in the first place. Re-grant deliberately, per table, with RLS
--    enabled, if a future phase actually adopts the Data API.
--    (Already-provisioned project? Run supabase/harden-data-api.sql instead.)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
REVOKE USAGE, CREATE ON SCHEMA public FROM anon, authenticated;

-- Note: app_user does NOT get BYPASSRLS and is NOT a member of any privileged
-- Supabase role (authenticated/service_role). That is intentional — RLS is the
-- isolation boundary and this role must be subject to it.
