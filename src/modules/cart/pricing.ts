/**
 * Pricing engine — single source of truth for cart/checkout totals.
 *
 * Composition:
 *   1. Load cart + items.
 *   2. Re-price each line from `product_variants.price_cents` (NOT the snapshot
 *      in `cart_items.unit_price_cents`, which is stale by design).
 *   3. Compute line-level tax via `computeLineTax` against the tax rate
 *      resolved from the shipping address + product.tax_class.
 *   4. Apply auto promotions + coupon via `applyPromotions`. Distribute the
 *      discount across lines proportionally (largest line gets the remainder).
 *   5. Compute shipping via `computeShipping`; if any applied promo is
 *      `free_shipping`, zero the shipping cents.
 *   6. Roll up totals. For inclusive tax the tax is already in subtotal; for
 *      exclusive tax it is added on top.
 */

import { eq, inArray } from 'drizzle-orm';
import type { PostgresJsTransaction } from 'drizzle-orm/postgres-js';
import { withTenant } from '@/modules/tenant/with-tenant';
import { carts, cartItems, type Address } from '@/db/schema/carts';
import { products, productVariants } from '@/db/schema/catalog';
import { loadSiteConfig } from '@/modules/config/loader';
import { CartNotFoundError, VariantNotAvailableError } from './errors';
import { computeLineTax, resolveTaxRate, type TaxMode } from './tax';
import { computeShipping, sumCartCents } from './shipping';
import { applyPromotions, type AppliedPromotion } from './promotions';
import type { PricedLine } from './pricing-types';

type Tx = PostgresJsTransaction<Record<string, never>, Record<string, never>>;

export type { PricedLine } from './pricing-types';

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

export type CartRow = typeof carts.$inferSelect;
export type CartItemRow = typeof cartItems.$inferSelect;

export type CartWithItems = CartRow & {
  items: CartItemRow[];
};

export type PriceCartOptions = {
  shippingAddress?: Address;
  shippingRateCode?: string;
};

/**
 * Load a cart with its items in the current tenant scope. Throws
 * `CartNotFoundError` if the cart is not visible.
 */
export async function getCartWithItems(tx: Tx, cartId: string): Promise<CartWithItems> {
  const rows = await tx.select().from(carts).where(eq(carts.id, cartId)).limit(1);
  const cart = rows[0];
  if (!cart) throw new CartNotFoundError(cartId);
  const items = await tx
    .select()
    .from(cartItems)
    .where(eq(cartItems.cartId, cartId))
    .orderBy(cartItems.createdAt);
  return { ...cart, items };
}

type VariantPricing = {
  variantId: string;
  priceCents: number;
  status: typeof productVariants.$inferSelect.status;
  productTaxClass: string;
};

async function loadVariantPricing(
  tx: Tx,
  variantIds: string[],
): Promise<Map<string, VariantPricing>> {
  if (variantIds.length === 0) return new Map();
  const rows = await tx
    .select({
      variantId: productVariants.id,
      priceCents: productVariants.priceCents,
      status: productVariants.status,
      productTaxClass: products.taxClass,
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(inArray(productVariants.id, variantIds));

  const map = new Map<string, VariantPricing>();
  for (const r of rows) {
    map.set(r.variantId, {
      variantId: r.variantId,
      priceCents: r.priceCents,
      status: r.status,
      productTaxClass: r.productTaxClass ?? 'default',
    });
  }
  return map;
}

/**
 * Distribute a discount across lines proportionally to lineSubtotal. The
 * largest line absorbs the rounding residue so the sum exactly matches the
 * input discountCents.
 */
function distributeDiscount(lines: PricedLine[], discountCents: number): void {
  if (discountCents <= 0 || lines.length === 0) return;
  const grossSubtotal = lines.reduce((s, l) => s + l.lineSubtotalCents, 0);
  if (grossSubtotal <= 0) return;
  let allocated = 0;
  let largestIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const share = Math.floor((line.lineSubtotalCents * discountCents) / grossSubtotal);
    line.lineDiscountCents = share;
    allocated += share;
    if (line.lineSubtotalCents > lines[largestIdx]!.lineSubtotalCents) largestIdx = i;
  }
  const residue = discountCents - allocated;
  if (residue !== 0) {
    const target = lines[largestIdx]!;
    target.lineDiscountCents += residue;
  }
}

export async function priceCart(
  storeId: string,
  cartId: string,
  opts?: PriceCartOptions,
): Promise<CartTotals> {
  return withTenant(storeId, async tx => {
    const cart = await getCartWithItems(tx, cartId);
    const cfg = await loadSiteConfig(storeId);
    const configuredMode: TaxMode = (cfg as { tax?: { mode?: TaxMode } }).tax?.mode ?? 'inclusive';

    const variantIds = cart.items.map(it => it.variantId);
    const pricingByVariant = await loadVariantPricing(tx, variantIds);

    // Address: explicit option > cart's stored shipping address.
    const address: Address | undefined = opts?.shippingAddress ?? cart.shippingAddress ?? undefined;

    // 1. Build priced lines from current variant prices + per-line tax.
    const lines: PricedLine[] = [];
    for (const item of cart.items) {
      const variant = pricingByVariant.get(item.variantId);
      if (!variant) throw new VariantNotAvailableError(item.variantId, 'not_found');
      if (variant.status !== 'active') {
        throw new VariantNotAvailableError(item.variantId, `status=${variant.status}`);
      }

      const taxRate = await resolveTaxRate(tx, storeId, address, variant.productTaxClass);
      // resolveTaxRate returns the configured mode when no row matches; row-mode
      // wins when present. Use the resolved mode for math, not the global default.
      const mode = taxRate.mode;
      const { lineSubtotalCents, lineTaxCents } = computeLineTax(
        variant.priceCents,
        item.qty,
        taxRate.rate,
        mode,
      );

      lines.push({
        itemId: item.id,
        variantId: item.variantId,
        qty: item.qty,
        unitPriceCents: variant.priceCents,
        lineSubtotalCents,
        lineDiscountCents: 0,
        lineTaxCents,
        lineTotalCents:
          mode === 'inclusive' ? lineSubtotalCents : lineSubtotalCents + lineTaxCents,
      });
    }

    // 2. Apply promotions.
    const promos = await applyPromotions(tx, storeId, cart, lines);

    // Total monetary discount (excludes free-shipping which is a flag).
    const discountCents = promos.reduce(
      (s, p) => s + (p.freeShipping ? 0 : p.amountCents),
      0,
    );
    distributeDiscount(lines, discountCents);

    // 3. Compute shipping. Free shipping promo zeroes the result.
    const cartForShipping = {
      items: cart.items.map(it => {
        const variant = pricingByVariant.get(it.variantId);
        return {
          qty: it.qty,
          unitPriceCents: variant?.priceCents ?? it.unitPriceCents,
        };
      }),
    };
    const shipping = await computeShipping(
      tx,
      storeId,
      cartForShipping,
      address,
      opts?.shippingRateCode,
    );
    const hasFreeShipping = promos.some(p => p.freeShipping);
    const shippingCents = hasFreeShipping ? 0 : shipping.cents;

    // 4. Roll up.
    const subtotalCents = lines.reduce((s, l) => s + l.lineSubtotalCents, 0);
    const taxCents = lines.reduce((s, l) => s + l.lineTaxCents, 0);

    // The first non-undefined resolved mode (or configured fallback) decides
    // whether tax is already in subtotal.
    const totalCents =
      configuredMode === 'inclusive'
        ? subtotalCents - discountCents + shippingCents
        : subtotalCents - discountCents + shippingCents + taxCents;

    void sumCartCents; // referenced for parity with the plan signature export

    const totals: CartTotals = {
      subtotalCents,
      discountCents,
      taxCents,
      shippingCents,
      totalCents,
      lines,
      appliedPromotions: promos,
    };
    if (shipping.option) totals.shippingOption = shipping.option;
    return totals;
  });
}
