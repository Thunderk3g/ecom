'use client';

import { useEffect, useState } from 'react';

/**
 * `usePrefersReducedMotion` — reactive `prefers-reduced-motion: reduce` flag.
 *
 * Returns `false` on the server and during the first client render (so SSR and
 * hydration markup match), then reflects the live media query. Components that
 * drive JS animation (Parallax, AnimatedNumber, Marquee measurement) use this
 * to collapse motion to a static/instant presentation. Pure-CSS effects handle
 * the same preference in stylesheets via `@media (prefers-reduced-motion: …)`.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (): void => setReduced(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  return reduced;
}
