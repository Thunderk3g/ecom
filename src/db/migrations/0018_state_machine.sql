-- SP-5 order state machine: trigger-enforced transition rules. The single
-- source of truth is the orders_status_transition_check function below. The
-- TypeScript helper `transitionOrder()` mirrors this map; the trigger is the
-- belt-and-braces guard that catches any caller (raw SQL, future job, etc.)
-- that bypasses the helper.
--
-- Allowed transitions:
--   pending_payment → paid | cancelled
--   paid            → fulfilled | cancelled | refunded
--   fulfilled       → completed | refunded
--   completed       → refunded
--   refunded        → (terminal)
--   cancelled       → (terminal)
--
-- Re-assignment to the same status is a no-op (returns NEW); this keeps
-- harmless rewrites (e.g. UPDATE … SET status=status …) from raising.

CREATE OR REPLACE FUNCTION orders_status_transition_check() RETURNS trigger AS $$
DECLARE
  allowed text[];
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  allowed := CASE OLD.status
    WHEN 'pending_payment' THEN ARRAY['paid', 'cancelled']
    WHEN 'paid'            THEN ARRAY['fulfilled', 'cancelled', 'refunded']
    WHEN 'fulfilled'       THEN ARRAY['completed', 'refunded']
    WHEN 'completed'       THEN ARRAY['refunded']
    ELSE ARRAY[]::text[]
  END;
  IF NOT (NEW.status::text = ANY(allowed)) THEN
    RAISE EXCEPTION 'invalid order status transition: % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER orders_status_transition
  BEFORE UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION orders_status_transition_check();
