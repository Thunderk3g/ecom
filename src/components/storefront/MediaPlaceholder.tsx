import type { CSSProperties } from 'react';
import {
  Backpack, CircleDot, Dice5, Dumbbell, Feather, FileText, Gift,
  GraduationCap, Mail, NotebookPen, Package, Palette, Paperclip,
  PenLine, Scissors, ShoppingBasket, Trophy,
} from 'lucide-react';

/**
 * MediaPlaceholder — intentional-looking stand-in for missing catalog imagery.
 *
 * Products/categories without a photo (see `src/utils/storefront-assets.ts`)
 * render this instead of the bare `.ph` stripe block: a deterministic warm
 * duotone picked from the slug, a department-appropriate glyph, and an
 * optional caption chip. Server-safe, no CSS file — styles are inline over
 * Plume tokens so tiles inherit the surrounding card radius.
 *
 * Usage:
 *   <MediaPlaceholder label={cat.name} slug={cat.slug} />              // 4/3 tile
 *   <MediaPlaceholder label={p.name} slug={p.slug} aspect="1/1" showLabel={false} />
 */
export type MediaPlaceholderProps = {
  /** Display name, shown in the caption chip (and used as the icon/tone seed when `slug` is omitted). */
  label: string;
  /** Stable seed for tone + glyph selection, e.g. the category or product slug. */
  slug?: string;
  /** CSS aspect-ratio of the tile. Category tiles use 4/3, product plates 1/1. */
  aspect?: string;
  /** Hide the caption chip when the surrounding card already labels the tile (e.g. `.plate-cap`). */
  showLabel?: boolean;
  className?: string;
  style?: CSSProperties;
};

/** Warm duotones adjacent to the Plume paper/clay palette: [base, tint, glyph ink]. */
const TONES: [string, string, string][] = [
  ['#F2ECE0', '#E9E2D5', '#8A7A5E'], // paper
  ['#F4E9DF', '#EAD9CC', '#9A6B4F'], // clay
  ['#EBF1E7', '#DCE5D8', '#6B7F62'], // sage
  ['#E9EDF6', '#D9DEEC', '#5C6A94'], // ink
  ['#F7EEDC', '#F0E3C8', '#97803F'], // ochre
  ['#F8ECE8', '#EFDDD8', '#A06A5E'], // rose
];

/** Glyphs keyed by slug fragment; first match wins, `Package` is the fallback. */
const GLYPHS: [string, typeof Package][] = [
  ['notebook', NotebookPen],
  ['pen', PenLine],
  ['office', Paperclip],
  ['school', GraduationCap],
  ['paper', FileText],
  ['stationery', PenLine],
  ['cricket', CircleDot],
  ['badminton', Feather],
  ['fitness', Dumbbell],
  ['indoor-game', Dice5],
  ['sport', Trophy],
  ['art', Palette],
  ['craft', Scissors],
  ['gift', Gift],
  ['card', Mail],
  ['bag', Backpack],
  ['essential', ShoppingBasket],
  ['general', ShoppingBasket],
];

function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function MediaPlaceholder({
  label,
  slug,
  aspect = '4/3',
  showLabel = true,
  className,
  style,
}: MediaPlaceholderProps) {
  const seed = (slug || label).toLowerCase();
  const [base, tint, ink] = TONES[hashSeed(seed) % TONES.length]!;
  const Glyph = GLYPHS.find(([key]) => seed.includes(key))?.[1] ?? Package;

  return (
    <div
      role="img"
      aria-label={label}
      className={className}
      style={{
        aspectRatio: aspect,
        width: '100%',
        display: 'grid',
        placeItems: 'center',
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 'inherit',
        background: [
          'radial-gradient(120% 90% at 20% 0%, rgba(255,255,255,.5), transparent 55%)',
          `repeating-linear-gradient(135deg, ${tint} 0 14px, transparent 14px 28px)`,
          base,
        ].join(', '),
        ...style,
      }}
    >
      <Glyph
        aria-hidden
        strokeWidth={1.25}
        style={{ width: '26%', height: '26%', maxWidth: 96, maxHeight: 96, color: ink, opacity: 0.55 }}
      />
      {showLabel ? (
        <span
          style={{
            position: 'absolute',
            bottom: 12,
            fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
            fontSize: 11,
            letterSpacing: '.14em',
            textTransform: 'uppercase',
            color: ink,
            background: 'rgba(255,255,255,.62)',
            border: '1px solid rgba(255,255,255,.72)',
            padding: '6px 12px',
            borderRadius: 999,
            backdropFilter: 'blur(2px)',
          }}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
}
