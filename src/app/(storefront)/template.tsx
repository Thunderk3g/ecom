import type { ReactNode } from 'react';

/**
 * Storefront page-enter transition. Next.js remounts a route group's
 * `template.tsx` on every navigation, so the `.page-enter` CSS animation
 * (src/styles/motion.css — subtle fade + 12px rise, opacity-only under
 * reduced motion) replays on each page change. No JS needed.
 */
export default function StorefrontTemplate({ children }: { children: ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
