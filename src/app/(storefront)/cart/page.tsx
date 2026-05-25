'use client';

import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent } from '@/components/ui/card';
import { useCart, type CartLine } from '@/components/storefront/cart-context';

/**
 * Full cart view. Client component reading/writing the cart through the cart
 * context (→ existing cart HTTP API). Line items show the priced line from the
 * server totals (authoritative). Quantity edits, removal, and coupon
 * apply/remove all round-trip and re-render from the server response.
 *
 * Money is formatted from the cart's currency code; the storefront site_config
 * currency is the source for the symbol/locale but the cart row also carries a
 * currency so we read it directly here (client has no site_config access).
 */
function useCurrencyFormatter(code: string | undefined): (cents: number) => string {
  return (cents: number) => {
    const value = cents / 100;
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: code ?? 'INR',
      }).format(value);
    } catch {
      return value.toFixed(2);
    }
  };
}

export default function CartPage() {
  const { cart, totals, ready, loading, updateItem, removeItem, applyCoupon, removeCoupon } =
    useCart();
  const [coupon, setCoupon] = useState('');
  const fmt = useCurrencyFormatter(cart?.currency);

  if (!ready) {
    return <div className="container py-16 text-center text-muted-foreground">Loading cart…</div>;
  }

  const lines = totals?.lines ?? [];
  const isEmpty = lines.length === 0;

  // Map item rows by id so we can pair priced lines with their cart item.
  const itemById = new Map((cart?.items ?? []).map(i => [i.id, i]));

  async function onApplyCoupon(): Promise<void> {
    if (!coupon.trim()) return;
    const ok = await applyCoupon(coupon.trim());
    if (ok) {
      toast.success('Coupon applied');
      setCoupon('');
    } else {
      toast.error('Coupon could not be applied');
    }
  }

  return (
    <div className="container py-10">
      <h1 className="mb-8 font-serif text-3xl font-semibold tracking-tight text-brand">
        Your cart
      </h1>

      {isEmpty ? (
        <div className="space-y-4 py-12 text-center">
          <p className="text-muted-foreground">Your cart is empty.</p>
          <Button asChild>
            <Link href="/search">Browse products</Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-10 lg:grid-cols-[1fr_20rem]">
          <ul className="divide-y">
            {lines.map((line: CartLine) => {
              const item = itemById.get(line.itemId);
              return (
                <li key={line.itemId} className="flex gap-4 py-5">
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md border bg-muted text-xs text-muted-foreground/40">
                    item
                  </div>
                  <div className="flex flex-1 flex-col gap-2">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium">Variant {line.variantId.slice(0, 8)}</p>
                        <p className="text-xs text-muted-foreground">
                          {fmt(line.unitPriceCents)} each
                        </p>
                      </div>
                      <span className="text-sm font-semibold">{fmt(line.lineTotalCents)}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center rounded-md border">
                        <button
                          type="button"
                          className="px-2.5 py-1 text-base leading-none hover:bg-accent disabled:opacity-50"
                          disabled={loading}
                          onClick={() => updateItem(line.itemId, line.qty - 1)}
                          aria-label="Decrease quantity"
                        >
                          −
                        </button>
                        <span className="w-8 text-center text-sm tabular-nums">
                          {item?.qty ?? line.qty}
                        </span>
                        <button
                          type="button"
                          className="px-2.5 py-1 text-base leading-none hover:bg-accent disabled:opacity-50"
                          disabled={loading}
                          onClick={() => updateItem(line.itemId, line.qty + 1)}
                          aria-label="Increase quantity"
                        >
                          +
                        </button>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground"
                        disabled={loading}
                        onClick={() => removeItem(line.itemId)}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <Card className="h-fit">
            <CardContent className="space-y-4 p-6">
              <h2 className="font-medium">Order summary</h2>
              <div className="space-y-2 text-sm">
                <Row label="Subtotal" value={fmt(totals?.subtotalCents ?? 0)} />
                {totals && totals.discountCents > 0 ? (
                  <Row label="Discount" value={`−${fmt(totals.discountCents)}`} />
                ) : null}
                <Row label="Tax" value={fmt(totals?.taxCents ?? 0)} />
                <Row
                  label={`Shipping${totals?.shippingOption ? ` (${totals.shippingOption.label})` : ''}`}
                  value={fmt(totals?.shippingCents ?? 0)}
                />
              </div>
              <Separator />
              <Row label="Total" value={fmt(totals?.totalCents ?? 0)} strong />

              <div className="space-y-2 pt-2">
                {cart?.couponCode ? (
                  <div className="flex items-center justify-between rounded-md bg-brand/5 px-3 py-2 text-sm">
                    <span>
                      Coupon <span className="font-medium">{cart.couponCode}</span>
                    </span>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:underline"
                      onClick={() => removeCoupon()}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input
                      value={coupon}
                      onChange={e => setCoupon(e.target.value)}
                      placeholder="Coupon code"
                      className="h-9"
                    />
                    <Button type="button" variant="outline" size="sm" onClick={onApplyCoupon}>
                      Apply
                    </Button>
                  </div>
                )}
              </div>

              <Button asChild size="lg" className="w-full">
                <Link href="/checkout">Checkout</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
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
