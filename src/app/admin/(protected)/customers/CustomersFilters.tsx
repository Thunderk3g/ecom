'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

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
      className="flex flex-wrap items-end gap-2"
      onSubmit={e => {
        e.preventDefault();
        apply(emailInput.trim());
      }}
    >
      <div className="w-72">
        <Input
          placeholder="Search by email"
          value={emailInput}
          onChange={e => setEmailInput(e.target.value)}
        />
      </div>
      <Button type="submit" variant="outline">
        Search
      </Button>
      {email ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setEmailInput('');
            apply('');
          }}
        >
          Clear
        </Button>
      ) : null}
    </form>
  );
}
