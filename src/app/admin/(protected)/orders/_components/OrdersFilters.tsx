'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ORDER_STATUSES, statusLabel } from '../_status';

export function OrdersFilters({
  status,
  customerEmail,
  from,
  to,
}: {
  status: string;
  customerEmail: string;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const [emailInput, setEmailInput] = useState(customerEmail);
  const [fromInput, setFromInput] = useState(from);
  const [toInput, setToInput] = useState(to);

  function apply(next: Partial<{ status: string; customerEmail: string; from: string; to: string }>) {
    const params = new URLSearchParams();
    const merged = { status, customerEmail, from, to, ...next };
    if (merged.status) params.set('status', merged.status);
    if (merged.customerEmail) params.set('customerEmail', merged.customerEmail);
    if (merged.from) params.set('from', merged.from);
    if (merged.to) params.set('to', merged.to);
    const qs = params.toString();
    router.push((qs ? `/admin/orders?${qs}` : '/admin/orders') as Parameters<typeof router.push>[0]);
  }

  return (
    <form
      className="tbar"
      onSubmit={e => {
        e.preventDefault();
        apply({
          customerEmail: emailInput.trim(),
          from: fromInput,
          to: toInput,
        });
      }}
    >
      <div className="seg">
        <button
          type="button"
          className={!status ? 'on' : undefined}
          onClick={() => apply({ status: '' })}
        >
          All
        </button>
        {ORDER_STATUSES.map(s => (
          <button
            key={s}
            type="button"
            className={status === s ? 'on' : undefined}
            onClick={() => apply({ status: status === s ? '' : s })}
          >
            {statusLabel(s)}
          </button>
        ))}
      </div>

      <div className="grow" />

      <label className="search" style={{ maxWidth: 240, padding: '8px 14px' }}>
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
          aria-label="Customer email"
          value={emailInput}
          onChange={e => setEmailInput(e.target.value)}
          placeholder="Customer email…"
        />
      </label>

      <input
        className="input"
        type="date"
        aria-label="From date"
        value={fromInput}
        style={{ width: 150 }}
        onChange={e => {
          setFromInput(e.target.value);
          apply({ from: e.target.value });
        }}
      />
      <input
        className="input"
        type="date"
        aria-label="To date"
        value={toInput}
        style={{ width: 150 }}
        onChange={e => {
          setToInput(e.target.value);
          apply({ to: e.target.value });
        }}
      />

      <button type="submit" className="btn btn-ghost btn-sm">
        Apply
      </button>
      {(customerEmail || from || to) ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setEmailInput('');
            setFromInput('');
            setToInput('');
            apply({ customerEmail: '', from: '', to: '' });
          }}
        >
          Clear
        </button>
      ) : null}
    </form>
  );
}
