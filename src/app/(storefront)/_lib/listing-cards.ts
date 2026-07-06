import 'server-only';
import { listVariants } from '@/modules/catalog/variants';
import type { ProductSummary } from '@/modules/catalog/products';
import type { ProductDisplay } from './product-pricing';
import type { ProductCardQuickAdd } from '@/components/storefront/ProductCard';

/**
 * Listing-surface card data: the standard `ProductDisplay` price shape plus the
 * quick-add wiring the enhanced `ProductCard` accepts. Computed from a single
 * `listVariants` call per product (same N+1 budget as `loadProductDisplays`,
 * which listing pages previously used — this replaces it there so variants are
 * not fetched twice).
 */
export type ListingCard = ProductDisplay & { quickAdd?: ProductCardQuickAdd };

export async function loadListingCards(
  storeId: string,
  items: ProductSummary[],
): Promise<ListingCard[]> {
  return Promise.all(
    items.map(async product => {
      const variants = await listVariants(storeId, product.id);
      const active = variants.filter(v => v.status === 'active');
      if (active.length === 0) {
        return { product, fromCents: null, compareAtCents: null };
      }
      let min = active[0]!;
      for (const v of active) {
        if (v.priceCents < min.priceCents) min = v;
      }
      const quickAdd: ProductCardQuickAdd =
        active.length === 1
          ? {
              variantId: min.id,
              ...(Object.keys(min.axes).length > 0 ? { axes: min.axes } : {}),
            }
          : 'multi';
      return {
        product,
        fromCents: min.priceCents,
        compareAtCents: min.compareAtCents ?? null,
        quickAdd,
      };
    }),
  );
}

/** Sort keys the listing toolbar offers. `default` keeps the fetched order. */
export type ListingSortKey = 'price-asc' | 'price-desc' | 'name-asc';

/**
 * Page-local sort. The catalog module exposes no ORDER BY hook (fixed
 * created_at DESC / search rank), so listing pages sort the fetched page of
 * ≤24 items server-side. Limitation: ordering applies within each page, not
 * across the whole result set — "Load more" appends a newly-sorted next page.
 */
export function sortListingCards(cards: ListingCard[], sort: string | undefined): ListingCard[] {
  const key = sort as ListingSortKey | undefined;
  if (key !== 'price-asc' && key !== 'price-desc' && key !== 'name-asc') return cards;
  const sorted = [...cards];
  if (key === 'name-asc') {
    sorted.sort((a, b) => a.product.name.localeCompare(b.product.name));
    return sorted;
  }
  const dir = key === 'price-asc' ? 1 : -1;
  sorted.sort((a, b) => {
    // Products without an active-variant price sink to the end either way.
    if (a.fromCents === null && b.fromCents === null) return 0;
    if (a.fromCents === null) return 1;
    if (b.fromCents === null) return -1;
    return (a.fromCents - b.fromCents) * dir;
  });
  return sorted;
}

/**
 * Page-local price-band filter (₹ bounds arrive as query params, prices are
 * paise). Same within-page limitation as `sortListingCards`.
 */
export function filterCardsByPrice(
  cards: ListingCard[],
  minRupees: number | null,
  maxRupees: number | null,
): ListingCard[] {
  if (minRupees === null && maxRupees === null) return cards;
  return cards.filter(c => {
    if (c.fromCents === null) return false;
    if (minRupees !== null && c.fromCents < minRupees * 100) return false;
    if (maxRupees !== null && c.fromCents > maxRupees * 100) return false;
    return true;
  });
}

/** Parse a non-negative integer query param; null when absent/invalid. */
export function parsePriceParam(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}
