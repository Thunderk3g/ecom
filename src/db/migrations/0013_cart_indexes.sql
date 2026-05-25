-- Cart partial indexes + qty constraint + sweep helper.
--
-- Two partial unique indexes carve out the guest-vs-customer cart invariant:
-- a session_id can have at most one cart without a customer_id (guest cart),
-- and a customer_id can have at most one cart per store. Each side is a
-- different uniqueness rule so they live in separate partial indexes rather
-- than a single composite.
--
-- carts_expires_idx supports the daily cart-ttl-sweep job (Task 20).

-- Guest carts: one cart per (store_id, session_id) when customer is null.
CREATE UNIQUE INDEX carts_guest_session_uq
  ON carts(store_id, session_id)
  WHERE customer_id IS NULL;
--> statement-breakpoint

-- Customer carts: one per (store_id, customer_id) when customer is set.
CREATE UNIQUE INDEX carts_customer_uq
  ON carts(store_id, customer_id)
  WHERE customer_id IS NOT NULL;
--> statement-breakpoint

-- Cart item qty must be positive — zero/negative qty is always a bug.
ALTER TABLE cart_items ADD CONSTRAINT cart_items_qty_positive CHECK (qty > 0);
--> statement-breakpoint

-- Idle cart sweep helper — expires_at is NOT NULL on carts, but the partial
-- predicate matches the inventory pattern and keeps the index lean for any
-- future schema relaxation.
CREATE INDEX carts_expires_idx ON carts(expires_at) WHERE expires_at IS NOT NULL;
