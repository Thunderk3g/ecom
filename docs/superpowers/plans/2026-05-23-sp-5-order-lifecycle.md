# SP-5: Order Lifecycle — Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement task-by-task.

**Goal:** Extend SP-4's minimal `orders` schema with fulfillment, shipments, refunds, customer accounts, address book, outbound webhooks, and event-sourced order timeline. Wire BullMQ jobs for refund processing and outbound webhook delivery with retries.

**Architecture:** Orders move through a state machine (`pending_payment → paid → fulfilled → completed | refunded | cancelled`). Each transition is recorded in `order_events` as an append-only audit log. Refunds go through the payment provider (Razorpay/Stripe abstraction from SP-4). Outbound webhooks let partner stores subscribe to `order.placed`, `order.paid`, `order.fulfilled`, `order.cancelled`, `order.refunded` topics — delivery via BullMQ with exponential backoff and a dead-letter view.

---

## Spec Coverage Map

| Spec section | Tasks |
|---|---|
| §5.1 customers + addresses | 1, 2 |
| §5.4 orders extension (fulfillment, shipments, refunds, payments) | 3, 4, 5 |
| §5.7 audit_log, outbox_events, webhooks, webhook_deliveries | 6, 7 |
| §6.1 customer/me, customer/orders | 16 |
| §6.2 admin orders, fulfill, refund | 13, 14, 15 |
| §6.3 outbound webhook delivery | 17 |
| §7 Queues: webhook.dispatch | 18 |

---

## Assumptions (locked unless overruled)

1. **Customers vs users:** `users` (SP-1) is shared identity (admin or customer). `customers` is store-scoped denormalization carrying per-store info (phone, default address, segment, lifetime value placeholders).
2. **Order state machine:** transitions enforced in a single `transitionOrder(orderId, to)` helper; invalid transitions raise `InvalidOrderTransitionError`.
3. **Multi-shipment orders:** an order can have N shipments; each shipment_items row links to order_items with partial qty support.
4. **Refund granularity:** refund can be partial (per-line qty) or full. Refund creation enqueues a provider refund call; webhook confirms.
5. **Outbox pattern for webhooks:** `outbox_events` written in-transaction with order mutations. A worker drains the outbox and POSTs to subscribed webhook URLs with HMAC signature.
6. **Webhook signature:** HMAC-SHA256 of body + timestamp; header `X-Inkwell-Signature: t=<ts>,v1=<hex>`. Mirrors Stripe's scheme.
7. **Webhook retry policy:** 5 attempts, exponential backoff (1s, 4s, 16s, 64s, 256s). After 5 failures: status='dead', visible in admin.
8. **Address book:** customers can save N addresses; default flag flips atomically.
9. **Migration numbering:** SP-5 takes 0015–0018.

---

## File Structure (SP-5 additions)

```
src/db/schema/
├── customers.ts                ← customers, addresses
├── fulfillment.ts              ← shipments, shipment_items, fulfillments, fulfillment_items
├── refunds.ts                  ← refunds, refund_items
├── audit.ts                    ← order_events (append-only timeline), audit_log
└── webhooks.ts                 ← webhooks, webhook_deliveries, outbox_events

src/db/migrations/
├── 0015_orders_extension.sql     ← drizzle-generated: customers, addresses, order_events,
│                                    add columns to orders (fulfillment_status, customer_id FK)
├── 0016_fulfillment_refunds.sql  ← drizzle-generated: shipments, fulfillments, refunds
├── 0017_webhooks.sql             ← drizzle-generated: webhooks, deliveries, outbox
└── 0018_lifecycle_rls.sql        ← hand-written RLS + state-machine constraints

src/modules/orders/
├── lifecycle.ts                ← transitionOrder, getOrder, listOrders
├── fulfillment.ts              ← createFulfillment, markShipped, markDelivered
├── refund.ts                   ← createRefund, applyRefundSucceeded (called by webhook handler)
└── events.ts                   ← appendOrderEvent, getOrderTimeline

src/modules/customers/
├── customers.ts                ← upsertCustomer, getCustomer, updateCustomer
└── addresses.ts                ← listAddresses, createAddress, updateAddress, deleteAddress, setDefault

src/modules/webhooks/
├── outbox.ts                   ← writeOutboxEvent
├── dispatch.ts                 ← dispatchOutboxBatch (worker handler), deliverOne
└── signature.ts                ← signPayload, verifySignature

src/app/api/v1/admin/orders/
├── route.ts                    ← GET list, paginated, filterable
├── [id]/route.ts               ← GET detail
├── [id]/fulfill/route.ts       ← POST (create fulfillment + shipment)
├── [id]/refund/route.ts        ← POST (create refund — partial or full)
├── [id]/cancel/route.ts        ← POST cancel
└── [id]/events/route.ts        ← GET timeline

src/app/api/v1/admin/customers/
├── route.ts                    ← GET list, POST
└── [id]/route.ts               ← GET, PATCH

src/app/api/v1/admin/webhooks/
├── route.ts                    ← GET, POST
├── [id]/route.ts               ← PATCH, DELETE
└── [id]/deliveries/route.ts    ← GET (paginated, includes dead)

src/app/api/v1/customer/
├── me/route.ts                 ← GET (logged-in customer)
├── orders/route.ts             ← GET (paginated)
├── orders/[number]/route.ts    ← GET detail
└── addresses/                  ← CRUD on saved addresses

src/queue/jobs/
├── webhook-dispatch.ts         ← drain outbox, deliver, schedule retries
├── refund-poll.ts              ← optional: poll provider for refund status if no webhook
└── orders-stale-payment-sweep.ts ← cancel pending_payment orders idle > 30 min

tests/
├── orders-lifecycle.test.ts
├── orders-state-machine.test.ts
├── fulfillment.test.ts
├── refunds.test.ts
├── customers.test.ts
├── addresses.test.ts
├── webhook-dispatch.test.ts
├── webhook-signature.test.ts
└── orders-rls.test.ts
```

---

## Tasks (high-level — full code in implementation)

### Tasks 1–2 — Customers + addresses schemas

`customers` (store_id, user_id nullable, email, phone, locale, segment, accepts_marketing bool, default_billing_address_id, default_shipping_address_id, lifetime_value_cents, created_at). FK to users; one customer row per (store_id, user_id) when logged-in. Email-only guests get a customer row created on first order.

`addresses` (id, customer_id, type 'billing'|'shipping'|'both', name, line1, line2, city, region, postal, country, phone, is_default bool, created_at).

### Task 3 — Orders extension

ALTER TABLE orders ADD:
- `fulfillment_status` enum('unfulfilled', 'partial', 'fulfilled')
- FK `customer_id → customers.id` (set null on customer delete)
- `placed_email` already there (renamed from `email` if needed)

### Tasks 4–5 — Fulfillment + refund schemas

`fulfillments` (id, order_id, status, tracking_number, carrier, shipped_at, delivered_at).
`fulfillment_items` (fulfillment_id, order_item_id, qty).
`shipments` (id, order_id, carrier, tracking_number, status, shipped_at, delivered_at, label_url).
`shipment_items` (shipment_id, order_item_id, qty).
`refunds` (id, order_id, payment_id, amount_cents, reason, status enum('pending', 'succeeded', 'failed'), provider_ref, raw, created_at).
`refund_items` (refund_id, order_item_id, qty, amount_cents).

### Task 6 — Order events (append-only timeline)

`order_events` (id, order_id, kind text, actor_type text, actor_id uuid, payload jsonb, created_at). Append-only via no_update/no_delete policies. Used by `getOrderTimeline`.

### Task 7 — Webhooks + outbox schemas

`webhooks` (id, store_id, url, secret, topics text[], status enum('active','paused'), created_at).
`webhook_deliveries` (id, webhook_id, event_id, response_code, body, attempts, last_attempt_at, next_try_at, status enum('pending','succeeded','failed','dead')).
`outbox_events` (id, store_id, topic, payload jsonb, status enum('pending','dispatched'), created_at, dispatched_at).

### Task 8 — State machine helper

`src/modules/orders/lifecycle.ts`:
```ts
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ['paid', 'cancelled'],
  paid: ['fulfilled', 'cancelled', 'refunded'],
  fulfilled: ['completed', 'refunded'],
  completed: ['refunded'],
  refunded: [],
  cancelled: [],
};
export async function transitionOrder(storeId, orderId, to, actor) { … }  // also appends order_event + outbox event
```

### Task 9–10 — Fulfillment + refund modules

Fulfillment: `createFulfillment({ orderId, items: [{orderItemId, qty}], tracking_number, carrier })` → INSERT fulfillment + items + shipment (defaults), recompute `orders.fulfillment_status`, transition order if fully fulfilled.

Refund: `createRefund({ orderId, items: [{orderItemId, qty, amountCents}], reason })` → INSERT refund row status='pending' → call provider.refundPayment → on success webhook applies and transitions order.

### Task 11–12 — Outbox + webhook dispatch

`writeOutboxEvent(tx, storeId, topic, payload)` writes inside the calling tx — guarantees atomicity with order mutation.

Worker: `webhook-dispatch.ts` drains outbox in batches, looks up subscribed webhooks by topic, INSERT webhook_deliveries row per (event, webhook), POSTs body with HMAC header, updates delivery status + attempts. Failed deliveries get `next_try_at` set to backoff schedule; the job re-enqueues itself for retries.

### Tasks 13–17 — APIs

Admin orders/customers/webhooks routes; customer orders/me/addresses routes. Standard pipelines from earlier SPs.

### Task 18 — Stale payment sweep

Cancel orders stuck in `pending_payment` for > 30 min; release any reservations; outbox `order.cancelled`.

### Tasks 19–27 — Tests

Cover state machine, fulfillment partial flow, refund partial flow, webhook signature verification, dispatch with retries, dead-letter, RLS isolation.

---

## Parallel Stream Groupings

- A: schemas + migrations (sequential)
- B: orders modules (after A)
- C: customers + addresses modules (after A)
- D: webhooks modules (after A)
- E: admin orders API (after B)
- F: customer API (after C)
- G: admin webhooks API (after D)
- H: webhook dispatch worker (after D)
- I: stale payment sweep job
- J: tests fan-in

Dispatch: A → (B,C,D,H,I parallel) → (E,F,G parallel) → J.

---

## Verification

End-to-end: place an order (SP-4 flow) → admin fulfills → webhook fires to a test endpoint → admin refunds → provider webhook arrives → order transitions to refunded.

## Risks & Open Questions

1. **Provider refund webhooks:** Razorpay refund events use a separate channel from PaymentIntent events. Test thoroughly.
2. **Tracking number formats:** keep `text`, no validation; carrier-specific URL formatting handled in storefront via config.
3. **Idempotency on refunds:** use the refund row's id as the provider's idempotency key.
4. **Customer merge on email collision:** when a guest order arrives for an email that later registers, on first login we link `customer.user_id` to the new user. Documented; SP-5 implements.
