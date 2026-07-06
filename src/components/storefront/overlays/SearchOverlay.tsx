'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Clock, Search, X } from 'lucide-react';
import { useSearchSuggestions } from '@/components/storefront/SearchBox';
import { useChrome } from './chrome-context';
import { useOverlay } from './overlay-utils';

/**
 * Full search overlay — drops from under the header (full-width panel), opened
 * by the header search trigger or Ctrl/Cmd+K.
 *
 * - Big autofocused input with debounced live suggestions (same hook as the
 *   inline SearchBox).
 * - ↑/↓ + Enter keyboard navigation over suggestions; plain Enter submits the
 *   raw query.
 * - Recent searches persisted in localStorage (max 5, clearable).
 * - Quick links to the five departments.
 * - Escape / scrim click closes; focus returns to the trigger.
 */

const RECENT_KEY = 'storefront.recentSearches.v1';
const RECENT_CAP = 5;

const DEPARTMENTS: { label: string; href: string }[] = [
  { label: 'Stationery', href: '/c/stationery' },
  { label: 'Sports', href: '/c/sports' },
  { label: 'Art & Craft', href: '/c/art-craft' },
  { label: 'Gifting', href: '/c/gifting' },
  { label: 'General', href: '/c/general' },
];

function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveRecent(term: string): string[] {
  const next = [term, ...readRecent().filter(t => t !== term)].slice(0, RECENT_CAP);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* private mode — non-fatal */
  }
  return next;
}

export function SearchOverlay() {
  const { searchOpen, closeSearch } = useChrome();
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [recent, setRecent] = useState<string[]>([]);
  const { suggestions } = useSearchSuggestions(query);

  useOverlay({ open: searchOpen, onClose: closeSearch, panelRef, initialFocusRef: inputRef });

  // Fresh state every time the overlay opens.
  useEffect(() => {
    if (searchOpen) {
      setQuery('');
      setActiveIndex(-1);
      setRecent(readRecent());
    }
  }, [searchOpen]);

  // Reset keyboard cursor whenever the suggestion list changes.
  useEffect(() => {
    setActiveIndex(-1);
  }, [suggestions]);

  function submit(raw: string): void {
    const term = raw.trim();
    if (!term) return;
    setRecent(saveRecent(term));
    closeSearch();
    router.push(`/search?q=${encodeURIComponent(term)}`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => (suggestions.length === 0 ? -1 : (i + 1) % suggestions.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i =>
        suggestions.length === 0 ? -1 : (i - 1 + suggestions.length) % suggestions.length,
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const active = activeIndex >= 0 ? suggestions[activeIndex] : undefined;
      submit(active ? active.name : query);
    }
  }

  function clearRecent(): void {
    try {
      window.localStorage.removeItem(RECENT_KEY);
    } catch {
      /* ignore */
    }
    setRecent([]);
  }

  const showSuggestions = query.trim().length >= 2;

  return (
    <>
      <div
        className={searchOpen ? 'overlay-scrim open' : 'overlay-scrim'}
        onClick={closeSearch}
        aria-hidden="true"
      />
      <div
        id="search-overlay"
        ref={panelRef}
        className={searchOpen ? 'so-panel open' : 'so-panel'}
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        inert={!searchOpen}
      >
        <div className="so-inner">
          <div className="so-bar">
            <Search aria-hidden />
            <label className="sr-only" htmlFor="so-input">
              Search products
            </label>
            <input
              id="so-input"
              ref={inputRef}
              className="so-input"
              type="search"
              placeholder="What are you looking for?"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              role="combobox"
              aria-expanded={showSuggestions && suggestions.length > 0}
              aria-controls="so-suggestions"
              aria-activedescendant={activeIndex >= 0 ? `so-opt-${activeIndex}` : undefined}
              autoComplete="off"
            />
            <button type="button" className="icon-btn so-close" onClick={closeSearch}>
              <X aria-hidden />
              <span className="sr-only">Close search</span>
            </button>
          </div>

          {showSuggestions ? (
            suggestions.length > 0 ? (
              <ul id="so-suggestions" className="so-suggest" role="listbox" aria-label="Suggestions">
                {suggestions.map((s, i) => (
                  <li
                    key={s.productId}
                    id={`so-opt-${i}`}
                    role="option"
                    aria-selected={i === activeIndex}
                    className={i === activeIndex ? 'is-active' : undefined}
                  >
                    <button
                      type="button"
                      onClick={() => submit(s.name)}
                      onMouseMove={() => setActiveIndex(i)}
                    >
                      <Search aria-hidden />
                      {s.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="so-empty">
                No matches yet — press Enter to search everything for &ldquo;{query.trim()}&rdquo;.
              </p>
            )
          ) : (
            <>
              {recent.length > 0 ? (
                <div className="so-section">
                  <div className="so-section-head">
                    <span className="eyebrow muted">Recent searches</span>
                    <button type="button" className="so-clear" onClick={clearRecent}>
                      Clear
                    </button>
                  </div>
                  <div className="so-chips">
                    {recent.map(term => (
                      <button
                        key={term}
                        type="button"
                        className="chip"
                        onClick={() => submit(term)}
                      >
                        <Clock aria-hidden style={{ width: 13, height: 13 }} />
                        {term}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="so-section">
                <div className="so-section-head">
                  <span className="eyebrow muted">Browse departments</span>
                </div>
                <div className="so-chips">
                  {DEPARTMENTS.map(dept => (
                    <Link
                      key={dept.href}
                      href={dept.href as Parameters<typeof Link>[0]['href']}
                      className="chip"
                      onClick={closeSearch}
                    >
                      {dept.label}
                    </Link>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
