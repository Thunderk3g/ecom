import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatMoney } from '@/app/(storefront)/_lib/money';
import type { ProductDisplay } from '@/app/(storefront)/_lib/product-pricing';
import type { SiteConfig } from '@/platform.defaults';

/**
 * Storefront product card. Image is a themed placeholder until SP-8 derivatives
 * are wired. Price shows the lowest active-variant price ("from") with an
 * optional compare-at strike-through.
 */
export function ProductCard({
  display,
  config,
}: {
  display: ProductDisplay;
  config: Pick<SiteConfig, 'currency' | 'locale'>;
}) {
  const { product, fromCents, compareAtCents } = display;
  const onSale = fromCents !== null && compareAtCents !== null && compareAtCents > fromCents;

  return (
    <Link href={`/p/${product.slug}`} className="group block">
      <Card className="h-full overflow-hidden transition-shadow hover:shadow-md">
        <div className="flex aspect-square items-center justify-center bg-muted">
          <span className="font-serif text-3xl text-muted-foreground/40">
            {product.name.slice(0, 1).toUpperCase()}
          </span>
        </div>
        <CardContent className="space-y-1 p-4">
          {product.brand ? (
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {product.brand}
            </span>
          ) : null}
          <h3 className="line-clamp-2 text-sm font-medium group-hover:text-brand">
            {product.name}
          </h3>
          {fromCents !== null ? (
            <div className="flex items-center gap-2 pt-1">
              <span className="font-semibold">{formatMoney(fromCents, config)}</span>
              {onSale ? (
                <>
                  <span className="text-xs text-muted-foreground line-through">
                    {formatMoney(compareAtCents, config)}
                  </span>
                  <Badge variant="secondary" className="text-[10px]">
                    Sale
                  </Badge>
                </>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </Link>
  );
}
