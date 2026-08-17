-- Identity tables are global (no store_id), so 0004 deliberately left RLS off:
-- with Drizzle as the only data path, app_user's table grants were the whole
-- boundary. That assumption breaks the moment a PostgREST-style API can reach
-- `public` — on Supabase, `anon` then reads users.password_hash and sessions.id
-- straight out of the Data API with the browser-visible publishable key.
-- Enable RLS on both so a stray or default grant can no longer expose them.
--
-- app_user is NOBYPASSRLS and legitimately needs full access to both tables
-- (login, session create / refresh / revoke), so these policies are role-scoped
-- rather than predicate-scoped. app_migrator and postgres bypass RLS via the
-- BYPASSRLS role attribute, so migrations and seeding are unaffected.
--
-- Idempotent: supabase/harden-data-api.sql applies the same statements for a
-- project that was provisioned before this migration existed.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_user_all ON users;
CREATE POLICY app_user_all ON users FOR ALL TO app_user
  USING (true) WITH CHECK (true);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_user_all ON sessions;
CREATE POLICY app_user_all ON sessions FOR ALL TO app_user
  USING (true) WITH CHECK (true);
