import Link from 'next/link';
import { formatMoney } from '@/app/(storefront)/_lib/money';
import type { ProductDisplay } from '@/app/(storefront)/_lib/product-pricing';
import type { SiteConfig } from '@/platform.defaults';
import { getProductImage, getProductThumbnails } from '@/utils/storefront-assets';
import { MediaPlaceholder } from '@/components/storefront/MediaPlaceholder';
import { WishlistHeart } from '@/components/storefront/WishlistHeart';
import { QuickAdd } from '@/components/storefront/QuickAdd';

/**
 * Storefront product card (home rails, category listings, search results).
 *
 * Server component in the Plume `.pcard` vocabulary; the wishlist heart and
 * quick-add button are small client islands. Price shows the lowest
 * active-variant price ("from") with an optional compare-at strike-through.
 * Products without generated imagery render the shared `MediaPlaceholder`
 * (warm duotone + glyph) inside the plate; when a product has a second image,
 * hover cross-fades to it.
 *
 * Props are additive-only over the original `{ display, config }` contract —
 * existing callers (e.g. `blocks/ProductGrid`) render unchanged.
 */
export type ProductCardQuickAdd =
  /** Single active variant: render a one-tap "Add to cart" button. */
  | { variantId: string; axes?: Record<string, string | number> }
  /** Multiple variants: render a "Choose options" link to the PDP. */
  | 'multi';

export type ProductCardProps = {
  display: ProductDisplay;
  config: Pick<SiteConfig, 'currency' | 'locale'>;
  /**
   * Optional quick-add wiring (listing surfaces pass it; callers that don't
   * get the original card with no action row). See `_lib/listing-cards.ts`.
   */
  quickAdd?: ProductCardQuickAdd;
};

export function ProductCard({ display, config, quickAdd }: ProductCardProps) {
  const { product, fromCents, compareAtCents } = display;
  const onSale = fromCents !== null && compareAtCents !== null && compareAtCents > fromCents;
  const imageSrc = getProductImage(product.slug);
  const thumbs = getProductThumbnails(product.slug);
  const hoverSrc = thumbs.length > 1 ? thumbs[1]! : null;

  return (
    <article className={`pcard hover-lift${quickAdd ? ' quick' : ''}`}>
      <Link href={`/p/${product.slug}`} className="plate" aria-label={product.name}>
        {onSale ? <span className="badge badge-sale corner">Sale</span> : null}
        {imageSrc ? (
          <>
            <img
              src={imageSrc}
              alt={product.name}
              loading="lazy"
              className={hoverSrc ? 'swap-a' : undefined}
            />
            {hoverSrc ? (
              // Second-image hover swap; decorative duplicate for AT.
              <img src={hoverSrc} alt="" aria-hidden="true" loading="lazy" className="swap-b" />
            ) : null}
          </>
        ) : (
          <MediaPlaceholder
            label={product.name}
            slug={product.slug}
            aspect="1/1"
            showLabel={false}
            style={{ position: 'absolute', inset: 0, height: '100%' }}
          />
        )}
        <span className="plate-cap">{product.name}</span>
      </Link>
      <WishlistHeart slug={product.slug} name={product.name} />
      <div className="pmeta">
        {product.brand ? <span className="brand">{product.brand}</span> : null}
        <Link href={`/p/${product.slug}`} className="pname">
          {product.name}
        </Link>
        {fromCents !== null ? (
          <div className="prow">
            {onSale ? (
              <>
                <span className="sale-price price">{formatMoney(fromCents, config)}</span>
                <span className="strike price">{formatMoney(compareAtCents!, config)}</span>
              </>
            ) : (
              <span className="price">From {formatMoney(fromCents, config)}</span>
            )}
          </div>
        ) : null}
      </div>
      {quickAdd === 'multi' ? (
        <Link href={`/p/${product.slug}`} className="add add-link">
          Choose options
        </Link>
      ) : quickAdd ? (
        <QuickAdd
          variantId={quickAdd.variantId}
          name={product.name}
          slug={product.slug}
          {...(quickAdd.axes ? { axes: quickAdd.axes } : {})}
        />
      ) : null}
    </article>
  );
}
