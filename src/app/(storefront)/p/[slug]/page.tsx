import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Banknote, RotateCcw, Truck } from 'lucide-react';
import { getProductBySlug, getProductById, listProducts } from '@/modules/catalog/products';
import { getCategoryTree, type CategoryNode } from '@/modules/catalog/categories';
import { expandBundle } from '@/modules/catalog/bundles';
import { getVariantById } from '@/modules/catalog/variants';
import { RichText } from '@/components/storefront/blocks/RichText';
import {
  ProductPurchasePanel,
  type PurchaseVariant,
} from '@/components/storefront/ProductPurchasePanel';
import { ProductGallery } from '@/components/storefront/ProductGallery';
import { ProductCard } from '@/components/storefront/ProductCard';
import { MediaPlaceholder } from '@/components/storefront/MediaPlaceholder';
import { PdpAccordions, type PdpAccordionItem } from '@/components/storefront/PdpAccordions';
import { Reveal, Stagger } from '@/components/storefront/motion';
import { humanizeAxisKey, humanizeAxisValue } from '@/components/storefront/pdp-format';
import { getStoreContext } from '../../_lib/context';
import { loadProductDisplays } from '../../_lib/product-pricing';
import { getProductThumbnails, getProductImage } from '@/utils/storefront-assets';

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

/** Locate a category node and its parent inside the published tree. */
function findCategory(
  nodes: CategoryNode[],
  id: string,
  parent: CategoryNode | null = null,
): { node: CategoryNode; parent: CategoryNode | null } | null {
  for (const node of nodes) {
    if (node.id === id) return { node, parent };
    const hit = findCategory(node.children, id, node);
    if (hit) return hit;
  }
  return null;
}

type BundleItem = {
  name: string;
  slug: string;
  qty: number;
  axes: Record<string, string | number>;
  image: string | null;
};

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

  const images = getProductThumbnails(product.slug);

  // Breadcrumb trail: Home / {parent?} / {category} / {name}.
  let crumbCategory: CategoryNode | null = null;
  let crumbParent: CategoryNode | null = null;
  if (product.categoryId) {
    const tree = await getCategoryTree(storeId);
    const hit = findCategory(tree, product.categoryId);
    if (hit) {
      crumbCategory = hit.node;
      crumbParent = hit.parent;
    }
  }

  // Bundle contents ("What's inside") via the existing bundle module reads.
  let bundleItems: BundleItem[] = [];
  if (product.type === 'bundle') {
    const bundleVariant =
      product.variants.find(v => v.status === 'active') ?? product.variants[0];
    if (bundleVariant) {
      const components = await expandBundle(storeId, bundleVariant.id);
      const resolved = await Promise.all(
        components.map(async component => {
          const variant = await getVariantById(storeId, component.componentVariantId);
          if (!variant) return null;
          const componentProduct = await getProductById(storeId, variant.productId);
          if (!componentProduct) return null;
          return {
            name: componentProduct.name,
            slug: componentProduct.slug,
            qty: component.qty,
            axes: variant.axes,
            image: getProductImage(componentProduct.slug),
          } satisfies BundleItem;
        }),
      );
      bundleItems = resolved.filter((item): item is BundleItem => item !== null);
    }
  }

  // Related rail: more from the same category (excluding this product).
  const related =
    product.categoryId !== null
      ? await (async () => {
          const result = await listProducts(storeId, {
            categoryId: product.categoryId as string,
            status: 'active',
            limit: 8,
          });
          const others = result.items.filter(p => p.id !== product.id).slice(0, 4);
          return loadProductDisplays(storeId, others);
        })()
      : [];

  // Details accordion rows: brand + humanized product attributes.
  const specRows: [string, string][] = [];
  if (product.brand) specRows.push(['Brand', product.brand]);
  for (const [key, value] of Object.entries(product.attributes ?? {})) {
    if (value === null || value === undefined || value === '') continue;
    specRows.push([humanizeAxisKey(key), humanizeAxisValue(value)]);
  }
  if (product.type === 'bundle') specRows.push(['Type', 'Curated kit']);

  const accordionItems: PdpAccordionItem[] = [];
  if (product.descriptionMd) {
    accordionItems.push({
      id: 'description',
      title: 'Description',
      body: (
        <div className="pdp-richtext">
          <RichText markdown={product.descriptionMd} />
        </div>
      ),
    });
  }
  if (specRows.length > 0) {
    accordionItems.push({
      id: 'details',
      title: 'Details & specs',
      body: (
        <table className="pdp-spec">
          <tbody>
            {specRows.map(([label, value]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ),
    });
  }
  accordionItems.push({
    id: 'shipping',
    title: 'Shipping & returns',
    body: (
      <ul className="pdp-policy-list">
        <li>Dispatched within 24–48 hours from our Mumbai store.</li>
        <li>
          Free shipping on orders over ₹999 — see{' '}
          <Link href="/pages/shipping" className="underline-slide">
            shipping details
          </Link>
          .
        </li>
        <li>Cash on Delivery available on orders up to ₹5,000.</li>
        <li>
          7-day easy returns on unused items — see{' '}
          <Link href="/pages/returns" className="underline-slide">
            returns policy
          </Link>
          .
        </li>
      </ul>
    ),
  });

  return (
    <main className="wrap-wide pdp-page">
      <nav className="crumbs" aria-label="Breadcrumb" style={{ paddingTop: 18 }}>
        <Link href="/">Home</Link>
        {crumbParent ? (
          <>
            <span className="sep">/</span>
            <Link href={`/c/${crumbParent.slug}`}>{crumbParent.name}</Link>
          </>
        ) : null}
        {crumbCategory ? (
          <>
            <span className="sep">/</span>
            <Link href={`/c/${crumbCategory.slug}`}>{crumbCategory.name}</Link>
          </>
        ) : (
          <>
            <span className="sep">/</span>
            <Link href="/search">Shop</Link>
          </>
        )}
        <span className="sep">/</span>
        <span aria-current="page" style={{ color: 'var(--ink)' }}>
          {product.name}
        </span>
      </nav>

      <div className="pdp-layout">
        {/* Gallery (left) */}
        <div className="pdp-a-gallery">
          <ProductGallery productName={product.name} slug={product.slug} images={images} />
        </div>

        {/* Purchase panel (right, sticky) */}
        <div className="pdp-a-info pdp-info">
          {product.brand ? <span className="eyebrow">{product.brand}</span> : null}
          <h1 className="h-lg">{product.name}</h1>
          {product.type === 'bundle' ? (
            <span className="badge badge-soft pdp-kit-badge">Curated kit</span>
          ) : null}

          <ProductPurchasePanel
            product={{ name: product.name, slug: product.slug }}
            variants={variants}
            currency={{
              code: config.currency.code,
              ...(config.currency.symbol ? { symbol: config.currency.symbol } : {}),
              locale: config.locale.default,
            }}
          />

          {/* Trust & policy row */}
          <div className="pdp-trust">
            <Link href="/pages/shipping" className="pdp-trust-item">
              <Truck aria-hidden size={17} strokeWidth={1.6} />
              <span>
                <strong>Free shipping</strong>
                <em>on orders over ₹999</em>
              </span>
            </Link>
            <Link href="/pages/shipping" className="pdp-trust-item">
              <Banknote aria-hidden size={17} strokeWidth={1.6} />
              <span>
                <strong>Cash on Delivery</strong>
                <em>available up to ₹5,000</em>
              </span>
            </Link>
            <Link href="/pages/returns" className="pdp-trust-item">
              <RotateCcw aria-hidden size={17} strokeWidth={1.6} />
              <span>
                <strong>7-day returns</strong>
                <em>easy &amp; no-fuss</em>
              </span>
            </Link>
          </div>
        </div>

        {/* Below-the-fold detail (left column, under the gallery) */}
        <div className="pdp-a-detail">
          {bundleItems.length > 0 ? (
            <Reveal as="section" className="pdp-bundle" y={18}>
              <h2 className="h-md pdp-sec-title">What&rsquo;s inside</h2>
              <ul className="pdp-bundle-list">
                {bundleItems.map(item => (
                  <li key={`${item.slug}-${item.name}`} className="pdp-bundle-item">
                    <Link href={`/p/${item.slug}`} className="pdp-bundle-link hover-lift">
                      <span className="pdp-bundle-thumb">
                        {item.image ? (
                          <img src={item.image} alt="" loading="lazy" />
                        ) : (
                          <MediaPlaceholder
                            label={item.name}
                            slug={item.slug}
                            aspect="1/1"
                            showLabel={false}
                          />
                        )}
                      </span>
                      <span className="pdp-bundle-main">
                        <span className="pdp-bundle-name">{item.name}</span>
                        {Object.keys(item.axes).length > 0 ? (
                          <span className="meta">
                            {Object.values(item.axes).map(humanizeAxisValue).join(' · ')}
                          </span>
                        ) : null}
                      </span>
                      <span className="badge badge-soft">× {item.qty}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Reveal>
          ) : null}

          <PdpAccordions
            items={accordionItems}
            defaultOpenId={accordionItems[0]?.id ?? null}
          />
        </div>
      </div>

      {/* Related rail */}
      {related.length > 0 ? (
        <Reveal as="section" className="pdp-related" y={26}>
          <div className="between pdp-related-head">
            <h2 className="h-md">
              More from {crumbCategory ? crumbCategory.name : 'the shop'}
            </h2>
            {crumbCategory ? (
              <Link href={`/c/${crumbCategory.slug}`} className="ucap link-u muted">
                View all
              </Link>
            ) : null}
          </div>
          <Stagger className="pgrid pdp-related-grid" interval={90}>
            {related.map(display => (
              <div key={display.product.id} className="hover-lift pdp-related-card">
                <ProductCard display={display} config={config} />
              </div>
            ))}
          </Stagger>
        </Reveal>
      ) : null}
    </main>
  );
}
