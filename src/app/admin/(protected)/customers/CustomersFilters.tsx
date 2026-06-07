'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function CustomersFilters({ email }: { email: string }) {
  const router = useRouter();
  const [emailInput, setEmailInput] = useState(email);

  function apply(nextEmail: string) {
    const params = new URLSearchParams();
    if (nextEmail) params.set('email', nextEmail);
    const qs = params.toString();
    router.push(
      (qs ? `/admin/customers?${qs}` : '/admin/customers') as Parameters<
        typeof router.push
      >[0],
    );
  }

  return (
    <form
      className="tbar"
      onSubmit={e => {
        e.preventDefault();
        apply(emailInput.trim());
      }}
    >
      <label className="search" style={{ maxWidth: 288, padding: '8px 14px' }}>
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.2-3.2" />
        </svg>
        <input
          aria-label="Search by email"
          placeholder="Search by email…"
          value={emailInput}
          onChange={e => setEmailInput(e.target.value)}
        />
      </label>
      <button type="submit" className="btn btn-ghost btn-sm">
        Search
      </button>
      {email ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setEmailInput('');
            apply('');
          }}
        >
          Clear
        </button>
      ) : null}
    </form>
  );
}
