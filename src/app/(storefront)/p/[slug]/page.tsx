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

  return (
    <div className="container py-10">
      <div className="grid gap-10 md:grid-cols-2">
        {/* Gallery — image stubs until SP-8 derivatives are wired. */}
        <div className="space-y-4">
          <div className="flex aspect-square items-center justify-center rounded-lg border bg-muted">
            <span className="font-serif text-6xl text-muted-foreground/30">
              {product.name.slice(0, 1).toUpperCase()}
            </span>
          </div>
          {product.images.length > 1 ? (
            <div className="grid grid-cols-4 gap-2">
              {product.images.slice(0, 4).map(img => (
                <div
                  key={img.id}
                  className="flex aspect-square items-center justify-center rounded-md border bg-muted text-xs text-muted-foreground/40"
                >
                  {img.alt ?? '—'}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="space-y-6">
          {product.brand ? (
            <span className="text-sm uppercase tracking-wide text-muted-foreground">
              {product.brand}
            </span>
          ) : null}
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-brand">
            {product.name}
          </h1>

          <ProductPurchasePanel
            variants={variants}
            currency={{
              code: config.currency.code,
              ...(config.currency.symbol ? { symbol: config.currency.symbol } : {}),
              locale: config.locale.default,
            }}
          />
        </div>
      </div>

      {product.descriptionMd ? (
        <div className="mt-12 border-t pt-8">
          <RichText markdown={product.descriptionMd} />
        </div>
      ) : null}
    </div>
  );
}
