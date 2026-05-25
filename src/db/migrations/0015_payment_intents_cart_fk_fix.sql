-- 0015_payment_intents_cart_fk_fix
-- Production bug surfaced in SP-4 Stream I tests: payment_intents.cart_id was
-- ON DELETE RESTRICT and NOT NULL, but createOrderFromCart deletes the cart after
-- successful payment. The intent must survive cart deletion for audit/lookup.
-- Fix: drop NOT NULL and the FK; re-add the FK with ON DELETE SET NULL.

ALTER TABLE payment_intents
  ALTER COLUMN cart_id DROP NOT NULL;

ALTER TABLE payment_intents
  DROP CONSTRAINT IF EXISTS payment_intents_cart_id_carts_id_fk;

ALTER TABLE payment_intents
  ADD CONSTRAINT payment_intents_cart_id_carts_id_fk
  FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE SET NULL;
