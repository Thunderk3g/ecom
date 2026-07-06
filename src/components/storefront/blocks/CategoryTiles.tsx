import Link from 'next/link';
import type { Route } from 'next';
import { Reveal, Stagger } from '@/components/storefront/motion';
import { MediaPlaceholder } from '@/components/storefront/MediaPlaceholder';
import { getCategoryImage } from '@/utils/storefront-assets';

/**
 * CategoryTiles — shared presentational mosaic used by the
 * `featured-categories` CMS block and the fallback homepage. Not a CMS block
 * itself. Renders a section header (eyebrow + heading + view-all) and an
 * asymmetric department grid: the first tile is hero-sized (2×2, media fills,
 * caption over a scrim), the rest are satellites. Tiles without imagery get
 * the shared MediaPlaceholder treated as first-class art.
 */
export type CategoryTileData = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  childNames?: string[];
};

export function CategoryTiles({
  eyebrow,
  heading,
  viewAllHref = '/search',
  viewAllLabel = 'Browse everything',
  tiles,
}: {
  eyebrow?: string;
  heading?: string;
  viewAllHref?: string;
  viewAllLabel?: string;
  tiles: CategoryTileData[];
}) {
  if (tiles.length === 0) return null;
  // The asymmetric layout needs satellites to balance the lead tile.
  const hasLead = tiles.length >= 3;

  return (
    <>
      <Reveal className="hm-head" y={22}>
        <div>
          {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
          {heading ? <h2 className="h-lg hm-head-title">{heading}</h2> : null}
        </div>
        <Link className="hm-viewall underline-slide hide-sm" href={viewAllHref as Route}>
          {viewAllLabel} <span aria-hidden>→</span>
        </Link>
      </Reveal>
      <Stagger className="hm-cats" interval={90} y={24}>
        {tiles.map((tile, i) => (
          <CategoryTile key={tile.id} tile={tile} lead={hasLead && i === 0} />
        ))}
      </Stagger>
    </>
  );
}

function CategoryTile({ tile, lead }: { tile: CategoryTileData; lead: boolean }) {
  const imageSrc = getCategoryImage(tile.slug);
  const childCount = tile.childNames?.length ?? 0;

  return (
    <Link href={`/c/${tile.slug}`} className={`hm-cat hover-lift${lead ? ' is-lead' : ''}`}>
      <div className="hm-cat-media">
        {imageSrc ? (
          <img src={imageSrc} alt="" loading="lazy" />
        ) : (
          <MediaPlaceholder
            label={tile.name}
            slug={tile.slug}
            showLabel={false}
            aspect="auto"
            style={{ height: '100%' }}
          />
        )}
      </div>
      {lead ? (
        <div className="hm-cat-lead-cap">
          <h3 className="hm-cat-lead-name">{tile.name}</h3>
          {childCount > 0 ? (
            <p className="hm-cat-lead-sub">{tile.childNames!.slice(0, 3).join(' · ')}</p>
          ) : tile.description ? (
            <p className="hm-cat-lead-sub">{tile.description}</p>
          ) : null}
          <span className="ucap hm-cat-go">
            Shop now <span aria-hidden>→</span>
          </span>
        </div>
      ) : (
        <div className="hm-cat-cap">
          <span className="hm-cat-name">{tile.name}</span>
          {childCount > 0 ? (
            <span className="meta">
              {childCount} {childCount === 1 ? 'line' : 'lines'}
            </span>
          ) : (
            <span className="ucap hm-cat-arr" aria-hidden>→</span>
          )}
        </div>
      )}
    </Link>
  );
}
