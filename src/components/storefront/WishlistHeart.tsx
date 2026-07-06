'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Wishlist heart toggle for product cards. Client-only, no backend: saved
 * slugs persist in localStorage under `mahaveer:wishlist`. Renders the Plume
 * `.heart` pill (absolutely positioned over the card plate); the filled state
 * and pop animation live in `src/styles/listing.css`.
 */
const WISHLIST_KEY = 'mahaveer:wishlist';

function readWishlist(): string[] {
  try {
    const raw = window.localStorage.getItem(WISHLIST_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

export function WishlistHeart({ slug, name }: { slug: string; name: string }) {
  const [saved, setSaved] = useState(false);
  const [pop, setPop] = useState(false);

  // Hydrate from storage after mount (SSR renders the unsaved state).
  useEffect(() => {
    setSaved(readWishlist().includes(slug));
  }, [slug]);

  const toggle = useCallback(() => {
    setSaved(prev => {
      const next = !prev;
      try {
        const list = readWishlist().filter(s => s !== slug);
        if (next) list.unshift(slug);
        window.localStorage.setItem(WISHLIST_KEY, JSON.stringify(list));
      } catch {
        /* storage unavailable (private mode) — keep in-memory state only */
      }
      return next;
    });
    setPop(true);
  }, [slug]);

  return (
    <button
      type="button"
      className={`heart${saved ? ' is-saved' : ''}${pop ? ' pop' : ''}`}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${name} from wishlist` : `Save ${name} to wishlist`}
      onClick={toggle}
      onAnimationEnd={() => setPop(false)}
    >
      <svg
        viewBox="0 0 24 24"
        width="16"
        height="16"
        aria-hidden="true"
        fill={saved ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
      </svg>
    </button>
  );
}
