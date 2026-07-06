'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useId } from 'react';

export type SortOption = { value: string; label: string };

/**
 * Listing toolbar sort control. Reflects `?sort=` into the URL so the server
 * component re-renders the ordered listing; picking the default option removes
 * the param. Changing sort resets the pagination cursor.
 */
export function SortSelect({
  options,
  defaultValue,
}: {
  options: SortOption[];
  /** The option that means "no sort param" — defaults to the first option. */
  defaultValue?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const id = useId();

  const fallback = defaultValue ?? options[0]?.value ?? '';
  const current = params.get('sort') ?? fallback;

  const onChange = (value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value === fallback) {
      next.delete('sort');
    } else {
      next.set('sort', value);
    }
    next.delete('after'); // Reset pagination whenever ordering changes.
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <label className="lst-sort" htmlFor={id}>
      <span className="lst-sort-label">Sort</span>
      <select
        id={id}
        className="lst-sort-select"
        value={current}
        onChange={e => onChange(e.target.value)}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg
        className="lst-sort-chev"
        viewBox="0 0 24 24"
        width="14"
        height="14"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </label>
  );
}
