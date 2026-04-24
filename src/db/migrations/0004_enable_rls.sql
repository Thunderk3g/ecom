-- Enable RLS on tenant-scoped tables. app_user MUST NOT bypass; app_migrator does (BYPASSRLS role attr).
-- Convention: policy uses NULLIF(current_setting('app.store_id', true), '')::uuid; missing or empty setting → NULL → no rows.
-- Empty-string case matters because once a custom GUC is set (even via set_config(..., true)) inside a
-- transaction, Postgres keeps the GUC registered in the session and current_setting returns '' rather
-- than NULL after COMMIT. NULLIF collapses both "never set" and "set and released" to NULL so the
-- store_id comparison yields UNKNOWN and the policy denies rows.

-- Grants for app_user on tenant-scoped tables. RLS without grants is meaningless (app_user would
-- hit "permission denied" before the policy could filter). The ALTER DEFAULT PRIVILEGES set when
-- app_user was created does not survive a DROP SCHEMA public, so grant explicitly here.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  stores, store_domains, store_users, users, customers, addresses, sessions, site_config, feature_flags
  TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- tenant tables with a direct store_id column
ALTER TABLE store_domains ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON store_domains
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);

ALTER TABLE store_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON store_users
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customers
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);

ALTER TABLE site_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON site_config
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);

ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON feature_flags
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);

-- addresses: scoped via customers.store_id join
ALTER TABLE addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON addresses
  USING (EXISTS (
    SELECT 1 FROM customers c
    WHERE c.id = addresses.customer_id
      AND c.store_id = NULLIF(current_setting('app.store_id', true), '')::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM customers c
    WHERE c.id = addresses.customer_id
      AND c.store_id = NULLIF(current_setting('app.store_id', true), '')::uuid
  ));

-- stores: read-only for app_user; writes go through migrator or admin (SP-6).
-- Read is permissive when app.store_id is unset so early request-time lookups (e.g. tenant resolve)
-- can find a store before RLS is scoped. Absence of a FOR INSERT/UPDATE/DELETE policy means those
-- operations are denied for app_user.
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
CREATE POLICY stores_read_own ON stores FOR SELECT
  USING (id = NULLIF(current_setting('app.store_id', true), '')::uuid
         OR NULLIF(current_setting('app.store_id', true), '') IS NULL);
