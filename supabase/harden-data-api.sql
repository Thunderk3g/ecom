-- =============================================================================
-- Supabase Data API lockdown — run ONCE in the SQL Editor on project
-- hasuznrxkgybphouxjoj (and any project provisioned before this file existed).
--
-- WHY (measured 2026-08-17, live against the project with only the publishable
-- key `sb_publishable_…` — the value that ships to every browser):
--
--   GET /rest/v1/users    -> 200  [{ email, password_hash: "$argon2id$…", … }]
--   GET /rest/v1/sessions -> 200  [{ id: <64-hex session token>, user_id, … }]
--   GET /rest/v1/stores   -> 200  [{ id, slug, name, … }]
--   DELETE/PATCH/POST on public tables -> grant present (204 / PGRST204, not 42501)
--
-- ROOT CAUSE: Supabase ships `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES TO
-- anon, authenticated` for the `postgres` role in `public`. Every one of this
-- app's 56 tables was created by a Drizzle migration running as `postgres`, so
-- all of them were born with SELECT/INSERT/UPDATE/DELETE granted to the two
-- PostgREST roles. Tenant tables survived only because 0004+ put RLS on them
-- (`app.store_id` is unset under PostgREST, so the predicate denies). The three
-- non-tenant tables had no such cover: `users` and `sessions` have no RLS at
-- all, and `stores`'s `stores_read_own` policy fails OPEN when `app.store_id`
-- is unset (deliberate, for request-time tenant resolution — see 0004 line 56).
--
-- FIX: this app's data path is Drizzle connecting as `app_user`; it never uses
-- the Data API. So take `public` away from anon/authenticated entirely, and drop
-- the default privileges so future migrations cannot silently re-expose it.
-- bootstrap.sql now does the same for freshly provisioned projects.
--
-- Safe to run: `app_user` and `app_migrator` grants are untouched, and nothing
-- in the app imports src/utils/supabase/* yet, so no application code loses
-- access. Idempotent — re-running is a no-op.
-- =============================================================================

-- 1. Standing grants on everything that already exists.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    RAISE NOTICE 'anon/authenticated absent (not a Supabase project) — skipping revokes';
    RETURN;
  END IF;

  EXECUTE 'REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated';
  EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated';
  EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated';

  -- Drops the explicit schema grants. NOTE: this does NOT make
  -- has_schema_privilege('anon','public','USAGE') false — Postgres grants
  -- USAGE on `public` to PUBLIC (the `=U/pg_database_owner` entry in nspacl),
  -- which every role inherits. Revoking USAGE from PUBLIC would close that too,
  -- but several Supabase-internal roles (authenticator, supabase_auth_admin,
  -- supabase_storage_admin, dashboard_user) rely on it and hold no explicit
  -- grant, so it is left alone. The table privileges revoked above are the
  -- actual boundary, and every table in `public` has RLS — verified externally.
  EXECUTE 'REVOKE USAGE, CREATE ON SCHEMA public FROM anon, authenticated';

  -- 2. Default privileges — the actual source of the exposure. Without this,
  --    the next `pnpm db:migrate` re-grants ALL on every new table.
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public '
          'REVOKE ALL ON TABLES FROM anon, authenticated';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public '
          'REVOKE ALL ON SEQUENCES FROM anon, authenticated';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public '
          'REVOKE ALL ON FUNCTIONS FROM anon, authenticated';
END
$$;

-- 3. Defense in depth on the two tables that have no RLS at all. Identical to
--    migration 0023_identity_rls.sql — run here because applying migrations
--    needs a Postgres port (5432/6543), which the corporate network blocks,
--    while the SQL Editor is plain HTTPS.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_user_all ON users;
CREATE POLICY app_user_all ON users FOR ALL TO app_user
  USING (true) WITH CHECK (true);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_user_all ON sessions;
CREATE POLICY app_user_all ON sessions FOR ALL TO app_user
  USING (true) WITH CHECK (true);

-- =============================================================================
-- APPLIED 2026-08-17 against hasuznrxkgybphouxjoj. Verified state:
--   * anon/authenticated privileges on public tables ......... 0 rows
--   * tables in public without RLS ........................... 0 rows
--   * GET/PATCH/DELETE /rest/v1/{users,sessions,stores,products,orders,
--     customers,site_config} with the publishable key ........ 42501 for all
--   * /auth/v1/settings with the publishable key ............. still 200
--   * app_user (NOBYPASSRLS) still reads users + creates/deletes sessions,
--     and products stay 0-rows without app.store_id / 40 with it.
--
-- RESIDUAL (accepted, not exploitable here): `supabase_admin`'s default
-- privileges in `public` still grant ALL on new tables/sequences/functions to
-- anon + authenticated, and `postgres` cannot revoke them ("42501 permission
-- denied to change default privileges" — only supabase_admin can). They fire
-- only for objects CREATED BY supabase_admin; Drizzle migrations and the seed
-- run as `postgres`, whose default privileges no longer include those roles. If
-- a table is ever created through a supabase_admin path, re-run this file.
-- =============================================================================

-- =============================================================================
-- VERIFY — expect zero rows from both queries.
-- =============================================================================

-- Any privilege still held on `public` by a Data API role:
--   SELECT table_name, grantee, privilege_type
--     FROM information_schema.role_table_grants
--    WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')
--    ORDER BY table_name, grantee;

-- Any table in `public` without RLS:
--   SELECT relname FROM pg_class c
--     JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;

-- Then re-run the external check from a shell — every one must be 401:
--   for t in users sessions stores; do
--     curl -s -o /dev/null -w "$t %{http_code}\n" \
--       -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" \
--       "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/$t?select=*&limit=1"; done
