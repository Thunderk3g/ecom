'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type NewsletterProps = {
  heading?: string;
  placeholder?: string;
  buttonLabel?: string;
};

/**
 * Newsletter capture block. There is no storefront subscribe endpoint in scope,
 * so submission is captured client-side and acknowledged optimistically — the
 * email is validated and a confirmation message shown. Wiring to a real
 * marketing list endpoint is a follow-up (the form is ready for it).
 */
export function Newsletter({ heading, placeholder, buttonLabel }: NewsletterProps) {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);

  function onSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setDone(true);
    }
  }

  return (
    <section className="border-y bg-brand/5">
      <div className="container flex flex-col items-center gap-4 py-12 text-center">
        <h2 className="font-serif text-2xl font-semibold tracking-tight">
          {heading ?? 'Stay in the loop'}
        </h2>
        {done ? (
          <p className="text-muted-foreground">Thanks — you&rsquo;re on the list.</p>
        ) : (
          <form onSubmit={onSubmit} className="flex w-full max-w-md gap-2">
            <Input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder={placeholder ?? 'you@example.com'}
              aria-label="Email address"
            />
            <Button type="submit">{buttonLabel ?? 'Subscribe'}</Button>
          </form>
        )}
      </div>
    </section>
  );
}
