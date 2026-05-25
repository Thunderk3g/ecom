import Link from 'next/link';
import { Button } from '@/components/ui/button';

export type HeroProps = {
  title: string;
  subtitle?: string;
  cta?: { label: string; href: string };
  image?: { assetId?: string; url?: string; alt?: string };
};

/**
 * Hero block. Full-bleed banner with title, optional subtitle and CTA. The
 * image is rendered as a background stub (asset pipeline / `url`) so the block
 * works before SP-8 derivatives are wired.
 */
export function Hero({ title, subtitle, cta, image }: HeroProps) {
  const bg = image?.url;
  return (
    <section
      className="relative overflow-hidden border-b bg-brand/5"
      style={bg ? { backgroundImage: `url(${bg})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
    >
      <div className="container flex flex-col items-start gap-4 py-20 md:py-28">
        <h1 className="max-w-2xl font-serif text-4xl font-semibold tracking-tight text-brand md:text-5xl">
          {title}
        </h1>
        {subtitle ? (
          <p className="max-w-xl text-lg text-muted-foreground">{subtitle}</p>
        ) : null}
        {cta ? (
          <Button asChild size="lg" className="mt-2">
            <Link href={cta.href as Parameters<typeof Link>[0]['href']}>{cta.label}</Link>
          </Button>
        ) : null}
      </div>
    </section>
  );
}
