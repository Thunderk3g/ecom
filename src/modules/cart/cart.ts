/**
 * Cart module — CRUD over the carts/cart_items tables plus merge-on-login.
 *
 * Cart lifecycle:
 *   - Guest cart: sessionId set, customerId NULL. Unique per (storeId, sessionId)
 *     via 0013 partial index `carts_guest_session_uq`.
 *   - Customer cart: customerId set. Unique per (storeId, customerId) via 0013
 *     `carts_customer_uq`.
 *   - TTL: every cart has expires_at = now + 30 days. Refreshed by every
 *     mutation. A daily sweeper (Stream H) deletes expired carts and releases
 *     their reservations.
 *
 * All tenant operations go through `withTenant(storeId, …)` so RLS blocks any
 * cross-store leak. Items always carry storeId (denormalized) — a trigger in
 * 0012 enforces parity with the parent cart's storeId.
 *
 * Snapshots: `cart_items.unit_price_cents` is a snapshot for audit/UI; the
 * pricing engine re-prices from `product_variants.price_cents` at quote time
 * so totals never go stale.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsTransaction } from 'drizzle-orm/postgres-js';
import { withTenant } from '@/modules/tenant/with-tenant';
import { carts, cartItems, type Address } from '@/db/schema/carts';
import { productVariants } from '@/db/schema/catalog';
import {
  CartNotFoundError,
  CartItemNotFoundError,
  VariantNotAvailableError,
} from './errors';
import { assertCouponValid } from './promotions';
import { getCartWithItems, type CartWithItems } from './pricing';

type Tx = PostgresJsTransaction<Record<string, never>, Record<string, never>>;

export type CartRow = typeof carts.$inferSelect;

export type CreateCartInput = {
  sessionId: string;
  customerId?: string | null;
  currency?: string;
};

export type AddItemInput = {
  variantId: string;
  qty: number;
};

export type SetAddressesInput = {
  shippingAddress?: Address;
  billingAddress?: Address;
};

/** Default cart TTL (30 days). Plan §Assumptions #2. */
const CART_TTL_DAYS = 30;

function ttlExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + CART_TTL_DAYS * 24 * 60 * 60 * 1000);
}

async function touchCart(tx: Tx, cartId: string): Promise<void> {
  await tx
    .update(carts)
    .set({ updatedAt: sql`now()`, expiresAt: ttlExpiry() })
    .where(eq(carts.id, cartId));
}

async function assertCartExists(tx: Tx, cartId: string): Promise<CartRow> {
  const rows = await tx.select().from(carts).where(eq(carts.id, cartId)).limit(1);
  const row = rows[0];
  if (!row) throw new CartNotFoundError(cartId);
  return row;
}

async function getActiveVariant(
  tx: Tx,
  variantId: string,
): Promise<typeof productVariants.$inferSelect> {
  const rows = await tx
    .select()
    .from(productVariants)
    .where(eq(productVariants.id, variantId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new VariantNotAvailableError(variantId, 'not_found');
  if (row.status !== 'active') {
    throw new VariantNotAvailableError(variantId, `status=${row.status}`);
  }
  return row;
}

export async function createCart(storeId: string, input: CreateCartInput): Promise<CartRow> {
  return withTenant(storeId, async tx => {
    const inserted = await tx
      .insert(carts)
      .values({
        storeId,
        sessionId: input.sessionId,
        customerId: input.customerId ?? null,
        currency: input.currency ?? 'INR',
        expiresAt: ttlExpiry(),
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error('createCart: insert returned no row');
    return row;
  });
}

export async function getCart(storeId: string, cartId: string): Promise<CartWithItems | null> {
  return withTenant(storeId, async tx => {
    const rows = await tx.select().from(carts).where(eq(carts.id, cartId)).limit(1);
    if (!rows[0]) return null;
    return getCartWithItems(tx, cartId);
  });
}

export async function addItem(
  storeId: string,
  cartId: string,
  input: AddItemInput,
): Promise<CartWithItems> {
  if (input.qty <= 0) {
    throw new VariantNotAvailableError(input.variantId, 'qty must be > 0');
  }
  return withTenant(storeId, async tx => {
    await assertCartExists(tx, cartId);
    const variant = await getActiveVariant(tx, input.variantId);

    // Upsert against the partial unique index (cart_id, variant_id). On
    // conflict, sum quantities and refresh price snapshot.
    await tx
      .insert(cartItems)
      .values({
        cartId,
        storeId,
        variantId: input.variantId,
        qty: input.qty,
        unitPriceCents: variant.priceCents,
      })
      .onConflictDoUpdate({
        target: [cartItems.cartId, cartItems.variantId],
        set: {
          qty: sql`${cartItems.qty} + ${input.qty}`,
          unitPriceCents: variant.priceCents,
          updatedAt: sql`now()`,
        },
      });
    await touchCart(tx, cartId);
    return getCartWithItems(tx, cartId);
  });
}

export async function updateItem(
  storeId: string,
  cartId: string,
  itemId: string,
  patch: { qty: number },
): Promise<CartWithItems> {
  if (patch.qty <= 0) {
    return removeItem(storeId, cartId, itemId);
  }
  return withTenant(storeId, async tx => {
    await assertCartExists(tx, cartId);
    const updated = await tx
      .update(cartItems)
      .set({ qty: patch.qty, updatedAt: sql`now()` })
      .where(and(eq(cartItems.id, itemId), eq(cartItems.cartId, cartId)))
      .returning({ id: cartItems.id });
    if (!updated[0]) throw new CartItemNotFoundError(itemId);
    await touchCart(tx, cartId);
    return getCartWithItems(tx, cartId);
  });
}

export async function removeItem(
  storeId: string,
  cartId: string,
  itemId: string,
): Promise<CartWithItems> {
  return withTenant(storeId, async tx => {
    await assertCartExists(tx, cartId);
    const deleted = await tx
      .delete(cartItems)
      .where(and(eq(cartItems.id, itemId), eq(cartItems.cartId, cartId)))
      .returning({ id: cartItems.id });
    if (!deleted[0]) throw new CartItemNotFoundError(itemId);
    await touchCart(tx, cartId);
    return getCartWithItems(tx, cartId);
  });
}

export async function applyCoupon(
  storeId: string,
  cartId: string,
  code: string,
): Promise<CartWithItems> {
  return withTenant(storeId, async tx => {
    await assertCartExists(tx, cartId);
    // Throws InvalidCouponError / CouponExpiredError / CouponUsageExhaustedError
    // on validation failure.
    await assertCouponValid(tx, storeId, code);
    await tx
      .update(carts)
      .set({ couponCode: code.trim(), updatedAt: sql`now()`, expiresAt: ttlExpiry() })
      .where(eq(carts.id, cartId));
    return getCartWithItems(tx, cartId);
  });
}

export async function removeCoupon(
  storeId: string,
  cartId: string,
): Promise<CartWithItems> {
  return withTenant(storeId, async tx => {
    await assertCartExists(tx, cartId);
    await tx
      .update(carts)
      .set({ couponCode: null, updatedAt: sql`now()`, expiresAt: ttlExpiry() })
      .where(eq(carts.id, cartId));
    return getCartWithItems(tx, cartId);
  });
}

export async function setAddresses(
  storeId: string,
  cartId: string,
  input: SetAddressesInput,
): Promise<CartWithItems> {
  return withTenant(storeId, async tx => {
    await assertCartExists(tx, cartId);
    const set: Partial<typeof carts.$inferInsert> = {
      updatedAt: sql`now()` as unknown as Date,
      expiresAt: ttlExpiry(),
    };
    if (input.shippingAddress !== undefined) set.shippingAddress = input.shippingAddress;
    if (input.billingAddress !== undefined) set.billingAddress = input.billingAddress;
    await tx.update(carts).set(set).where(eq(carts.id, cartId));
    return getCartWithItems(tx, cartId);
  });
}

/**
 * Merge a guest cart into the customer's cart on login.
 *
 * Algorithm:
 *   1. Find guest cart by (storeId, sessionId, customerId IS NULL).
 *   2. Find or create the customer's cart by (storeId, customerId).
 *   3. For each guest item, INSERT into the customer cart's items; on conflict
 *      (cart_id, variant_id) sum qtys.
 *   4. Inherit guest cart's couponCode / addresses only when the customer's
 *      cart does not already have one (don't overwrite the customer's intent).
 *   5. Delete the guest cart (items cascade).
 *
 * Returns the merged customer cart row.
 */
export async function mergeOnLogin(
  storeId: string,
  sessionId: string,
  customerId: string,
): Promise<CartRow> {
  return withTenant(storeId, async tx => {
    const guestRows = await tx
      .select()
      .from(carts)
      .where(
        and(
          eq(carts.storeId, storeId),
          eq(carts.sessionId, sessionId),
          sql`${carts.customerId} IS NULL`,
        ),
      )
      .limit(1);
    const guest = guestRows[0];

    // Find or create the customer's cart.
    const existingCustomerRows = await tx
      .select()
      .from(carts)
      .where(and(eq(carts.storeId, storeId), eq(carts.customerId, customerId)))
      .limit(1);
    let customerCart = existingCustomerRows[0];
    if (!customerCart) {
      const inserted = await tx
        .insert(carts)
        .values({
          storeId,
          customerId,
          sessionId,
          currency: guest?.currency ?? 'INR',
          expiresAt: ttlExpiry(),
        })
        .returning();
      const newRow = inserted[0];
      if (!newRow) throw new Error('mergeOnLogin: failed to create customer cart');
      customerCart = newRow;
    }

    if (!guest) return customerCart;

    // Pull guest items and upsert into the customer cart.
    const guestItems = await tx
      .select()
      .from(cartItems)
      .where(eq(cartItems.cartId, guest.id));
    for (const it of guestItems) {
      await tx
        .insert(cartItems)
        .values({
          cartId: customerCart.id,
          storeId,
          variantId: it.variantId,
          qty: it.qty,
          unitPriceCents: it.unitPriceCents,
        })
        .onConflictDoUpdate({
          target: [cartItems.cartId, cartItems.variantId],
          set: {
            qty: sql`${cartItems.qty} + ${it.qty}`,
            updatedAt: sql`now()`,
          },
        });
    }

    // Inherit coupon and addresses only when absent on the customer cart.
    const inheritUpdates: Partial<typeof carts.$inferInsert> = {
      updatedAt: sql`now()` as unknown as Date,
      expiresAt: ttlExpiry(),
    };
    if (!customerCart.couponCode && guest.couponCode) {
      inheritUpdates.couponCode = guest.couponCode;
    }
    if (!customerCart.shippingAddress && guest.shippingAddress) {
      inheritUpdates.shippingAddress = guest.shippingAddress;
    }
    if (!customerCart.billingAddress && guest.billingAddress) {
      inheritUpdates.billingAddress = guest.billingAddress;
    }
    await tx.update(carts).set(inheritUpdates).where(eq(carts.id, customerCart.id));

    // Drop the guest cart (cart_items cascade).
    await tx.delete(carts).where(eq(carts.id, guest.id));

    const refreshed = await tx
      .select()
      .from(carts)
      .where(eq(carts.id, customerCart.id))
      .limit(1);
    return refreshed[0] ?? customerCart;
  });
}
