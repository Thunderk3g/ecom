'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ORDER_STATUSES } from '../_status';

const ALL = '__all__';

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
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <ChipButton
          active={!status}
          onClick={() => apply({ status: '' })}
          label="All"
        />
        {ORDER_STATUSES.map(s => (
          <ChipButton
            key={s}
            active={status === s}
            onClick={() => apply({ status: status === s ? '' : s })}
            label={s.replace('_', ' ')}
          />
        ))}
      </div>

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={e => {
          e.preventDefault();
          apply({
            customerEmail: emailInput.trim(),
            from: fromInput,
            to: toInput,
          });
        }}
      >
        <div className="w-64 space-y-1.5">
          <label className="text-xs text-muted-foreground" htmlFor="customerEmail">
            Customer email
          </label>
          <Input
            id="customerEmail"
            value={emailInput}
            onChange={e => setEmailInput(e.target.value)}
            placeholder="exact match"
          />
        </div>
        <div className="w-44 space-y-1.5">
          <label className="text-xs text-muted-foreground" htmlFor="from">
            From
          </label>
          <Input
            id="from"
            type="date"
            value={fromInput}
            onChange={e => setFromInput(e.target.value)}
          />
        </div>
        <div className="w-44 space-y-1.5">
          <label className="text-xs text-muted-foreground" htmlFor="to">
            To
          </label>
          <Input
            id="to"
            type="date"
            value={toInput}
            onChange={e => setToInput(e.target.value)}
          />
        </div>
        <Button type="submit" variant="outline">
          Apply
        </Button>
        {(customerEmail || from || to) ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setEmailInput('');
              setFromInput('');
              setToInput('');
              apply({ customerEmail: '', from: '', to: '' });
            }}
          >
            Clear
          </Button>
        ) : null}
      </form>
    </div>
  );
}

void ALL;

function ChipButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? 'default' : 'outline'}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}
