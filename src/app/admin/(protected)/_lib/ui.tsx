import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

/** Standard page heading with an optional action slot on the right. */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/**
 * "Load more" / next-page link for cursor-paginated lists. Renders nothing when
 * there is no next cursor. `basePath` is the current route; `params` carries any
 * active filters that must survive the page hop.
 */
export function CursorPager({
  basePath,
  nextCursor,
  params = {},
}: {
  basePath: string;
  nextCursor: string | null;
  params?: Record<string, string | undefined>;
}) {
  if (!nextCursor) return null;
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') search.set(k, v);
  }
  search.set('after', nextCursor);
  const href = `${basePath}?${search.toString()}`;
  return (
    <div className="flex justify-center pt-4">
      <Button asChild variant="outline" size="sm">
        <Link href={href as Parameters<typeof Link>[0]['href']}>Load more</Link>
      </Button>
    </div>
  );
}
