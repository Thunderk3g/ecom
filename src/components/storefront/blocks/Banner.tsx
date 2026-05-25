import Link from 'next/link';
import { Button } from '@/components/ui/button';

export type BannerProps = {
  image: { assetId?: string; url?: string; alt?: string };
  text?: string;
  cta?: { label: string; href: string };
};

/**
 * Banner block. Full-width image strip with an optional text overlay + CTA.
 * Uses the configured `url` as a background; the SP-8 asset pipeline can later
 * resolve `assetId` to a derivative URL.
 */
export function Banner({ image, text, cta }: BannerProps) {
  const bg = image.url;
  return (
    <section className="container py-6">
      <div
        className="relative flex min-h-[200px] items-center overflow-hidden rounded-lg border bg-brand/10"
        style={bg ? { backgroundImage: `url(${bg})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
        role="img"
        aria-label={image.alt ?? text ?? 'Banner'}
      >
        {text || cta ? (
          <div className="flex flex-col items-start gap-3 p-8">
            {text ? (
              <p className="max-w-md font-serif text-2xl font-semibold text-brand">{text}</p>
            ) : null}
            {cta ? (
              <Button asChild variant="secondary">
                <Link href={cta.href as Parameters<typeof Link>[0]['href']}>{cta.label}</Link>
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
