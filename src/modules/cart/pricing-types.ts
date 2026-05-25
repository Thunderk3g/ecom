/**
 * Shared types for pricing/promotions/tax/shipping to avoid an import cycle
 * between `pricing.ts` and `promotions.ts`. Both modules consume `PricedLine`
 * but pricing.ts also imports promotions.applyPromotions(...) — extracting the
 * type breaks the cycle.
 */

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
