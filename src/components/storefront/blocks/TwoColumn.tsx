import type { ContentBlock } from '@/modules/cms/blocks';
import type { SiteConfig } from '@/platform.defaults';
import { Reveal } from '@/components/storefront/motion';
import { renderBlock } from '@/components/storefront/CmsBlockRenderer';

export type TwoColumnProps = {
  // Columns are nested, already-validated block arrays (see validateBlocks
  // recursion for `two-column`). Stored as unknown[] in jsonb; narrowed here.
  left: ContentBlock[];
  right: ContentBlock[];
  ratio: '1-1' | '1-2' | '2-1';
};

const RATIO_CLASS: Record<TwoColumnProps['ratio'], string> = {
  '1-1': 'hm-cols-1-1',
  '1-2': 'hm-cols-1-2',
  '2-1': 'hm-cols-2-1',
};

/**
 * Two-column container block. Each column is itself a list of CMS blocks,
 * rendered back through the dispatcher so any block kind can nest. Columns
 * reveal on scroll with a slight left→right offset and share an editorial
 * hairline divider on wide viewports (see .hm-twocol in home.css, which also
 * strips nested blocks' own section chrome).
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
    <section className="section">
      <div className="wrap-wide">
        <div className={`hm-twocol ${RATIO_CLASS[ratio]}`}>
          <Reveal className="hm-col" y={26}>
            {leftNodes}
          </Reveal>
          <Reveal className="hm-col" y={26} delay={130}>
            {rightNodes}
          </Reveal>
        </div>
      </div>
    </section>
  );
}
