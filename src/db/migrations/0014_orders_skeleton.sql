-- Orders skeleton: number sequence + minting helper + late-binding payments FK.
--
-- The order-number sequence is global (not per-store) so a single nextval()
-- call mints a unique number; the store_slug prefix disambiguates customer-
-- facing labels across tenants. Starting at 100000 keeps printable numbers a
-- comfortable 6 digits from day one.
--
-- payments.order_id was emitted as a plain uuid in 0011 because orders did
-- not exist yet at that point in the dependency graph. We add the FK here
-- (ON DELETE SET NULL — preserves payment history even if an order row is
-- cancelled/purged).

-- Per-deployment order number sequence.
CREATE SEQUENCE orders_global_seq START 100000;
--> statement-breakpoint

-- Convenience function to mint a customer-facing order number.
-- Example: mint_order_number('inkbright') → 'INKBRIGHT-00100000'.
CREATE OR REPLACE FUNCTION mint_order_number(store_slug text) RETURNS text AS $$
DECLARE
  n bigint;
BEGIN
  n := nextval('orders_global_seq');
  RETURN upper(store_slug) || '-' || lpad(n::text, 8, '0');
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- Allow app_user to use the sequence (it's a public-schema object created here,
-- so the catch-all GRANT in earlier migrations doesn't apply retroactively).
GRANT USAGE, SELECT ON SEQUENCE orders_global_seq TO app_user;
--> statement-breakpoint

-- Late-binding cross-table FK: payments.order_id → orders.id.
ALTER TABLE payments
  ADD CONSTRAINT payments_order_id_fk
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
