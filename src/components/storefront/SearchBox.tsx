'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

type Suggestion = { term: string; productId: string; name: string };

/**
 * Search box with typeahead (client). Debounced suggestions from
 * `/api/v1/catalog/search?suggest=1`; Enter submits to the search results page.
 */
export function SearchBox({ initialQuery = '' }: { initialQuery?: string }) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(() => {
      void fetch(`/api/v1/catalog/search?suggest=1&q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
      })
        .then(res => (res.ok ? res.json() : { data: [] }))
        .then((json: { data: Suggestion[] }) => {
          setSuggestions(json.data);
          setOpen(true);
        })
        .catch(() => {
          /* aborted or network error — leave suggestions as-is */
        });
    }, 200);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [query]);

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
    <div ref={boxRef} className="relative w-full max-w-xl">
      <form
        onSubmit={e => {
          e.preventDefault();
          submit(query);
        }}
      >
        <label className="relative block">
          <span className="sr-only">Search products</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onFocus={() => suggestions.length > 0 && setOpen(true)}
            placeholder="Search products…"
            className="pl-9"
          />
        </label>
      </form>
      {open && suggestions.length > 0 ? (
        <ul className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
          {suggestions.map(s => (
            <li key={s.productId}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => submit(s.name)}
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
