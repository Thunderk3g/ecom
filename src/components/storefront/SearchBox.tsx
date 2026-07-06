'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';

export type Suggestion = { term: string; productId: string; name: string };

/**
 * Debounced typeahead suggestions from `/api/v1/catalog/search?suggest=1`.
 *
 * Shared by the inline `SearchBox` (search results page) and the full
 * `SearchOverlay` (header). Queries shorter than `minLength` clear the list;
 * in-flight requests are aborted on every keystroke.
 */
export function useSearchSuggestions(
  query: string,
  { minLength = 2, delay = 200 }: { minLength?: number; delay?: number } = {},
): { suggestions: Suggestion[]; loading: boolean } {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < minLength) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const t = setTimeout(() => {
      void fetch(`/api/v1/catalog/search?suggest=1&q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
      })
        .then(res => (res.ok ? res.json() : { data: [] }))
        .then((json: { data: Suggestion[] }) => {
          setSuggestions(json.data);
          setLoading(false);
        })
        .catch(() => {
          /* aborted or network error — leave suggestions as-is */
        });
    }, delay);
    return () => {
      clearTimeout(t);
      controller.abort();
      setLoading(false);
    };
  }, [query, minLength, delay]);

  return { suggestions, loading };
}

/**
 * Search box with typeahead (client). Debounced suggestions via
 * `useSearchSuggestions`; Enter submits to the search results page.
 */
export function SearchBox({ initialQuery = '' }: { initialQuery?: string }) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const { suggestions } = useSearchSuggestions(query);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (suggestions.length > 0) setOpen(true);
  }, [suggestions]);

  useEffect(() => {
    function onClick(e: MouseEvent): void {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function submit(q: string): void {
    if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
    setOpen(false);
  }

  return (
    <div ref={boxRef} style={{ position: 'relative', width: '100%', maxWidth: 560 }}>
      <form
        className="search"
        onSubmit={e => {
          e.preventDefault();
          submit(query);
        }}
      >
        <label className="sr-only" htmlFor="storefront-search">
          Search products
        </label>
        <Search aria-hidden="true" />
        <input
          id="storefront-search"
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          placeholder="Search products…"
        />
      </form>
      {open && suggestions.length > 0 ? (
        <ul
          className="surface"
          style={{
            position: 'absolute',
            zIndex: 50,
            marginTop: 6,
            width: '100%',
            overflow: 'hidden',
            listStyle: 'none',
            padding: 6,
          }}
        >
          {suggestions.map(s => (
            <li key={s.productId}>
              <button
                type="button"
                onClick={() => submit(s.name)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 10px',
                  borderRadius: 'var(--r-sm)',
                  fontSize: 14,
                  color: 'var(--ink)',
                }}
              >
                {s.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
