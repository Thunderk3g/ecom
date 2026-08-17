import type { ContentBlock } from '@/modules/cms/blocks';
import { resolveBlockAssets } from '@/modules/cms/resolve-assets';
import type { SiteConfig } from '@/platform.defaults';
import { logger } from '@/lib/logger';
import { Hero, type HeroProps } from './blocks/Hero';
import { FeaturedCategories, type FeaturedCategoriesProps } from './blocks/FeaturedCategories';
import { ProductGrid, type ProductGridProps } from './blocks/ProductGrid';
import { Banner, type BannerProps } from './blocks/Banner';
import { RichText, type RichTextProps } from './blocks/RichText';
import { Testimonials, type TestimonialsProps } from './blocks/Testimonials';
import { Newsletter, type NewsletterProps } from './blocks/Newsletter';
import { TwoColumn, type TwoColumnProps } from './blocks/TwoColumn';

/**
 * CMS block dispatcher (server component). Maps each published block's `kind`
 * to its renderer. Blocks were already validated against BLOCK_REGISTRY at
 * write time; if a stored block fails to render (schema drift, etc.) we log a
 * warning and skip it rather than 500 the whole page (plan §Risks #2).
 */
export async function CmsBlockRenderer({
  storeId,
  config,
  blocks,
}: {
  storeId: string;
  config: SiteConfig;
  blocks: ContentBlock[];
}) {
  // Turn `image.assetId` references into concrete `image.url`s before dispatch.
  // Done here rather than per-component so every image-bearing block (and every
  // nested two-column column) is covered by one pass and one query.
  const resolved = await resolveBlockAssets(storeId, blocks);
  const rendered = await Promise.all(
    resolved.map((block, i) => renderBlock(storeId, config, block, i)),
  );
  return <>{rendered}</>;
}

export async function renderBlock(
  storeId: string,
  config: SiteConfig,
  block: ContentBlock,
  key: number,
) {
  try {
    switch (block.kind) {
      case 'hero':
        // storeId/config are renderer-injected (like featured-categories) so
        // the hero can resolve department chips + brand eyebrow; they are not
        // part of the CMS-validated props.
        return (
          <Hero
            key={key}
            storeId={storeId}
            config={config}
            {...(block.props as unknown as HeroProps)}
          />
        );
      case 'featured-categories':
        return (
          <FeaturedCategories
            key={key}
            storeId={storeId}
            {...(block.props as unknown as FeaturedCategoriesProps)}
          />
        );
      case 'product-grid':
        return (
          <ProductGrid
            key={key}
            storeId={storeId}
            config={config}
            {...(block.props as unknown as ProductGridProps)}
          />
        );
      case 'banner':
        return <Banner key={key} {...(block.props as unknown as BannerProps)} />;
      case 'rich-text':
        return <RichText key={key} {...(block.props as unknown as RichTextProps)} />;
      case 'testimonials':
        return <Testimonials key={key} {...(block.props as unknown as TestimonialsProps)} />;
      case 'newsletter':
        return <Newsletter key={key} {...(block.props as unknown as NewsletterProps)} />;
      case 'two-column':
        return (
          <TwoColumn
            key={key}
            storeId={storeId}
            config={config}
            {...(block.props as unknown as TwoColumnProps)}
          />
        );
      default:
        return null;
    }
  } catch (err) {
    logger.warn({ err, kind: block.kind, storeId }, 'cms: skipped block that failed to render');
    return null;
  }
}
