-- SP-5 RLS: tenant isolation for every store_id-bearing lifecycle table, plus
-- parent-join policies for the four child tables that intentionally have no
-- store_id column (fulfillment_items, shipment_items, refund_items already use
-- their parent's store_id; addresses uses its parent customer's store_id).
--
-- Append-only guard on order_events: no UPDATE, no DELETE for app_user — the
-- timeline is the audit log, never mutated in-place. Same pattern as
-- stock_movements in 0009.
--
-- Conventions match 0004_enable_rls.sql / 0009_inventory_rls.sql:
--   - app_user MUST NOT bypass; app_migrator has BYPASSRLS for seeds / cron / triggers.
--   - Policies use NULLIF(current_setting('app.store_id', true), '')::uuid so that
--     both "never set" and "released after COMMIT" collapse to NULL → no rows.
--   - GRANTs are explicit; without them RLS denials never get a chance to fire because
--     app_user would hit permission-denied at the table layer first.
--
-- Note: addresses already has RLS enabled by 0004 (parent-join via customers).
-- The new `addresses.created_at` column is covered by the existing policy.

-- ──────────────────────────────────────────────────────────────────────────────
-- Grants for app_user on every new SP-5 table.
-- ──────────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON
  fulfillments,
  fulfillment_items,
  shipments,
  shipment_items,
  refunds,
  refund_items,
  order_events,
  audit_log,
  webhooks,
  webhook_deliveries,
  outbox_events
  TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- fulfillments
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE fulfillments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON fulfillments
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- fulfillment_items — scoped via parent fulfillments.store_id
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE fulfillment_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON fulfillment_items
  USING (EXISTS (
    SELECT 1 FROM fulfillments f
    WHERE f.id = fulfillment_items.fulfillment_id
      AND f.store_id = NULLIF(current_setting('app.store_id', true), '')::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM fulfillments f
    WHERE f.id = fulfillment_items.fulfillment_id
      AND f.store_id = NULLIF(current_setting('app.store_id', true), '')::uuid
  ));
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- shipments
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON shipments
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- shipment_items — scoped via parent shipments.store_id
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE shipment_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON shipment_items
  USING (EXISTS (
    SELECT 1 FROM shipments s
    WHERE s.id = shipment_items.shipment_id
      AND s.store_id = NULLIF(current_setting('app.store_id', true), '')::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM shipments s
    WHERE s.id = shipment_items.shipment_id
      AND s.store_id = NULLIF(current_setting('app.store_id', true), '')::uuid
  ));
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- refunds
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON refunds
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- refund_items — scoped via parent refunds.store_id
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE refund_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON refund_items
  USING (EXISTS (
    SELECT 1 FROM refunds r
    WHERE r.id = refund_items.refund_id
      AND r.store_id = NULLIF(current_setting('app.store_id', true), '')::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM refunds r
    WHERE r.id = refund_items.refund_id
      AND r.store_id = NULLIF(current_setting('app.store_id', true), '')::uuid
  ));
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- order_events — tenant isolation + append-only (no UPDATE, no DELETE)
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE order_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_read ON order_events FOR SELECT
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY tenant_insert ON order_events FOR INSERT
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY no_update ON order_events FOR UPDATE USING (false);
--> statement-breakpoint
CREATE POLICY no_delete ON order_events FOR DELETE USING (false);
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- audit_log
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON audit_log
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- webhooks
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON webhooks
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- webhook_deliveries
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON webhook_deliveries
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
--> statement-breakpoint

-- ──────────────────────────────────────────────────────────────────────────────
-- outbox_events
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON outbox_events
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
