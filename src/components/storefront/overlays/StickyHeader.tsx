'use client';

import { useEffect, useState, type ReactNode } from 'react';

/**
 * Sticky condensing header shell. Renders the `<header className="site-header">`
 * element (Plume owns the sticky positioning) and toggles `.is-stuck` once the
 * page scrolls past a small threshold — chrome.css condenses the padding,
 * scales the logo down and deepens the backdrop blur + shadow. Scroll handling
 * is rAF-throttled and passive.
 */
export function StickyHeader({ children }: { children: ReactNode }) {
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    let raf = 0;
    const onScroll = (): void => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setStuck(window.scrollY > 48);
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return <header className={stuck ? 'site-header is-stuck' : 'site-header'}>{children}</header>;
}
