# SP-4: Cart & Checkout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement cart, pricing, promotions, tax, shipping, and payment intents on top of SP-1/SP-2/SP-3. Storefront customers (logged in or guest) can add catalog variants to a cart, apply coupons, get tax/shipping calculated, and start a checkout that reserves inventory and produces a payment intent against Razorpay or Stripe. Confirmation creates a minimal order row (the orders schema is owned here; SP-5 extends with fulfillment/refunds/webhooks).

**Architecture:** Cart is server-side for logged-in customers and session-cookie-anchored for guests. Pricing is computed centrally by a `PricingEngine` so storefront, cart preview, and checkout return identical totals. Promotions apply via a deterministic rule evaluator. Reservation happens at `checkout/start`; on payment success (webhook from provider), `checkout/confirm` commits the reservation and creates the order. Two payment providers behind a single `PaymentProvider` interface (Razorpay default for INR per spec §16, Stripe optional). All money in integer cents to avoid float drift.

**Tech additions:**
- `razorpay` SDK (Node) — webhook signature verification + order creation
- `stripe` SDK (Node) — webhook signature verification + PaymentIntent creation
- `crypto.timingSafeEqual` for HMAC checks
- No new infra (uses existing Postgres + Redis + BullMQ from SP-1)

---

## Spec Coverage Map

| Spec section | Tasks |
|---|---|
| §2.3 Customer UX (cart, checkout, guest, merge) | 5, 6, 7, 12, 14 |
| §5.4 Cart/order/payment schema | 1–4 |
| §5.5 Promotions, tax, shipping | 2, 3, 4 |
| §6.1 Storefront API (cart, coupon, checkout) | 12–17 |
| §6.3 Inbound payment webhooks | 18 |
| §6.4 Conventions (RFC 7807, cursor pagination, Idempotency-Key) | all API tasks |
| §16 INR + Razorpay default; Stripe optional | 9, 10 |

---

## Assumptions (locked unless overruled)

1. **Cart lifecycle:** every cart has a `session_id` (cookie value) and optional `customer_id`. Guest cart has session_id only; logged-in cart has both. Merge on login: server moves session cart's items into the customer's existing cart (additive), then deletes the session cart.
2. **Cart TTL:** carts auto-expire after 30 days of inactivity (sweeper job). Active reservations on expired carts are released. Cart deletion cascades to cart_items.
3. **Money:** integer cents (`*_cents` columns). All math in cents. Display formatting is a frontend concern.
4. **Pricing precedence:** subtotal = Σ(unit_price × qty); apply line-level promo modifiers; apply order-level promo; compute shipping; compute tax (inclusive default per spec §16); total = subtotal − discounts + shipping + tax (or subtotal + shipping with tax-inclusive). Final integer rounding via banker's rounding (HALF_EVEN) for tax lines.
5. **Coupon model:** one coupon code per cart. Stacking is out of scope. Auto-promotions (no code) layer underneath; coupon overrides if mutually exclusive (configurable per promotion).
6. **Tax mode:** spec §16 default is `inclusive` for India. `pricing.tax.mode = 'inclusive' | 'exclusive'` from site_config. Inclusive: variant.price_cents already contains tax; engine back-calculates the tax portion. Exclusive: tax is added on top.
7. **Shipping:** zones model from spec §5.5 (`shipping_zones.rates` JSON). Match cart's shipping address country/region against zone regions; pick first match. `free_over_cents` overrides if subtotal qualifies.
8. **Reservation strategy:** reservations are placed at `checkout/start`, not on add-to-cart. Add-to-cart is optimistic — uses `availability/inStock` to display "in stock" but does not hold. Reason: cart can sit idle for hours; holding stock that long degrades availability for active customers.
9. **Payment intent flow:** `checkout/start` → reserves inventory → creates provider intent (Razorpay Order or Stripe PaymentIntent) → returns `{ intentId, providerRef, clientSecret/orderId, totals }`. Client completes payment client-side. Webhook (Razorpay/Stripe → /api/v1/webhooks/payments/:provider) confirms — that's the source of truth. `/checkout/confirm` is an optional client-side success callback that the server treats as advisory; only the webhook commits.
10. **Idempotency-Key:** required on all checkout POST endpoints. Webhook handlers use the provider's event id as the natural idempotency key (stored in `payment_events`).
11. **Migration numbering:** SP-4 takes 0011, 0012, 0013, 0014 (schemas, RLS, triggers/indexes, orders skeleton). SP-5 picks up at 0015.
12. **Order shape minimal here:** SP-4 creates `orders` and `order_items` with just enough columns to record placed orders (number, customer ref, totals, status='pending_payment'|'paid'|'cancelled'). SP-5 adds `fulfillment_status`, fulfillment timelines, refunds, shipments. Backwards-compatibility: SP-4 columns are forward-only; SP-5 adds, doesn't change.
13. **Idempotency cache:** SP-1's `requireIdempotencyKey` middleware uses Redis with 24h TTL. Reused as-is.

---

## File Structure (SP-4 final state)

```
src/db/schema/
├── (existing) tenancy, identity, sessions, config, catalog, inventory, index
├── carts.ts                    ← carts, cart_items
├── promotions.ts               ← promotions, promotion_redemptions
├── tax.ts                      ← tax_rates
├── shipping.ts                 ← shipping_zones
├── payments.ts                 ← payment_intents, payments, payment_events (webhook log)
└── orders.ts                   ← orders, order_items (minimal — SP-5 extends)

src/db/migrations/
├── (existing 0000–0010)
├── 0011_cart_checkout.sql           ← drizzle-generated
├── 0012_cart_checkout_rls.sql       ← hand-written RLS
├── 0013_cart_indexes.sql            ← hand-written: partial indexes, cart cleanup helpers
└── 0014_orders_skeleton.sql         ← hand-written: order_number sequence, generated columns

src/modules/cart/
├── cart.ts                     ← createCart, getCart, addItem, updateItem, removeItem, applyCoupon, mergeOnLogin
├── pricing.ts                  ← PricingEngine.priceCart(cart): CartTotals
├── promotions.ts               ← listActivePromotions, evaluateCoupon, recordRedemption
├── tax.ts                      ← computeTax(line, address, mode)
└── shipping.ts                 ← computeShipping(cart, address)

src/modules/checkout/
├── checkout.ts                 ← startCheckout (reserve + intent), confirmCheckout (advisory), cancelCheckout
└── orders.ts                   ← createOrderFromCart, getOrderByNumber, listCustomerOrders

src/modules/payments/
├── provider.ts                 ← PaymentProvider interface + factory
├── razorpay.ts                 ← Razorpay adapter
├── stripe.ts                   ← Stripe adapter
└── webhooks.ts                 ← verifySignature, recordEvent, applyPaymentSucceeded, applyPaymentFailed

src/app/api/v1/cart/
├── route.ts                    ← POST create cart
├── [id]/route.ts               ← GET cart
├── [id]/items/route.ts         ← POST add item
├── [id]/items/[lineId]/route.ts ← PATCH update qty, DELETE remove
├── [id]/coupon/route.ts        ← POST apply, DELETE remove
└── [id]/merge/route.ts         ← POST merge guest cart on login

src/app/api/v1/checkout/
├── start/route.ts              ← POST start (reserve + payment intent)
└── confirm/route.ts            ← POST confirm (advisory; webhook is source of truth)

src/app/api/v1/orders/
└── [number]/route.ts           ← GET order detail (guest by email query, customer by session)

src/app/api/v1/webhooks/payments/
└── [provider]/route.ts         ← POST inbound from Razorpay / Stripe

src/app/api/v1/admin/promotions/
├── route.ts                    ← GET, POST
└── [id]/route.ts               ← PATCH, DELETE

src/app/api/v1/admin/tax-rates/
├── route.ts                    ← GET, POST
└── [id]/route.ts               ← PATCH, DELETE

src/app/api/v1/admin/shipping-zones/
├── route.ts                    ← GET, POST
└── [id]/route.ts               ← PATCH, DELETE

src/queue/jobs/
├── cart-ttl-sweep.ts           ← daily: expire idle carts and release reservations
└── payment-event-retry.ts      ← retry failed webhook applications

tests/
├── cart-basic.test.ts
├── cart-coupon.test.ts
├── cart-merge.test.ts
├── pricing-engine.test.ts
├── pricing-tax.test.ts
├── pricing-shipping.test.ts
├── promotions.test.ts
├── checkout-start.test.ts
├── checkout-webhook-razorpay.test.ts
├── checkout-webhook-stripe.test.ts
├── checkout-idempotency.test.ts
├── orders.test.ts
└── cart-rls.test.ts
```

---

## Tasks

### Task 1 — Carts + cart_items schema

**File:** `src/db/schema/carts.ts`

```ts
import { pgTable, uuid, text, integer, timestamp, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { stores } from './tenancy';
import { productVariants } from './catalog';

export const carts = pgTable('carts', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  customerId: uuid('customer_id'),   // FK to customers table (SP-5 creates a richer customers; for now nullable, will hook in SP-5)
  sessionId: text('session_id').notNull(),
  currency: text('currency').notNull().default('INR'),
  couponCode: text('coupon_code'),
  shippingAddress: jsonb('shipping_address').$type<Address>(),
  billingAddress: jsonb('billing_address').$type<Address>(),
  note: text('note'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  sessionIdx: index('carts_session_idx').on(t.storeId, t.sessionId),
  customerIdx: index('carts_customer_idx').on(t.storeId, t.customerId),
}));

export const cartItems = pgTable('cart_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  cartId: uuid('cart_id').notNull().references(() => carts.id, { onDelete: 'cascade' }),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  variantId: uuid('variant_id').notNull().references(() => productVariants.id, { onDelete: 'restrict' }),
  qty: integer('qty').notNull(),
  unitPriceCents: integer('unit_price_cents').notNull(),  // snapshot at add time
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  cartVariantUq: uniqueIndex('cart_items_cart_variant_uq').on(t.cartId, t.variantId),
}));

export type Address = {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postal: string;
  country: string;
  phone?: string;
};
```

**Acceptance:** schema compiles; one cart per session via unique partial idx (added in 0013 with `WHERE customer_id IS NULL`); item qty constraint added in 0013 (`CHECK qty > 0`).

---

### Task 2 — Promotions schema

**File:** `src/db/schema/promotions.ts`

```ts
export const promotionType = pgEnum('promotion_type', ['percent', 'amount', 'free_shipping', 'bxgy']);
export const promotionStatus = pgEnum('promotion_status', ['draft', 'active', 'paused', 'archived']);

export const promotions = pgTable('promotions', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  code: text('code'),  // null = auto-promotion (no code required)
  name: text('name').notNull(),
  type: promotionType('type').notNull(),
  status: promotionStatus('status').notNull().default('draft'),
  valueCents: integer('value_cents'),   // for type='amount'
  percent: integer('percent'),          // for type='percent', 0-100
  conditions: jsonb('conditions').$type<PromotionConditions>().notNull().default({}),
  startsAt: timestamp('starts_at', { withTimezone: true }),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  usageLimit: integer('usage_limit'),         // global cap
  perCustomerLimit: integer('per_customer_limit'),
  usedCount: integer('used_count').notNull().default(0),
  stackable: boolean('stackable').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  codeUnique: uniqueIndex('promotions_store_code_uq').on(t.storeId, t.code),
}));

export const promotionRedemptions = pgTable('promotion_redemptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  promotionId: uuid('promotion_id').notNull().references(() => promotions.id, { onDelete: 'restrict' }),
  cartId: uuid('cart_id'),
  orderId: uuid('order_id'),
  customerId: uuid('customer_id'),
  amountCents: integer('amount_cents').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PromotionConditions = {
  minSubtotalCents?: number;
  variantIds?: string[];        // applies only to these variants
  categoryIds?: string[];
  bxgyBuy?: number;             // buy N
  bxgyGet?: number;             // get M free
  customerSegments?: string[];  // not used in SP-4; reserved
};
```

---

### Task 3 — Tax + shipping schemas

**File:** `src/db/schema/tax.ts`

```ts
export const taxRates = pgTable('tax_rates', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  regionCode: text('region_code').notNull(),    // 'IN', 'IN-MH', etc.
  rate: numeric('rate', { precision: 6, scale: 4 }).notNull(),  // 0.18 for 18%
  label: text('label').notNull(),                // 'GST 18%'
  inclusive: boolean('inclusive').notNull().default(true),
  taxClass: text('tax_class').notNull().default('default'),  // matches products.tax_class
}, t => ({
  regionClassUnique: uniqueIndex('tax_rates_store_region_class_uq').on(t.storeId, t.regionCode, t.taxClass),
}));
```

**File:** `src/db/schema/shipping.ts`

```ts
export const shippingZones = pgTable('shipping_zones', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  name: text('name').notNull(),
  regions: jsonb('regions').$type<RegionMatcher[]>().notNull(),
  // rates: array of { code, label, rate_cents, min_order_cents?, max_order_cents?, free_over_cents? }
  rates: jsonb('rates').$type<ShippingRate[]>().notNull(),
  freeOverCents: integer('free_over_cents'),     // zone-level free shipping threshold
  isDefault: boolean('is_default').notNull().default(false),  // fallback zone if no region matches
}, t => ({
  codeUnique: uniqueIndex('shipping_zones_store_code_uq').on(t.storeId, t.code),
}));

export type RegionMatcher = { country: string; regions?: string[]; postalPrefixes?: string[] };
export type ShippingRate = {
  code: string;          // 'standard', 'express'
  label: string;
  rateCents: number;
  minOrderCents?: number;
  maxOrderCents?: number;
  freeOverCents?: number;
};
```

---

### Task 4 — Payments + orders schemas

**File:** `src/db/schema/payments.ts`

```ts
export const paymentProvider = pgEnum('payment_provider', ['razorpay', 'stripe', 'manual']);
export const paymentStatus = pgEnum('payment_status', ['pending', 'succeeded', 'failed', 'refunded', 'partially_refunded']);
export const intentStatus = pgEnum('intent_status', ['pending', 'attached', 'succeeded', 'failed', 'cancelled']);

export const paymentIntents = pgTable('payment_intents', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  cartId: uuid('cart_id').notNull().references(() => carts.id, { onDelete: 'restrict' }),
  provider: paymentProvider('provider').notNull(),
  providerRef: text('provider_ref'),     // razorpay_order_id / stripe_payment_intent_id
  clientSecret: text('client_secret'),   // stripe-specific
  amountCents: integer('amount_cents').notNull(),
  currency: text('currency').notNull(),
  status: intentStatus('status').notNull().default('pending'),
  reservationIds: jsonb('reservation_ids').$type<string[]>().notNull().default([]),
  raw: jsonb('raw').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  providerRefIdx: index('intents_provider_ref_idx').on(t.provider, t.providerRef),
}));

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  orderId: uuid('order_id'),  // FK added in 0014 after orders table
  intentId: uuid('intent_id').references(() => paymentIntents.id, { onDelete: 'set null' }),
  provider: paymentProvider('provider').notNull(),
  providerRef: text('provider_ref'),
  amountCents: integer('amount_cents').notNull(),
  status: paymentStatus('status').notNull(),
  method: text('method'),
  raw: jsonb('raw').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const paymentEvents = pgTable('payment_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  provider: paymentProvider('provider').notNull(),
  providerEventId: text('provider_event_id').notNull(),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  processed: boolean('processed').notNull().default(false),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  providerEventUq: uniqueIndex('payment_events_provider_event_uq').on(t.provider, t.providerEventId),
}));
```

**File:** `src/db/schema/orders.ts`

```ts
export const orderStatus = pgEnum('order_status', ['pending_payment', 'paid', 'cancelled', 'fulfilled', 'refunded']);
export const orderPaymentStatus = pgEnum('order_payment_status', ['pending', 'paid', 'failed', 'refunded']);

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  number: text('number').notNull(),                // generated by sequence
  customerId: uuid('customer_id'),
  email: text('email').notNull(),
  status: orderStatus('status').notNull().default('pending_payment'),
  paymentStatus: orderPaymentStatus('payment_status').notNull().default('pending'),
  // fulfillment_status added in SP-5
  billingAddress: jsonb('billing_address').$type<Address>(),
  shippingAddress: jsonb('shipping_address').$type<Address>(),
  currency: text('currency').notNull(),
  subtotalCents: integer('subtotal_cents').notNull(),
  discountCents: integer('discount_cents').notNull().default(0),
  taxCents: integer('tax_cents').notNull().default(0),
  shippingCents: integer('shipping_cents').notNull().default(0),
  totalCents: integer('total_cents').notNull(),
  couponCode: text('coupon_code'),
  note: text('note'),
  placedAt: timestamp('placed_at', { withTimezone: true }).notNull().defaultNow(),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
}, t => ({
  numberUnique: uniqueIndex('orders_store_number_uq').on(t.storeId, t.number),
  customerIdx: index('orders_customer_idx').on(t.storeId, t.customerId, t.placedAt.desc()),
}));

export const orderItems = pgTable('order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  variantId: uuid('variant_id').notNull().references(() => productVariants.id, { onDelete: 'restrict' }),
  sku: text('sku').notNull(),
  name: text('name').notNull(),
  qty: integer('qty').notNull(),
  unitPriceCents: integer('unit_price_cents').notNull(),
  lineTotalCents: integer('line_total_cents').notNull(),
  taxCents: integer('tax_cents').notNull().default(0),
  attributes: jsonb('attributes').$type<Record<string, unknown>>(),
});
```

Re-export all in `index.ts`.

---

### Task 5 — Migration 0011 (drizzle-generated)

Run `pnpm db:generate -- --name cart_checkout`. Review the output to ensure all 11 tables emit cleanly. Verify no cross-schema issues (FK to product_variants from cart_items/order_items, etc.).

---

### Task 6 — Migration 0012 RLS

**File:** `src/db/migrations/0012_cart_checkout_rls.sql`

For every store_id-bearing table (carts, cart_items, promotions, promotion_redemptions, tax_rates, shipping_zones, payment_intents, payments, payment_events, orders, order_items): ENABLE RLS + tenant_isolation policy using the `NULLIF(current_setting('app.store_id', true), '')::uuid` pattern from SP-1's 0004.

Plus GRANTs to app_user role on all new tables.

Plus enforcement triggers: `cart_items.store_id` must match parent `carts.store_id`; `order_items.store_id` must match parent `orders.store_id` — analogous to SP-2's `variant_store_id_check`.

---

### Task 7 — Migration 0013 indexes + constraints

**File:** `src/db/migrations/0013_cart_indexes.sql`

```sql
-- Guest carts: one cart per (store_id, session_id) when customer is null
CREATE UNIQUE INDEX carts_guest_session_uq ON carts(store_id, session_id) WHERE customer_id IS NULL;
-- Customer carts: one per (store_id, customer_id) when customer is set
CREATE UNIQUE INDEX carts_customer_uq ON carts(store_id, customer_id) WHERE customer_id IS NOT NULL;
-- Cart item qty must be positive
ALTER TABLE cart_items ADD CONSTRAINT cart_items_qty_positive CHECK (qty > 0);
-- Idle cart sweep helper
CREATE INDEX carts_expires_idx ON carts(expires_at) WHERE expires_at IS NOT NULL;
```

---

### Task 8 — Migration 0014 orders skeleton

**File:** `src/db/migrations/0014_orders_skeleton.sql`

```sql
-- Per-store order number sequence
CREATE SEQUENCE orders_global_seq START 100000;

-- Convenience function to mint a number
CREATE OR REPLACE FUNCTION mint_order_number(store_slug text) RETURNS text AS $$
DECLARE n bigint;
BEGIN
  n := nextval('orders_global_seq');
  RETURN upper(store_slug) || '-' || lpad(n::text, 8, '0');
END;
$$ LANGUAGE plpgsql;

-- Cross-table FK: payments.order_id -> orders.id (was nullable in 0011 because orders came later)
ALTER TABLE payments
  ADD CONSTRAINT payments_order_id_fk FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
```

Update `meta/_journal.json` with entries 11–14.

---

### Task 9 — Pricing engine

**File:** `src/modules/cart/pricing.ts`

```ts
export type CartTotals = {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  shippingCents: number;
  totalCents: number;
  lines: PricedLine[];
  appliedPromotions: AppliedPromotion[];
  shippingOption?: { code: string; label: string };
};

export type PricedLine = {
  itemId: string;
  variantId: string;
  qty: number;
  unitPriceCents: number;
  lineSubtotalCents: number;
  lineDiscountCents: number;
  lineTaxCents: number;
  lineTotalCents: number;
};

export async function priceCart(
  storeId: string,
  cartId: string,
  opts?: { shippingAddress?: Address; shippingRateCode?: string },
): Promise<CartTotals> {
  return withTenant(storeId, async tx => {
    const cart = await getCartWithItems(tx, cartId);
    const cfg = await loadSiteConfig(storeId);
    const taxMode = cfg.tax?.mode ?? 'inclusive';
    const currency = cart.currency;

    // 1. Line subtotals from current variant prices (re-price to avoid stale snapshots)
    const lines = await pricedLines(tx, cart.items, taxMode);

    // 2. Apply promotions
    const promos = await evaluatePromotions(tx, storeId, cart, lines);

    // 3. Compute shipping
    const shipping = await computeShipping(tx, storeId, cart, opts?.shippingAddress, opts?.shippingRateCode);

    // 4. Compute tax (already baked into lines if inclusive; otherwise add)
    // 5. Roll up
    const subtotal = sum(lines.map(l => l.lineSubtotalCents));
    const discount = sum(promos.map(p => p.amountCents));
    const tax = sum(lines.map(l => l.lineTaxCents));
    const total = taxMode === 'inclusive'
      ? subtotal - discount + shipping.cents      // tax already in subtotal
      : subtotal - discount + shipping.cents + tax;

    return { subtotalCents: subtotal, discountCents: discount, taxCents: tax, shippingCents: shipping.cents, totalCents: total, lines, appliedPromotions: promos, shippingOption: shipping.option };
  });
}
```

**Acceptance:** `tests/pricing-engine.test.ts` — inclusive cart with one variant @ 11800 (10000 + 18% GST baked), tax line shows 1800, total = 11800; exclusive cart same line → subtotal 11800, tax 2124, total 13924.

---

### Task 10 — Tax + shipping helpers

**File:** `src/modules/cart/tax.ts`

```ts
export function computeLineTax(
  unitPriceCents: number,
  qty: number,
  rate: number,                 // 0.18
  mode: 'inclusive' | 'exclusive',
): { lineSubtotalCents: number; lineTaxCents: number } {
  const gross = unitPriceCents * qty;
  if (mode === 'inclusive') {
    const tax = Math.round(gross * rate / (1 + rate));  // back-calc
    return { lineSubtotalCents: gross, lineTaxCents: tax };
  }
  const tax = Math.round(gross * rate);
  return { lineSubtotalCents: gross, lineTaxCents: tax };
}

export async function resolveTaxRate(tx: Tx, storeId: string, address: Address | undefined, taxClass: string): Promise<{ rate: number; mode: 'inclusive' | 'exclusive'; label: string }> {
  // Try exact regionCode = country + region; then country; then default.
  // Fall back to site_config.tax.default_rate.
}
```

**File:** `src/modules/cart/shipping.ts`

```ts
export async function computeShipping(
  tx: Tx, storeId: string, cart: CartWithItems,
  address?: Address, rateCode?: string,
): Promise<{ cents: number; option?: { code: string; label: string } }> {
  if (!address) return { cents: 0 };
  const zones = await tx.select().from(shippingZones).where(eq(shippingZones.storeId, storeId));
  const zone = zones.find(z => matchesRegion(z.regions, address)) ?? zones.find(z => z.isDefault);
  if (!zone) return { cents: 0 };
  const rate = pickRate(zone.rates, rateCode, sumCartCents(cart));
  if (!rate) return { cents: 0 };
  const subtotal = sumCartCents(cart);
  if (rate.freeOverCents && subtotal >= rate.freeOverCents) return { cents: 0, option: { code: rate.code, label: rate.label } };
  if (zone.freeOverCents && subtotal >= zone.freeOverCents) return { cents: 0, option: { code: rate.code, label: rate.label } };
  return { cents: rate.rateCents, option: { code: rate.code, label: rate.label } };
}
```

---

### Task 11 — Promotions engine

**File:** `src/modules/cart/promotions.ts`

```ts
export async function evaluateCoupon(
  tx: Tx, storeId: string, code: string,
): Promise<{ ok: true; promotion: Promotion } | { ok: false; reason: 'not_found' | 'expired' | 'usage_exhausted' | 'starts_in_future' }> { … }

export async function applyPromotions(
  tx: Tx, storeId: string, cart: CartWithItems, lines: PricedLine[],
): Promise<AppliedPromotion[]> {
  // 1. Load auto-promotions (code IS NULL, status='active', within window, conditions match)
  // 2. Load cart's coupon (if any) and validate
  // 3. Apply in deterministic order (largest discount first)
  // 4. Respect stackable flag — non-stackable replaces auto
  // 5. Return AppliedPromotion[] with computed amountCents (capped at line subtotals)
}

export async function recordRedemption(tx: Tx, storeId: string, applied: AppliedPromotion, ref: { cartId?: string; orderId?: string; customerId?: string }): Promise<void> { … }
```

---

### Task 12 — Cart module

**File:** `src/modules/cart/cart.ts`

```ts
export async function createCart(storeId: string, input: { sessionId: string; customerId?: string; currency?: string }): Promise<Cart> { … }
export async function getCart(storeId: string, cartId: string): Promise<CartWithItems | null> { … }
export async function addItem(storeId: string, cartId: string, input: { variantId: string; qty: number }): Promise<CartWithItems> { … }
export async function updateItem(storeId: string, cartId: string, itemId: string, patch: { qty: number }): Promise<CartWithItems> { … }
export async function removeItem(storeId: string, cartId: string, itemId: string): Promise<CartWithItems> { … }
export async function applyCoupon(storeId: string, cartId: string, code: string): Promise<CartWithItems> { … }
export async function removeCoupon(storeId: string, cartId: string): Promise<CartWithItems> { … }
export async function setAddresses(storeId: string, cartId: string, input: { shippingAddress?: Address; billingAddress?: Address }): Promise<CartWithItems> { … }
export async function mergeOnLogin(storeId: string, sessionId: string, customerId: string): Promise<Cart> {
  // 1. find guest cart by sessionId
  // 2. find or create customer cart
  // 3. merge items (sum qtys for same variant)
  // 4. delete guest cart
}
```

Typed errors: `CartNotFoundError`, `VariantNotAvailableError` (status='archived'), `InvalidCouponError`, `CouponExpiredError`, `CouponUsageExhaustedError`.

---

### Task 13 — Storefront cart API

Routes under `src/app/api/v1/cart/`:
- `route.ts` POST — create cart. Body: `{ customerId? }`. Uses session cookie's value as `sessionId`. Returns `{ data: { cart, totals } }`.
- `[id]/route.ts` GET — getCart + priceCart. Returns `{ data: { cart, totals } }`.
- `[id]/items/route.ts` POST — addItem.
- `[id]/items/[lineId]/route.ts` PATCH (qty), DELETE.
- `[id]/coupon/route.ts` POST `{ code }`, DELETE.
- `[id]/merge/route.ts` POST — requires session; merges guest cart into customer cart.

Pipeline:
- resolveTenant (404 if missing)
- Session cookie required (any session, including anonymous storefront session)
- All mutations: Idempotency-Key required
- All mutations: CSRF token verified (storefront cookie session has CSRF per SP-1)
- Errors via problem()

---

### Task 14 — PaymentProvider abstraction

**File:** `src/modules/payments/provider.ts`

```ts
export interface PaymentProvider {
  readonly name: 'razorpay' | 'stripe';
  createIntent(input: { amountCents: number; currency: string; cartId: string; metadata?: Record<string, string> }): Promise<{ providerRef: string; clientSecret?: string; raw: Record<string, unknown> }>;
  verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean;
  parseEvent(payload: Record<string, unknown>): { type: 'payment_succeeded' | 'payment_failed' | 'refund_succeeded' | 'other'; providerEventId: string; providerRef: string; amountCents?: number; raw: Record<string, unknown> };
  cancelIntent(providerRef: string): Promise<void>;
}

export function getPaymentProvider(name: 'razorpay' | 'stripe'): PaymentProvider {
  if (name === 'razorpay') return new RazorpayProvider();
  if (name === 'stripe') return new StripeProvider();
  throw new Error(`Unknown provider: ${name}`);
}
```

**Files:** `razorpay.ts`, `stripe.ts` — implement the interface. Read keys from env (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`). Construct SDK clients lazily. Webhook verification uses `crypto.timingSafeEqual`.

---

### Task 15 — Checkout module

**File:** `src/modules/checkout/checkout.ts`

```ts
export async function startCheckout(
  storeId: string,
  input: { cartId: string; provider: 'razorpay' | 'stripe' },
): Promise<{ intentId: string; providerRef: string; clientSecret?: string; totals: CartTotals }> {
  return withTenant(storeId, async tx => {
    const cart = await getCartForCheckout(tx, input.cartId);
    if (!cart.shippingAddress) throw new MissingShippingAddressError();
    if (cart.items.length === 0) throw new EmptyCartError();

    // 1. Re-price (do not trust client totals)
    const totals = await priceCart(storeId, input.cartId, { shippingAddress: cart.shippingAddress });

    // 2. Reserve inventory (per spec §2.2 — TTL 15 min) — choose default location for now
    const defaultLocationId = await getDefaultLocationId(tx, storeId);
    const reserveItems = cart.items.map(it => ({ variantId: it.variantId, locationId: defaultLocationId, qty: it.qty }));
    const { reservationIds, expiresAt } = await reserve(storeId, { cartId: input.cartId, items: reserveItems });

    // 3. Create payment intent
    const provider = getPaymentProvider(input.provider);
    const intent = await provider.createIntent({ amountCents: totals.totalCents, currency: cart.currency, cartId: input.cartId, metadata: { storeId } });

    // 4. Persist payment_intents row
    const [row] = await tx.insert(paymentIntents).values({
      storeId, cartId: input.cartId, provider: input.provider,
      providerRef: intent.providerRef, clientSecret: intent.clientSecret,
      amountCents: totals.totalCents, currency: cart.currency,
      status: 'attached', reservationIds, raw: intent.raw,
    }).returning({ id: paymentIntents.id });

    return { intentId: row!.id, providerRef: intent.providerRef, clientSecret: intent.clientSecret, totals };
  });
}

export async function confirmCheckoutAdvisory(storeId: string, intentId: string): Promise<{ orderNumber: string | null }> {
  // Look up the intent; if status='succeeded' (webhook already arrived), return the order number.
  // Otherwise return null and let the client poll.
}

export async function cancelCheckout(storeId: string, intentId: string): Promise<void> {
  // release reservations, mark intent cancelled, attempt provider.cancelIntent (best-effort)
}
```

**File:** `src/modules/checkout/orders.ts`

```ts
export async function createOrderFromCart(
  tx: Tx, storeId: string, cartId: string, intent: PaymentIntent, paymentRef: { providerRef: string; amountCents: number },
): Promise<Order> {
  // 1. Re-price (idempotent — totals must match intent.amountCents within ±1 cent rounding)
  // 2. Mint order number via mint_order_number(store.slug)
  // 3. INSERT order; INSERT order_items from cart_items (snapshot sku/name/attributes from variants/products)
  // 4. INSERT payment row with status='succeeded'
  // 5. commit reservations to orderId via SP-3's commit()
  // 6. Record promotion redemptions
  // 7. Delete cart (cascade items)
  // 8. Return order
}
```

---

### Task 16 — Storefront checkout API

- `src/app/api/v1/checkout/start/route.ts` POST. Body: `{ cartId, provider }`. Idempotency-Key required.
- `src/app/api/v1/checkout/confirm/route.ts` POST. Body: `{ intentId }`. Returns `{ orderNumber }` if webhook arrived, else 202 with `{ pending: true }`.

---

### Task 17 — Orders read API

- `src/app/api/v1/orders/[number]/route.ts` GET. Logged-in customer: must own the order. Guest: requires `?email=` matching `orders.email`. Returns order + items.
- `src/app/api/v1/customer/orders/route.ts` GET. Logged-in customer's order list, paginated.

---

### Task 18 — Webhook handler

**File:** `src/app/api/v1/webhooks/payments/[provider]/route.ts`

```ts
export async function POST(req: Request, { params }: { params: { provider: string } }) {
  const provider = getPaymentProvider(params.provider as 'razorpay' | 'stripe');
  const rawBody = await req.text();
  const sig = req.headers.get(provider.name === 'razorpay' ? 'x-razorpay-signature' : 'stripe-signature') ?? '';
  if (!provider.verifyWebhookSignature(rawBody, sig)) {
    return problem(401, 'Invalid signature');
  }
  const payload = JSON.parse(rawBody);
  const event = provider.parseEvent(payload);

  // Idempotency: payment_events row with provider_event_id as natural key
  return withMigratorDb(async tx => {
    // INSERT ON CONFLICT DO NOTHING returning row — if already processed, return 200 OK
    const [recorded] = await tx.insert(paymentEvents).values({
      storeId: extractStoreId(payload),  // tenant must be derivable from payload metadata or providerRef lookup
      provider: provider.name,
      providerEventId: event.providerEventId,
      eventType: event.type,
      payload,
    }).onConflictDoNothing({ target: [paymentEvents.provider, paymentEvents.providerEventId] }).returning();

    if (!recorded) return new Response('OK (duplicate)', { status: 200 });

    try {
      await applyPaymentEvent(tx, recorded);
      await tx.update(paymentEvents).set({ processed: true, processedAt: new Date() }).where(eq(paymentEvents.id, recorded.id));
    } catch (err) {
      await tx.update(paymentEvents).set({ error: String(err) }).where(eq(paymentEvents.id, recorded.id));
      // Enqueue retry job
      await retryQueue.add('payment-event', { id: recorded.id }, { attempts: 5, backoff: 'exponential' });
      return new Response('Queued for retry', { status: 200 });
    }
    return new Response('OK', { status: 200 });
  });
}
```

The webhook uses `migratorDb` (BYPASSRLS) deliberately — it needs to write across stores without a tenant context. The storeId is recovered from the intent lookup via providerRef.

Inside `applyPaymentEvent`:
- For `payment_succeeded`: load intent by providerRef → set status='succeeded' → call createOrderFromCart inside withTenant(intent.storeId, …) → commit reservations → create order.
- For `payment_failed`: load intent → set status='failed' → release reservations.

---

### Task 19 — Admin promotion/tax/shipping CRUD

Standard admin pipeline (auth + RBAC + CSRF + Idempotency-Key + zod):
- `src/app/api/v1/admin/promotions/{route.ts, [id]/route.ts}` — list/create/update/delete.
- `src/app/api/v1/admin/tax-rates/{route.ts, [id]/route.ts}` — same shape.
- `src/app/api/v1/admin/shipping-zones/{route.ts, [id]/route.ts}` — same.

RBAC permission: `promotions:*`, `tax:*`, `shipping:*` (or `*`).

---

### Task 20 — Cart TTL sweep job

**File:** `src/queue/jobs/cart-ttl-sweep.ts`

Daily job (registered in scheduler) that deletes carts with `expires_at < now()`. Releases any active reservations on those carts.

Update `src/entrypoints/scheduler.ts` and `worker.ts` to register the new job.

---

### Task 21–28 — Tests

- `cart-basic.test.ts` — create cart, add/update/remove items, price snapshot vs current variant price
- `cart-coupon.test.ts` — apply valid coupon, expired coupon, usage-exhausted, invalid code
- `cart-merge.test.ts` — guest adds items, logs in, merge sums qtys for same variant
- `pricing-engine.test.ts` — inclusive vs exclusive tax math; subtotal/discount/tax/shipping/total math
- `pricing-tax.test.ts` — region-specific tax rate lookup; default fallback
- `pricing-shipping.test.ts` — zone region match; free_over_cents threshold; default zone fallback
- `promotions.test.ts` — percent, amount, free shipping, bxgy; stackable vs non-stackable
- `checkout-start.test.ts` — reserves inventory, creates payment intent (mock provider in test), totals match cart
- `checkout-webhook-razorpay.test.ts` — sign a payload with the test secret, POST to webhook endpoint, assert intent → succeeded, order created, reservation committed
- `checkout-webhook-stripe.test.ts` — same for Stripe
- `checkout-idempotency.test.ts` — same Idempotency-Key on checkout/start returns same intent
- `orders.test.ts` — guest lookup by email, customer order list pagination
- `cart-rls.test.ts` — store A cannot see store B's carts

For provider mocking: use the actual SDKs but point at the providers' test endpoints (Razorpay test keys, Stripe test secret) OR inject a fake `PaymentProvider` for the test via a module-level setter. Recommended: fake providers — keeps tests offline and fast.

---

## Parallel Stream Groupings

### Stream A — Schemas + migrations (foundation)
- Tasks 1–8
- Sequential within: schema → 0011 → 0012 → 0013 → 0014

### Stream B — Pricing + cart modules (after A)
- Tasks 9, 10, 11, 12
- Files: `src/modules/cart/*`

### Stream C — Payment provider abstraction (after A, parallel to B)
- Task 14
- Files: `src/modules/payments/*`

### Stream D — Checkout module (after B + C)
- Task 15
- Files: `src/modules/checkout/*`

### Stream E — Storefront cart + checkout API (after B + D)
- Tasks 13, 16, 17
- Files: `src/app/api/v1/cart/**`, `src/app/api/v1/checkout/**`, `src/app/api/v1/orders/**`

### Stream F — Webhook handler (after C + D)
- Task 18
- Files: `src/app/api/v1/webhooks/payments/**`

### Stream G — Admin promotion/tax/shipping APIs (after A)
- Task 19
- Files: `src/app/api/v1/admin/{promotions,tax-rates,shipping-zones}/**`

### Stream H — Queue jobs (after A, parallel to anything)
- Task 20
- Files: `src/queue/jobs/cart-ttl-sweep.ts`, scheduler/worker extensions

### Stream I — Tests (after all above)
- Tasks 21–28
- Files: `tests/cart-*.test.ts`, `tests/pricing-*.test.ts`, `tests/checkout-*.test.ts`, `tests/orders.test.ts`, `tests/promotions.test.ts`

### Dispatch order
1. Stream A solo.
2. Streams B + C + G + H launched together (4 agents).
3. Stream D solo (depends on B + C).
4. Streams E + F launched together.
5. Stream I as final fan-in.

---

## Verification Plan

```
pnpm install                # razorpay + stripe added
pnpm db:up
pnpm db:migrate             # applies 0011-0014
pnpm db:seed                # extends with sample promo/tax/shipping
pnpm typecheck
pnpm test
pnpm worker &
pnpm scheduler &
pnpm dev
# Manual flow:
curl -X POST http://localhost:3000/api/v1/cart -H "Cookie: sid=..." -H "Idempotency-Key: $(uuidgen)"
# Add item, set address, /checkout/start with provider=razorpay
# Trigger test webhook (Razorpay CLI or local POST with valid sig)
# /orders/<number>?email=... returns the order
```

---

## Risks & Open Questions

1. **Customer table provenance:** SP-4 references `customerId` but the full customers table is documented in spec §5.1 and partially overlaps with users. For SP-4 the field is nullable; SP-5 (or a customers-specific task) finalizes the table.
2. **Multi-location reservation:** SP-4 uses a single default location for reservation. Real multi-location routing (closest warehouse to address, split shipments) is deferred.
3. **Refund flow:** out of scope. SP-5 owns refunds via `refunds` table + provider.refundPayment().
4. **Idempotency-Key vs Razorpay's `receipt`:** Razorpay's `receipt` field is per-Order. Reuse our Idempotency-Key as `receipt` to avoid duplicate intents.
5. **Webhook ordering:** Razorpay/Stripe can deliver events out of order. We handle by examining current intent.status before applying — never downgrade succeeded → pending.
6. **Tax rounding:** banker's rounding for tax requires care. Use `Math.round` for cents (away-from-zero) per common practice; document the deviation if regulators demand banker's.
7. **Coupon stacking:** v1 enforces one coupon code. Future stacking model would need a `promotion_stacking_rules` table.
8. **Cart cookie scope:** cart cookie name `cart_sid`, http-only, SameSite=Lax. Lifetime 30 days, refreshed on every cart mutation.
