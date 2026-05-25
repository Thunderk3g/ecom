import type { ContentBlock } from '@/modules/cms/blocks';
import type { SiteConfig } from '@/platform.defaults';
import { renderBlock } from '@/components/storefront/CmsBlockRenderer';

export type TwoColumnProps = {
  // Columns are nested, already-validated block arrays (see validateBlocks
  // recursion for `two-column`). Stored as unknown[] in jsonb; narrowed here.
  left: ContentBlock[];
  right: ContentBlock[];
  ratio: '1-1' | '1-2' | '2-1';
};

const RATIO_CLASS: Record<TwoColumnProps['ratio'], string> = {
  '1-1': 'md:grid-cols-2',
  '1-2': 'md:grid-cols-[1fr_2fr]',
  '2-1': 'md:grid-cols-[2fr_1fr]',
};

/**
 * Two-column container block. Each column is itself a list of CMS blocks,
 * rendered back through the dispatcher so any block kind can nest.
 */
export async function TwoColumn({
  storeId,
  config,
  left,
  right,
  ratio,
}: TwoColumnProps & { storeId: string; config: SiteConfig }) {
  const [leftNodes, rightNodes] = await Promise.all([
    Promise.all(left.map((b, i) => renderBlock(storeId, config, b, i))),
    Promise.all(right.map((b, i) => renderBlock(storeId, config, b, i))),
  ]);

  return (
    <section className="container py-8">
      <div className={`grid grid-cols-1 gap-8 ${RATIO_CLASS[ratio]}`}>
        <div>{leftNodes}</div>
        <div>{rightNodes}</div>
      </div>
    </section>
  );
}
