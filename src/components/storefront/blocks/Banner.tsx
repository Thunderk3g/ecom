import Link from 'next/link';
import type { Route } from 'next';
import { Parallax, Reveal } from '@/components/storefront/motion';

export type BannerProps = {
  image: { assetId?: string; url?: string; alt?: string };
  text?: string;
  cta?: { label: string; href: string };
};

/**
 * Banner block — full-bleed parallax band. The image drifts gently behind an
 * ink→clay duotone scrim; the message is set as a large serif line with a
 * paper-coloured CTA. Falls back to a plain ink band when no image URL is
 * configured (assetId-only refs resolve after SP-8).
 */
export function Banner({ image, text, cta }: BannerProps) {
  const src = image.url;

  return (
    <section className="hm-banner">
      {src ? (
        <Parallax className="hm-banner-media" speed={0.18} maxOffset={56}>
          {/* Overlaid text carries the message; expose the CMS alt only when the image stands alone. */}
          <img src={src} alt={text || cta ? '' : image.alt ?? ''} loading="lazy" />
        </Parallax>
      ) : null}
      <div className="hm-banner-scrim" aria-hidden />
      <div className="wrap-wide">
        <Reveal className="hm-banner-inner" y={30}>
          {text ? <p className="hm-banner-text">{text}</p> : null}
          {cta ? (
            <Link className="btn hm-btn-paper btn-lg" href={cta.href as Route}>
              {cta.label} <span className="arr" aria-hidden>→</span>
            </Link>
          ) : null}
        </Reveal>
      </div>
    </section>
  );
}
