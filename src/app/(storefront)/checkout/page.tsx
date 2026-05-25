'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useCart } from '@/components/storefront/cart-context';
import { ensureStorefrontSession } from '../_lib/session';

type Provider = 'razorpay' | 'stripe';

type Address = {
  name: string;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postal: string;
  country: string;
  phone: string;
};

type StartResult = {
  intentId: string;
  providerRef: string;
  clientSecret?: string;
  totals: { totalCents: number };
};

const EMPTY_ADDRESS: Address = {
  name: '',
  line1: '',
  line2: '',
  city: '',
  region: '',
  postal: '',
  country: 'IN',
  phone: '',
};

function newKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Single-page checkout (client). Steps, all against the existing HTTP API:
 *   1. Collect shipping address → PATCH /api/v1/cart/:id/addresses.
 *   2. Pick a provider → POST /api/v1/checkout/start (server re-prices,
 *      reserves stock, mints the intent).
 *   3. Show the returned payment intent. Live payment capture is out of scope
 *      (no keys), so this stubs the confirmation with a "simulate paid" note —
 *      the payment webhook is the real source of truth for order creation.
 */
export default function CheckoutPage() {
  const { cart, totals, ready } = useCart();
  const [address, setAddress] = useState<Address>(EMPTY_ADDRESS);
  const [provider, setProvider] = useState<Provider>('razorpay');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<StartResult | null>(null);

  function set<K extends keyof Address>(key: K, value: string): void {
    setAddress(a => ({ ...a, [key]: value }));
  }

  function money(cents: number): string {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: cart?.currency ?? 'INR',
      }).format(cents / 100);
    } catch {
      return (cents / 100).toFixed(2);
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!cart) {
      toast.error('Your cart is empty');
      return;
    }
    setSubmitting(true);
    try {
      const { csrfToken } = await ensureStorefrontSession();

      // 1. Persist the shipping address (also used as billing).
      const shipping = {
        name: address.name,
        line1: address.line1,
        ...(address.line2 ? { line2: address.line2 } : {}),
        city: address.city,
        region: address.region,
        postal: address.postal,
        country: address.country,
        ...(address.phone ? { phone: address.phone } : {}),
      };
      const addrRes = await fetch(`/api/v1/cart/${cart.id}/addresses`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
          'idempotency-key': newKey(),
        },
        body: JSON.stringify({ shippingAddress: shipping, billingAddress: shipping }),
      });
      if (!addrRes.ok) {
        toast.error('Could not save address');
        return;
      }

      // 2. Start checkout.
      const startRes = await fetch('/api/v1/checkout/start', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
          'idempotency-key': newKey(),
        },
        body: JSON.stringify({ cartId: cart.id, provider }),
      });
      if (!startRes.ok) {
        const body = (await startRes.json().catch(() => ({}))) as { detail?: string };
        toast.error(body.detail ?? 'Checkout could not be started');
        return;
      }
      const json = (await startRes.json()) as { data: StartResult };
      setResult(json.data);
      toast.success('Payment intent created');
    } finally {
      setSubmitting(false);
    }
  }

  if (!ready) {
    return <div className="container py-16 text-center text-muted-foreground">Loading…</div>;
  }

  if (!cart || (totals?.lines.length ?? 0) === 0) {
    return (
      <div className="container space-y-4 py-16 text-center">
        <p className="text-muted-foreground">Your cart is empty.</p>
        <Button asChild>
          <Link href="/search">Browse products</Link>
        </Button>
      </div>
    );
  }

  if (result) {
    return (
      <div className="container max-w-lg py-12">
        <Card>
          <CardContent className="space-y-4 p-8">
            <h1 className="font-serif text-2xl font-semibold text-brand">Payment intent created</h1>
            <p className="text-sm text-muted-foreground">
              In production the {provider} SDK would now collect payment for{' '}
              <span className="font-medium text-foreground">{money(result.totals.totalCents)}</span>.
              The order is created by the payment webhook once the provider confirms.
            </p>
            <Separator />
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Intent</dt>
                <dd className="font-mono text-xs">{result.intentId}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Provider ref</dt>
                <dd className="font-mono text-xs">{result.providerRef}</dd>
              </div>
            </dl>
            <p className="rounded-md bg-brand/5 p-3 text-xs text-muted-foreground">
              No live payment keys are configured in this environment. Simulate a paid order by
              delivering the provider webhook to <code>/api/v1/webhooks/payments/{provider}</code>.
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link href="/account/orders">View your orders</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container py-10">
      <h1 className="mb-8 font-serif text-3xl font-semibold tracking-tight text-brand">Checkout</h1>
      <form onSubmit={onSubmit} className="grid gap-10 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-8">
          <section className="space-y-4">
            <h2 className="font-medium">Shipping address</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" value={address.name} onChange={v => set('name', v)} required />
              <Field label="Phone" value={address.phone} onChange={v => set('phone', v)} />
              <div className="sm:col-span-2">
                <Field label="Address line 1" value={address.line1} onChange={v => set('line1', v)} required />
              </div>
              <div className="sm:col-span-2">
                <Field label="Address line 2" value={address.line2} onChange={v => set('line2', v)} />
              </div>
              <Field label="City" value={address.city} onChange={v => set('city', v)} required />
              <Field label="State / Region" value={address.region} onChange={v => set('region', v)} required />
              <Field label="Postal code" value={address.postal} onChange={v => set('postal', v)} required />
              <Field label="Country" value={address.country} onChange={v => set('country', v)} required />
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="font-medium">Payment method</h2>
            <div className="flex gap-3">
              {(['razorpay', 'stripe'] as Provider[]).map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProvider(p)}
                  className={`flex-1 rounded-md border px-4 py-3 text-sm capitalize transition-colors ${
                    provider === p ? 'border-brand bg-brand/10 font-medium text-brand' : 'hover:bg-accent'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </section>
        </div>

        <Card className="h-fit">
          <CardContent className="space-y-4 p-6">
            <h2 className="font-medium">Order summary</h2>
            <div className="space-y-2 text-sm">
              <Row label="Subtotal" value={money(totals?.subtotalCents ?? 0)} />
              {totals && totals.discountCents > 0 ? (
                <Row label="Discount" value={`−${money(totals.discountCents)}`} />
              ) : null}
              <Row label="Tax" value={money(totals?.taxCents ?? 0)} />
              <Row label="Shipping" value={money(totals?.shippingCents ?? 0)} />
            </div>
            <Separator />
            <Row label="Total" value={money(totals?.totalCents ?? 0)} strong />
            <Button type="submit" size="lg" className="w-full" disabled={submitting}>
              {submitting ? 'Processing…' : 'Place order'}
            </Button>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      <Input value={value} onChange={e => onChange(e.target.value)} required={required} />
    </div>
  );
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className={`flex justify-between ${strong ? 'text-base font-semibold' : ''}`}>
      <span className={strong ? '' : 'text-muted-foreground'}>{label}</span>
      <span>{value}</span>
    </div>
  );
}
