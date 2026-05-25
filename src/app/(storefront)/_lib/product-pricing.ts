import 'server-only';
import { listVariants } from '@/modules/catalog/variants';
import type { ProductSummary } from '@/modules/catalog/products';

/**
 * Display price for a product listing card: the lowest active-variant price.
 * Returns null when the product has no active variant (it then renders without
 * a price badge). N+1 over the page's products — acceptable at listing scale
 * (limit ≤ 50) and avoids reaching into the module layer with a custom query.
 */
export type ProductDisplay = {
  product: ProductSummary;
  fromCents: number | null;
  compareAtCents: number | null;
};

export async function loadProductDisplays(
  storeId: string,
  products: ProductSummary[],
): Promise<ProductDisplay[]> {
  return Promise.all(
    products.map(async product => {
      const variants = await listVariants(storeId, product.id);
      const active = variants.filter(v => v.status === 'active');
      if (active.length === 0) {
        return { product, fromCents: null, compareAtCents: null };
      }
      let min = active[0]!;
      for (const v of active) {
        if (v.priceCents < min.priceCents) min = v;
      }
      return {
        product,
        fromCents: min.priceCents,
        compareAtCents: min.compareAtCents ?? null,
      };
    }),
  );
}
