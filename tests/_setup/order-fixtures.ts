/**
 * Shared fixture helpers for SP-5 order lifecycle / fulfillment / refunds /
 * customers / webhooks integration tests.
 *
 * Pattern follows `cart-fixtures.ts` and `inventory-fixtures.ts`: all setup
 * writes go through `migratorClient` (BYPASSRLS) so individual tests don't
 * have to juggle `withTenant`. The tested module code itself then exercises
 * `withTenant` and the NOBYPASSRLS `app_user` role.
 *
 * `createPaidOrder` mimics what `createOrderFromCart` would produce — an
 * orders row in `status='paid' / paymentStatus='paid'`, an order_items row,
 * and a backing payments row with a providerRef so `createRefund` can find
 * its captured payment. No cart / intent / webhook plumbing — we go straight
 * to the post-payment state so lifecycle tests don't drag in checkout setup.
 */

import { migratorClient } from '@/db/client';
import {
  createCartTenant,
  type CartTenantFixture,
} from './cart-fixtures';

export interface PaidOrderFixture {
  storeId: string;
  storeSlug: string;
  tenant: CartTenantFixture;
  orderId: string;
  orderNumber: string;
  orderItemId: string;
  /** A second order_item — handy for partial-refund / partial-fulfillment tests. */
  orderItemBId: string;
  customerId: string;
  variantId: string;
  variantBId: string;
  paymentId: string;
  paymentProviderRef: string;
}

export interface CreatePaidOrderOpts {
  /** Slug used to name the test tenant. Random by default. */
  slug?: string;
  /** Qty for the primary item (variantA). Default 2. */
  qty?: number;
  /** Unit price for the primary item. Default 10000 cents. */
  unitPriceCents?: number;
  /** Qty for the secondary item (variantB). Default 1. */
  qtyB?: number;
  /** Unit price for the secondary item. Default 5000 cents. */
  unitPriceBCents?: number;
  /** Order email. Default `paid-<rand>@test.local`. */
  email?: string;
  /** Provider name on the backing payment row. Default 'razorpay'. */
  provider?: 'razorpay' | 'stripe' | 'manual';
}

/**
 * Build a fully-seeded `paid` order ready for lifecycle / fulfillment /
 * refund tests. Inserts:
 *   - store + admin user + two variants + warehouse + 100 on-hand each
 *     (via `createCartTenant`)
 *   - a customers row tied to the admin user
 *   - an orders row in (status='paid', paymentStatus='paid')
 *   - two order_items rows (so partial fulfillment / refund have something
 *     to cover)
 *   - a payments row in 'succeeded' with a providerRef so `createRefund`
 *     can call the provider with a real reference
 *
 * Note: we don't create the intent / cart — the order is materialised
 * directly via SQL, matching the post-webhook state.
 */
export async function createPaidOrder(
  opts: CreatePaidOrderOpts = {},
): Promise<PaidOrderFixture> {
  const slug = opts.slug ?? `ord-${crypto.randomUUID().slice(0, 8)}`;
  const tenant = await createCartTenant(slug);

  const qty = opts.qty ?? 2;
  const unitPriceCents = opts.unitPriceCents ?? 10000;
  const qtyB = opts.qtyB ?? 1;
  const unitPriceBCents = opts.unitPriceBCents ?? 5000;
  const provider = opts.provider ?? 'razorpay';

  const lineTotal = qty * unitPriceCents;
  const lineBTotal = qtyB * unitPriceBCents;
  const subtotalCents = lineTotal + lineBTotal;
  // No tax / shipping / discount in the fixture — keep totals simple so
  // refund-amount math is obvious in test assertions.
  const totalCents = subtotalCents;

  const email = opts.email ?? `paid-${crypto.randomUUID().slice(0, 6)}@test.local`;

  // Create a store-scoped customer record tied to the admin user fixture.
  const customerRows = await migratorClient<{ id: string }[]>`
    INSERT INTO customers (store_id, user_id, email)
    VALUES (${tenant.storeId}, ${tenant.adminId}, ${email})
    RETURNING id
  `;
  const customerId = customerRows[0]?.id;
  if (!customerId) throw new Error('createPaidOrder: customers insert returned no row');

  // Mint the order number using the production sequence helper so the
  // resulting row passes the same uniqueness constraints production rows do.
  const orderRows = await migratorClient<{ id: string; number: string }[]>`
    INSERT INTO orders (
      store_id, number, customer_id, email,
      status, payment_status, fulfillment_status,
      currency, subtotal_cents, discount_cents, tax_cents, shipping_cents, total_cents
    ) VALUES (
      ${tenant.storeId},
      mint_order_number(${tenant.storeSlug}),
      ${customerId},
      ${email},
      'paid', 'paid', 'unfulfilled',
      'INR', ${subtotalCents}, 0, 0, 0, ${totalCents}
    )
    RETURNING id, number
  `;
  const orderRow = orderRows[0];
  if (!orderRow) throw new Error('createPaidOrder: orders insert returned no row');
  const orderId = orderRow.id;
  const orderNumber = orderRow.number;

  // Two order_items so partial-fulfillment / partial-refund tests have lines
  // to play with.
  const itemRowsA = await migratorClient<{ id: string }[]>`
    INSERT INTO order_items (
      order_id, store_id, variant_id, sku, name,
      qty, unit_price_cents, line_total_cents, tax_cents
    ) VALUES (
      ${orderId}, ${tenant.storeId}, ${tenant.variantA.variantId},
      ${tenant.variantA.sku}, 'Test A',
      ${qty}, ${unitPriceCents}, ${lineTotal}, 0
    )
    RETURNING id
  `;
  const orderItemId = itemRowsA[0]?.id;
  if (!orderItemId) throw new Error('createPaidOrder: order_items A insert returned no row');

  const itemRowsB = await migratorClient<{ id: string }[]>`
    INSERT INTO order_items (
      order_id, store_id, variant_id, sku, name,
      qty, unit_price_cents, line_total_cents, tax_cents
    ) VALUES (
      ${orderId}, ${tenant.storeId}, ${tenant.variantB.variantId},
      ${tenant.variantB.sku}, 'Test B',
      ${qtyB}, ${unitPriceBCents}, ${lineBTotal}, 0
    )
    RETURNING id
  `;
  const orderItemBId = itemRowsB[0]?.id;
  if (!orderItemBId) throw new Error('createPaidOrder: order_items B insert returned no row');

  // Backing payment in 'succeeded' so createRefund can resolve it. We mint
  // a deterministic providerRef so refund tests can assert on it.
  const paymentProviderRef = `${provider}_pay_${orderId}`;
  const paymentRows = await migratorClient<{ id: string }[]>`
    INSERT INTO payments (
      store_id, order_id, provider, provider_ref,
      amount_cents, status, method
    ) VALUES (
      ${tenant.storeId}, ${orderId}, ${provider}, ${paymentProviderRef},
      ${totalCents}, 'succeeded', 'card'
    )
    RETURNING id
  `;
  const paymentId = paymentRows[0]?.id;
  if (!paymentId) throw new Error('createPaidOrder: payments insert returned no row');

  return {
    storeId: tenant.storeId,
    storeSlug: tenant.storeSlug,
    tenant,
    orderId,
    orderNumber,
    orderItemId,
    orderItemBId,
    customerId,
    variantId: tenant.variantA.variantId,
    variantBId: tenant.variantB.variantId,
    paymentId,
    paymentProviderRef,
  };
}

/** Convenience: stable system-actor object for transitionOrder / events. */
export const SYSTEM_ACTOR = {
  actorType: 'system',
  actorId: null,
} as const;
