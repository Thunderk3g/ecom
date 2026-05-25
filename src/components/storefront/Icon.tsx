import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Storefront `<Icon>` (SP-8).
 *
 * Renders a symbol from the per-store SVG sprite produced by
 * `buildSpriteForStore` (admin → Assets → Rebuild SVG sprite). The sprite lives
 * at `/sprites/icons-<storeSlug>.svg`, and each asset is packed as a
 * `<symbol id="<slug>">…</symbol>` — so the component just emits
 * `<svg><use href="/sprites/icons-<slug>.svg#<name>"/></svg>`.
 *
 * `storeSlug` is a required prop because wiring it through React context from
 * the storefront layout would tangle this lightweight component with tenant
 * resolution; pages already have access to the resolved store and can pass it
 * down explicitly.
 */
export interface IconProps extends React.SVGAttributes<SVGSVGElement> {
  /** Symbol id within the sprite (e.g. "cart", "search", "menu"). */
  name: string;
  /** Slug of the current store, used to address the per-store sprite. */
  storeSlug: string;
  /** Accessible label. When omitted the svg is marked aria-hidden for decoration. */
  title?: string;
}

export function Icon({
  name,
  storeSlug,
  title,
  className,
  width = 24,
  height = 24,
  ...rest
}: IconProps) {
  const href = `/sprites/icons-${storeSlug}.svg#${name}`;
  const ariaHidden = title ? undefined : true;
  return (
    <svg
      className={cn('inline-block fill-current', className)}
      width={width}
      height={height}
      role={title ? 'img' : undefined}
      aria-hidden={ariaHidden}
      aria-label={title}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      <use href={href} />
    </svg>
  );
}
