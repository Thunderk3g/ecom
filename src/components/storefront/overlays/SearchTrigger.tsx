'use client';

import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { useChrome } from './chrome-context';

/**
 * Opens the search overlay. Two visual variants:
 *
 * - `"field"` (default) — a search-input-lookalike button with placeholder
 *   text and a ⌘K / Ctrl K keyboard hint, for the desktop header.
 * - `"icon"` — a compact icon button (`.icon-btn`), shown in the header icon
 *   cluster on small screens (pair with the `.so-icon-mobile` class).
 *
 * The Ctrl/Cmd+K binding itself lives in `ChromeProvider`.
 */
export function SearchTrigger({
  variant = 'field',
  className,
}: {
  variant?: 'field' | 'icon';
  className?: string;
}) {
  const { searchOpen, openSearch } = useChrome();
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(/mac|iphone|ipad/i.test(navigator.platform));
  }, []);

  const aria = {
    'aria-haspopup': 'dialog' as const,
    'aria-expanded': searchOpen,
    'aria-controls': 'search-overlay',
  };

  if (variant === 'icon') {
    return (
      <button
        type="button"
        className={['icon-btn', className ?? ''].filter(Boolean).join(' ')}
        onClick={openSearch}
        {...aria}
      >
        <Search aria-hidden />
        <span className="sr-only">Search</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      className={['search', 'so-trigger', className ?? ''].filter(Boolean).join(' ')}
      onClick={openSearch}
      {...aria}
    >
      <Search aria-hidden />
      <span className="so-trigger-label">Search the catalogue…</span>
      <kbd className="so-kbd" aria-hidden="true">
        {isMac ? '⌘K' : 'Ctrl K'}
      </kbd>
    </button>
  );
}
