import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getProductBySlug } from '@/modules/catalog/products';
import { RichText } from '@/components/storefront/blocks/RichText';
import {
  ProductPurchasePanel,
  type PurchaseVariant,
} from '@/components/storefront/ProductPurchasePanel';
import { getStoreContext } from '../../_lib/context';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { storeId } = await getStoreContext();
  const product = await getProductBySlug(storeId, slug);
  if (!product) return { title: 'Product' };
  return {
    title: product.seo?.title ?? product.name,
    ...(product.seo?.description ? { description: product.seo.description } : {}),
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { storeId, config } = await getStoreContext();

  const product = await getProductBySlug(storeId, slug);
  if (!product || product.status !== 'active') notFound();

  const variants: PurchaseVariant[] = product.variants.map(v => ({
    id: v.id,
    sku: v.sku,
    name: v.name,
    axes: v.axes,
    priceCents: v.priceCents,
    compareAtCents: v.compareAtCents,
    status: v.status,
  }));

  const thumbs = product.images.slice(0, 5);

  return (
    <main className="wrap-wide">
      <div className="crumbs" style={{ paddingTop: 18 }}>
        <a href="/">Home</a>
        <span className="sep">/</span>
        <a href="/search">Shop</a>
        <span className="sep">/</span>
        <span style={{ color: 'var(--ink)' }}>{product.name}</span>
      </div>

      <div className="pdp">
        {/* Gallery — image stubs until SP-8 derivatives are wired. */}
        <div className="pdp-gallery">
          <div
            className="pdp-main ph"
            data-label={`product · ${product.name}`}
          >
            <div className="zoom">⊕</div>
          </div>
          {thumbs.length > 1 ? (
            <div className="pdp-thumbs">
              {thumbs.map((img, i) => (
                <div
                  key={img.id}
                  className={`pdp-thumb ph${i === 0 ? ' on' : ''}`}
                  data-label={img.alt ?? '—'}
                />
              ))}
            </div>
          ) : null}
        </div>

        {/* Info */}
        <div className="pdp-info">
          {product.brand ? (
            <span
              className="brand"
              style={{ fontSize: 13, fontWeight: 600, color: 'var(--clay-deep)' }}
            >
              {product.brand}
            </span>
          ) : null}
          <h1 className="h-lg">{product.name}</h1>

          <ProductPurchasePanel
            variants={variants}
            currency={{
              code: config.currency.code,
              ...(config.currency.symbol ? { symbol: config.currency.symbol } : {}),
              locale: config.locale.default,
            }}
          />

          <div className="assur" style={{ marginTop: 14 }}>
            <span>
              <span className="dot">·</span>In stock — ready to ship
            </span>
            <span>
              <span className="dot">·</span>Carbon-neutral, plastic-free packing
            </span>
          </div>

          {product.descriptionMd ? (
            <div className="accordion" style={{ marginTop: 24 }}>
              <details className="acc-item" open>
                <summary>
                  Description <span className="pm">+</span>
                </summary>
                <div className="acc-body">
                  <RichText markdown={product.descriptionMd} />
                </div>
              </details>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
