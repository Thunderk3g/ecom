/**
 * Orders module — order creation from cart + customer-facing reads.
 *
 * Responsibilities:
 *   - `createOrderFromCart`: invoked from the payment webhook handler (Stream F)
 *     after a successful payment event. Atomic inside one transaction: re-price
 *     to verify the intent amount, mint the order number, insert orders +
 *     order_items, insert the payments row, commit reservations, record promo
 *     redemptions, and drop the cart.
 *   - `getOrderByNumber` / `getOrderById`: tenant-scoped reads for the order
 *     detail endpoint (customer or guest by email match handled at the route).
 *   - `listCustomerOrders`: cursor-paginated history for the logged-in customer.
 *
 * Tolerance: a ±1 cent rounding window between the intent's recorded amount
 * and the re-priced total is accepted (provider-side rounding sometimes flips
 * the last cent). Anything beyond throws AmountMismatchError — the webhook
 * marks the event errored and leaves the intent in 'attached'; ops must
 * investigate before retrying.
 */

import { and, desc, eq, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsTransaction } from 'drizzle-orm/postgres-js';
import { withTenant } from '@/modules/tenant/with-tenant';
import { decodeCursor, encodeCursor, parseLimit } from '@/lib/cursor';
import { carts, cartItems, type Address } from '@/db/schema/carts';
import { products, productVariants } from '@/db/schema/catalog';
import { orders, orderItems } from '@/db/schema/orders';
import { paymentIntents, payments } from '@/db/schema/payments';
import { stores } from '@/db/schema/tenancy';
import { priceCart, type CartTotals } from '@/modules/cart/pricing';
import { applyPromotions, recordRedemption } from '@/modules/cart/promotions';
import { commit as commitReservations } from '@/modules/inventory/reservations';
import {
  AmountMismatchError,
  CheckoutNotFoundError,
  OrderAlreadyExistsError,
} from './errors';

type Tx = PostgresJsTransaction<Record<string, never>, Record<string, never>>;

export type OrderRow = typeof orders.$inferSelect;
export type OrderItemRow = typeof orderItems.$inferSelect;
export type PaymentIntentRow = typeof paymentIntents.$inferSelect;

export type OrderWithItems = OrderRow & {
  items: OrderItemRow[];
};

export type CreateOrderFromCartInput = {
  cartId: string;
  intent: PaymentIntentRow;
  paymentRef: { providerRef: string; amountCents: number; method?: string };
  /**
   * Customer-facing email for the order record. The cart's `customerId` (when
   * present) is also linked, but `orders.email` is NOT NULL on the schema so
   * the webhook handler resolves email from the payment provider's customer
   * payload (Razorpay `notes.email` / Stripe `receipt_email`) before calling
   * here. When omitted, falls back to '' so test fixtures don't need to wire
   * email plumbing — production callers MUST pass it.
   */
  email?: string;
};

/** ±1 cent rounding tolerance between intent.amountCents and re-priced total. */
const AMOUNT_TOLERANCE_CENTS = 1;

/**
 * Look up a store's slug for use in `mint_order_number(store_slug)`. The
 * sequence helper builds the human-facing number as `UPPER(slug) || '-' ||
 * lpad(n, 8, '0')` (migration 0014).
 */
async function getStoreSlug(tx: Tx, storeId: string): Promise<string> {
  const rows = await tx
    .select({ slug: stores.slug })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new CheckoutNotFoundError(`store=${storeId}`);
  return row.slug;
}

async function mintOrderNumber(tx: Tx, storeSlug: string): Promise<string> {
  const result = await tx.execute(
    sql`SELECT mint_order_number(${storeSlug}) AS number`,
  );
  const rows = result as unknown as Array<{ number: string }>;
  const row = rows[0];
  if (!row?.number) throw new Error('mint_order_number returned no row');
  return row.number;
}

/**
 * Create an order from a cart inside an existing transaction. Caller is
 * responsible for opening `withTenant(storeId, …)` so RLS is set; this lets the
 * webhook handler dispatch from `withMigratorDb` and switch tenants per event.
 *
 * Returns the inserted order row plus its items (already snapshotted).
 */
export async function createOrderFromCart(
  tx: Tx,
  storeId: string,
  input: CreateOrderFromCartInput,
): Promise<OrderWithItems> {
  const { cartId, intent, paymentRef } = input;

  // Guard: if an order already references this intent, treat as duplicate
  // (webhook redelivery). The webhook handler also dedupes on provider_event_id
  // upstream, but this is a second layer of defence against an in-flight retry.
  const existingPayments = await tx
    .select({ orderId: payments.orderId })
    .from(payments)
    .where(eq(payments.intentId, intent.id))
    .limit(1);
  const prior = existingPayments[0];
  if (prior?.orderId) {
    throw new OrderAlreadyExistsError(prior.orderId);
  }

  // 1. Load cart + items inline (avoid getCartWithItems' separate tenant
  //    transaction; we are already inside one).
  const cartRows = await tx
    .select()
    .from(carts)
    .where(eq(carts.id, cartId))
    .limit(1);
  const cart = cartRows[0];
  if (!cart) throw new CheckoutNotFoundError(`cart=${cartId}`);

  const items = await tx
    .select()
    .from(cartItems)
    .where(eq(cartItems.cartId, cartId))
    .orderBy(cartItems.createdAt);
  if (items.length === 0) {
    throw new CheckoutNotFoundError(`cart=${cartId} has no items`);
  }

  // 2. Re-price (the engine uses its own `withTenant`; the inner tx joins ours
  //    because withTenant uses `set_config('app.store_id', …, true)` which is
  //    transaction-local — but priceCart opens its own outer transaction. To
  //    avoid nesting, re-do the math here using the engine's primitives.)
  //    Practical approach: call priceCart (it manages its own transaction) and
  //    then commit our writes; the cart is read-only during re-price.
  const totals: CartTotals = await priceCart(storeId, cartId, {
    ...(cart.shippingAddress ? { shippingAddress: cart.shippingAddress } : {}),
  });

  // 3. Verify total matches intent within tolerance.
  const delta = Math.abs(totals.totalCents - intent.amountCents);
  if (delta > AMOUNT_TOLERANCE_CENTS) {
    throw new AmountMismatchError(intent.amountCents, totals.totalCents);
  }

  // 4. Mint order number.
  const slug = await getStoreSlug(tx, storeId);
  const orderNumber = await mintOrderNumber(tx, slug);

  // 5. Snapshot variant + product details for order_items.
  const variantIds = items.map(it => it.variantId);
  const snapshotRows = await tx
    .select({
      variantId: productVariants.id,
      sku: productVariants.sku,
      variantName: productVariants.name,
      axes: productVariants.axes,
      productName: products.name,
      productAttributes: products.attributes,
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(inArray(productVariants.id, variantIds));
  const snapshotByVariant = new Map(snapshotRows.map(r => [r.variantId, r]));

  // 6. INSERT order.
  const billingAddress: Address | null =
    cart.billingAddress ?? cart.shippingAddress ?? null;
  const insertedOrders = await tx
    .insert(orders)
    .values({
      storeId,
      number: orderNumber,
      customerId: cart.customerId ?? null,
      email: input.email ?? '',
      status: 'paid',
      paymentStatus: 'paid',
      billingAddress: billingAddress ?? null,
      shippingAddress: cart.shippingAddress ?? null,
      currency: cart.currency,
      subtotalCents: totals.subtotalCents,
      discountCents: totals.discountCents,
      taxCents: totals.taxCents,
      shippingCents: totals.shippingCents,
      totalCents: totals.totalCents,
      couponCode: cart.couponCode ?? null,
      note: cart.note ?? null,
    })
    .returning();
  const orderRow = insertedOrders[0];
  if (!orderRow) throw new Error('orders insert returned no row');

  // 7. INSERT order_items — line totals come from the priced lines so
  //    discount/tax distribution matches the engine, not the raw cart prices.
  const linesByItemId = new Map(totals.lines.map(l => [l.itemId, l]));
  const orderItemValues: Array<typeof orderItems.$inferInsert> = [];
  for (const item of items) {
    const snap = snapshotByVariant.get(item.variantId);
    if (!snap) throw new CheckoutNotFoundError(`variant=${item.variantId}`);
    const line = linesByItemId.get(item.id);
    const lineTotalCents = line
      ? line.lineTotalCents - line.lineDiscountCents
      : item.qty * item.unitPriceCents;
    const lineTaxCents = line?.lineTaxCents ?? 0;
    const displayName = snap.variantName ?? snap.productName;
    const attributes: Record<string, unknown> = {
      ...(snap.productAttributes ?? {}),
      ...(snap.axes ?? {}),
    };
    orderItemValues.push({
      orderId: orderRow.id,
      storeId,
      variantId: item.variantId,
      sku: snap.sku,
      name: displayName,
      qty: item.qty,
      unitPriceCents: line?.unitPriceCents ?? item.unitPriceCents,
      lineTotalCents,
      taxCents: lineTaxCents,
      attributes,
    });
  }
  await tx.insert(orderItems).values(orderItemValues);

  // 8. INSERT payments row.
  await tx.insert(payments).values({
    storeId,
    orderId: orderRow.id,
    intentId: intent.id,
    provider: intent.provider,
    providerRef: paymentRef.providerRef,
    amountCents: paymentRef.amountCents,
    status: 'succeeded',
    method: paymentRef.method ?? null,
    raw: null,
  });

  // 9. Flip intent → succeeded.
  await tx
    .update(paymentIntents)
    .set({ status: 'succeeded', updatedAt: sql`now()` })
    .where(eq(paymentIntents.id, intent.id));

  // 10. Commit reservations to the new order.
  if (intent.reservationIds.length > 0) {
    await commitReservations(storeId, intent.reservationIds, orderRow.id);
  }

  // 11. Record promotion redemptions for any applied promotions.
  for (const applied of totals.appliedPromotions) {
    await recordRedemption(tx, storeId, applied, {
      cartId,
      orderId: orderRow.id,
      customerId: cart.customerId ?? null,
    });
  }

  // 12. Delete the cart (cart_items cascade per 0011 FK).
  await tx.delete(carts).where(eq(carts.id, cartId));

  // 13. Re-fetch items to return.
  const insertedItems = await tx
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, orderRow.id));

  return { ...orderRow, items: insertedItems };
}

export async function getOrderById(
  storeId: string,
  orderId: string,
): Promise<OrderWithItems | null> {
  return withTenant(storeId, async tx => {
    const rows = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const items = await tx
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));
    return { ...row, items };
  });
}

export async function getOrderByNumber(
  storeId: string,
  number: string,
): Promise<OrderWithItems | null> {
  return withTenant(storeId, async tx => {
    const rows = await tx
      .select()
      .from(orders)
      .where(eq(orders.number, number))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const items = await tx
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, row.id));
    return { ...row, items };
  });
}

export type ListCustomerOrdersOptions = {
  cursor?: string;
  limit?: number;
};

export type ListCustomerOrdersResult = {
  items: OrderWithItems[];
  nextCursor: string | null;
};

/**
 * Cursor-paginated newest-first list of a customer's orders. Cursor key is
 * `placed_at` ISO with `id` as tiebreaker, matching the shared cursor shape.
 */
export async function listCustomerOrders(
  storeId: string,
  customerId: string,
  opts: ListCustomerOrdersOptions = {},
): Promise<ListCustomerOrdersResult> {
  const limit = parseLimit(opts.limit?.toString());

  return withTenant(storeId, async tx => {
    const filters: SQL[] = [eq(orders.customerId, customerId)];

    if (opts.cursor) {
      const decoded = decodeCursor(opts.cursor);
      if (decoded) {
        const cutoff = new Date(decoded.k);
        filters.push(
          or(
            lt(orders.placedAt, cutoff),
            and(eq(orders.placedAt, cutoff), lt(orders.id, decoded.id)),
          ) as SQL,
        );
      }
    }

    const pageRows = await tx
      .select()
      .from(orders)
      .where(and(...filters))
      .orderBy(desc(orders.placedAt), desc(orders.id))
      .limit(limit + 1);

    const hasMore = pageRows.length > limit;
    const sliced = hasMore ? pageRows.slice(0, limit) : pageRows;
    const ids = sliced.map(r => r.id);

    let itemsByOrder = new Map<string, OrderItemRow[]>();
    if (ids.length > 0) {
      const itemRows = await tx
        .select()
        .from(orderItems)
        .where(inArray(orderItems.orderId, ids));
      itemsByOrder = itemRows.reduce<Map<string, OrderItemRow[]>>((acc, r) => {
        const list = acc.get(r.orderId) ?? [];
        list.push(r);
        acc.set(r.orderId, list);
        return acc;
      }, new Map());
    }

    const items = sliced.map(o => ({ ...o, items: itemsByOrder.get(o.id) ?? [] }));

    const last = sliced[sliced.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ k: last.placedAt.toISOString(), id: last.id })
        : null;

    return { items, nextCursor };
  });
}

// Touch unused imports referenced for parity with the plan.
void applyPromotions;
