-- =============================================================================
-- Supabase Cron (pg_cron) — background SWEEPS without a worker host.
--
-- Run ONCE per Supabase project, in the SQL Editor, AFTER Drizzle migrations +
-- bootstrap.sql. Mirrors the bootstrap.sql pattern: Supabase-only setup that is
-- deliberately NOT a Drizzle migration (pg_cron does not exist in local Docker,
-- so a migration carrying `create extension pg_cron` / `cron.schedule` would
-- break `pnpm db:migrate` locally; local dev keeps using the BullMQ scheduler).
--
-- WHY: on Vercel the app runs only the `web` role — the long-lived `worker` +
-- `scheduler` (BullMQ) processes have no home. These two TTL sweeps are the
-- correctness-critical scheduler jobs (they free reserved stock); they are
-- plain SQL, so pg_cron runs them in-database for $0. See SUPABASE-MIGRATION.md.
--
-- SCOPE (deliberate): only the two CLEAN TTL sweeps are ported here. The
-- `orders.stale-payment-sweep` and the event-driven jobs (webhook.dispatch,
-- emails, image.post-process, csv.imports) are NOT handled by this file — see
-- the "Deferred" note at the bottom.
--
-- SECURITY: functions live in a private `jobs` schema (NOT exposed to the Data
-- API), are SECURITY INVOKER (the default), and EXECUTE is revoked from PUBLIC.
-- pg_cron runs them as the scheduling role (`postgres`, which has BYPASSRLS), so
-- they need no SECURITY DEFINER and no `app.store_id` — exactly like the TS
-- worker sweeps, which also run cross-tenant with BYPASSRLS. The `release`
-- stock_movements they insert fire the existing AFTER INSERT trigger
-- (apply_movement_to_levels, keyed off NEW.store_id) that decrements
-- stock_levels.reserved. See src/db/migrations/0010_inventory_triggers.sql.
-- =============================================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- PART A — schema + sweep functions (portable; safe to run on local Postgres too)
-- ──────────────────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS jobs;
REVOKE ALL ON SCHEMA jobs FROM PUBLIC;

-- Reservation TTL sweep — mirrors src/queue/jobs/reservation-ttl-sweep.ts.
-- Releases active reservations whose expires_at has passed: flip status to
-- 'expired' and insert a 'release' movement (trigger decrements reserved).
-- Idempotent: the status guard makes a re-run on the same row a no-op.
-- Per-row BEGIN/EXCEPTION isolates a bad row so one failure does not abort the
-- whole tick (parity with the TS try/catch); idempotency makes retry-next-tick
-- safe. Batched + FOR UPDATE SKIP LOCKED so it never blocks live checkout.
CREATE OR REPLACE FUNCTION jobs.reservation_ttl_sweep()
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_released integer := 0;
  r record;
BEGIN
  FOR r IN
    SELECT id, store_id, variant_id, location_id, qty
    FROM stock_reservations
    WHERE status = 'active' AND expires_at < now()
    ORDER BY expires_at
    LIMIT 1000
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      UPDATE stock_reservations
        SET status = 'expired'
        WHERE id = r.id AND status = 'active';
      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      INSERT INTO stock_movements
        (store_id, variant_id, location_id, qty, kind, reason, ref_type, ref_id)
      VALUES
        (r.store_id, r.variant_id, r.location_id, r.qty, 'release', 'ttl_expired', 'reservation', r.id);

      v_released := v_released + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'reservation_ttl_sweep: failed to release reservation % (store %): %',
        r.id, r.store_id, SQLERRM;
    END;
  END LOOP;

  RETURN v_released;
END;
$$;

REVOKE EXECUTE ON FUNCTION jobs.reservation_ttl_sweep() FROM PUBLIC;

-- Cart TTL sweep — mirrors src/queue/jobs/cart-ttl-sweep.ts.
-- For each cart whose expires_at has passed: release its active reservations
-- (flip to 'released' + insert a 'release' movement), then delete the cart
-- (cart_items cascade). Idempotent: swept carts are gone, reservations flipped.
CREATE OR REPLACE FUNCTION jobs.cart_ttl_sweep()
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_carts integer := 0;
  c record;
  r record;
BEGIN
  FOR c IN
    SELECT id, store_id
    FROM carts
    WHERE expires_at < now()
    ORDER BY expires_at
    LIMIT 500
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      FOR r IN
        SELECT id, store_id, variant_id, location_id, qty
        FROM stock_reservations
        WHERE cart_id = c.id AND status = 'active'
        FOR UPDATE
      LOOP
        UPDATE stock_reservations
          SET status = 'released'
          WHERE id = r.id AND status = 'active';
        IF NOT FOUND THEN
          CONTINUE;
        END IF;

        INSERT INTO stock_movements
          (store_id, variant_id, location_id, qty, kind, reason, ref_type, ref_id)
        VALUES
          (r.store_id, r.variant_id, r.location_id, r.qty, 'release', 'cart_expired', 'reservation', r.id);
      END LOOP;

      DELETE FROM carts WHERE id = c.id;
      v_carts := v_carts + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'cart_ttl_sweep: failed to sweep cart % (store %): %',
        c.id, c.store_id, SQLERRM;
    END;
  END LOOP;

  RETURN v_carts;
END;
$$;

REVOKE EXECUTE ON FUNCTION jobs.cart_ttl_sweep() FROM PUBLIC;

-- ──────────────────────────────────────────────────────────────────────────────
-- PART B — pg_cron wiring (SUPABASE ONLY — do NOT run on local Postgres)
-- ──────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Re-running this file should not stack duplicate schedules. cron.unschedule
-- raises if the job is absent, so swallow that on first run.
DO $$ BEGIN PERFORM cron.unschedule('reservation-ttl-sweep'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('cart-ttl-sweep');        EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Reservation sweep every minute (closest standard-cron cadence to the TS
-- scheduler's 60s). Cart sweep every 6 hours (matches the TS scheduler).
SELECT cron.schedule('reservation-ttl-sweep', '* * * * *',  $$ SELECT jobs.reservation_ttl_sweep(); $$);
SELECT cron.schedule('cart-ttl-sweep',         '0 */6 * * *', $$ SELECT jobs.cart_ttl_sweep(); $$);

-- Inspect:   SELECT jobname, schedule, active FROM cron.job;
-- Run audit: SELECT jobname, status, return_message, start_time
--              FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;

-- =============================================================================
-- Deferred (NOT handled here) — these still have no consumer after this file:
--   * orders.stale-payment-sweep — cancels orders stuck in 'pending_payment'
--     and releases their reservations. Complex (best-effort payment_intents
--     lookup) and writes outbox_events that nothing consumes yet. Planned:
--     pg_cron -> pg_net -> a secured Vercel route that runs the EXISTING TS
--     sweep (one implementation, no logic fork), once webhook delivery lands.
--   * webhook.dispatch / emails / image.post-process / csv.imports — these
--     enqueue to Upstash (BullMQ) but have no worker; jobs and outbox_events
--     accumulate unconsumed. Acceptable for soft launch; full retirement is
--     Phase 4 (Postgres queue + Edge Functions). Redis/Upstash is still
--     REQUIRED regardless (middleware rate-limiting).
-- =============================================================================
