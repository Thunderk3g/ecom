'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Footer newsletter island. Optimistic only — no backend yet: submit shows a
 * brief pending state, then a "You're on the list ✓" confirmation. Moving
 * this out of the server-rendered footer also fixes the previous
 * `onSubmit={undefined}` server-component form.
 */
export function NewsletterForm() {
  const [status, setStatus] = useState<'idle' | 'pending' | 'success'>('idle');
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  function onSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    if (status !== 'idle') return;
    const data = new FormData(e.currentTarget);
    const email = String(data.get('email') ?? '').trim();
    if (!email) return;
    setStatus('pending');
    timerRef.current = window.setTimeout(() => setStatus('success'), 600);
  }

  if (status === 'success') {
    return (
      <p className="news-status" role="status">
        You&rsquo;re on the list ✓
      </p>
    );
  }

  return (
    <form className="news" onSubmit={onSubmit}>
      <label className="sr-only" htmlFor="news-email">
        Email address
      </label>
      <input
        id="news-email"
        type="email"
        name="email"
        placeholder="Your email"
        required
        disabled={status === 'pending'}
      />
      <button type="submit" disabled={status === 'pending'}>
        {status === 'pending' ? 'Joining…' : 'Join'}
      </button>
    </form>
  );
}
