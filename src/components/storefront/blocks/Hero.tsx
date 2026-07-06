import Link from 'next/link';
import type { Route } from 'next';
import type { CSSProperties, ReactNode } from 'react';
import { Fragment } from 'react';
import { Marquee, Parallax, Stagger } from '@/components/storefront/motion';
import { getCategoryTree } from '@/modules/catalog/categories';
import type { SiteConfig } from '@/platform.defaults';

export type HeroProps = {
  title: string;
  subtitle?: string;
  cta?: { label: string; href: string };
  image?: { assetId?: string; url?: string; alt?: string };
};

/**
 * Hero block — editorial opener. Oversized Playfair display type (one line per
 * sentence, italic accent on the closing word), staggered copy entrance,
 * parallax imagery, department chips resolved from the category tree, and a
 * serif marquee of departments along the band's base.
 *
 * `storeId`/`config` are renderer-injected (not CMS props): the chips/marquee
 * and brand eyebrow degrade gracefully when either is absent.
 */
export async function Hero({
  storeId,
  config,
  title,
  subtitle,
  cta,
  image,
}: HeroProps & { storeId?: string; config?: SiteConfig }) {
  const departments = storeId ? (await getCategoryTree(storeId)).slice(0, 6) : [];
  const imageUrl = image?.url ?? '/images/hero.png';
  const imageAlt = image?.alt ?? 'Inside the shop — stationery, sports gear and craft supplies';

  return (
    <section className="hm-hero">
      <div className="hm-hero-orb" aria-hidden />
      <div className="wrap-wide">
        <div className="hm-hero-grid">
          <Stagger className="hm-hero-copy" interval={95} y={26}>
            {config ? <span className="eyebrow">{config.brand.name}</span> : null}
            <h1 className="display hm-display">{renderAccentedTitle(title)}</h1>
            {subtitle ? <p className="lede hm-hero-lede">{subtitle}</p> : null}
            {cta ? (
              <div className="hm-hero-actions">
                <Link className="btn btn-clay btn-lg" href={cta.href as Route}>
                  {cta.label} <span className="arr" aria-hidden>→</span>
                </Link>
              </div>
            ) : null}
            {departments.length > 0 ? (
              <div className="hm-hero-chips">
                {departments.map(dept => (
                  <Link key={dept.id} className="chip" href={`/c/${dept.slug}`}>
                    {dept.name}
                  </Link>
                ))}
              </div>
            ) : null}
          </Stagger>
          <Parallax className="hm-hero-art" speed={0.16} maxOffset={44}>
            <img src={imageUrl} alt={imageAlt} fetchPriority="high" />
          </Parallax>
        </div>
      </div>
      {departments.length > 1 ? (
        <div className="hm-hero-strip">
          <Marquee
            speed={44}
            aria-label="Our departments"
            style={{ '--marquee-gap': '56px' } as CSSProperties}
          >
            {departments.map(dept => (
              <span key={dept.id} className="hm-strip-item">
                {dept.name}
                <span className="hm-strip-sep" aria-hidden>✦</span>
              </span>
            ))}
          </Marquee>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Split the title into display lines (explicit `\n` first, then sentence
 * boundaries) and italicise the final word of the last line so every CMS
 * title gets the serif-italic accent without new props.
 */
function renderAccentedTitle(title: string): ReactNode {
  const lines = title
    .split(/\n+/)
    .flatMap(part => part.match(/[^.!?]+[.!?]*/g) ?? [part])
    .map(line => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return title;

  return lines.map((line, i) => {
    const isLast = i === lines.length - 1;
    let content: ReactNode = line;
    if (isLast) {
      const words = line.split(' ');
      const tail = words[words.length - 1] ?? line;
      const head = words.slice(0, -1).join(' ');
      content = head ? (
        <>
          {head} <em>{tail}</em>
        </>
      ) : (
        <em>{line}</em>
      );
    }
    return (
      <Fragment key={i}>
        {content}
        {isLast ? null : <br />}
      </Fragment>
    );
  });
}
