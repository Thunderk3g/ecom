'use client';

import { useEffect, useRef, useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import { useCart } from '@/components/storefront/cart-context';

/**
 * Header cart trigger: opens the cart drawer, with a live count badge that
 * pops when the quantity changes. Rendered as a real `/cart` link so no-JS
 * visitors, middle-clicks and long-presses still reach the full cart page;
 * a normal click is intercepted to open the drawer instead.
 */
export function CartButton() {
  const { count, ready, isDrawerOpen, openDrawer } = useCart();
  const [pop, setPop] = useState(false);
  const prevCount = useRef<number | null>(null);

  useEffect(() => {
    // Skip the initial hydration (and the first count arriving from refresh)
    // so the badge doesn't pop on page load.
    if (prevCount.current === null) {
      if (ready) prevCount.current = count;
      return;
    }
    if (count !== prevCount.current) {
      prevCount.current = count;
      if (count > 0) {
        setPop(true);
        const t = window.setTimeout(() => setPop(false), 500);
        return () => window.clearTimeout(t);
      }
    }
  }, [count, ready]);

  const label =
    count > 0 ? `Cart, ${count} ${count === 1 ? 'item' : 'items'}` : 'Cart';

  return (
    <a
      href="/cart"
      className="icon-btn"
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={isDrawerOpen}
      aria-controls="cart-drawer"
      onClick={e => {
        // Plain left-click opens the drawer; modified clicks keep link behaviour.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        openDrawer();
      }}
    >
      <ShoppingBag aria-hidden />
      {count > 0 ? (
        <span className={pop ? 'cart-count pop' : 'cart-count'} aria-hidden="true">
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </a>
  );
}
