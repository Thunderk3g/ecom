'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatMoney, centsToInput, parseMoneyToCents } from '@/lib/format';
import { refundOrderAction } from '../actions';

export type RefundDialogItem = {
  orderItemId: string;
  sku: string;
  name: string;
  qty: number;
  unitPriceCents: number;
  lineTotalCents: number;
};

type LineDraft = {
  qty: number;
  /** Major-unit string for the input control; converted to cents on submit. */
  amount: string;
};

export function RefundDialog({
  orderId,
  items,
  currency,
  refundableCents,
  disabled,
}: {
  orderId: string;
  items: RefundDialogItem[];
  currency: string;
  /** Order total minus refunds in pending/succeeded state. */
  refundableCents: number;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<'partial' | 'full'>('partial');
  const [lines, setLines] = useState<Record<string, LineDraft>>(() =>
    Object.fromEntries(
      items.map(i => [
        i.orderItemId,
        { qty: 0, amount: centsToInput(0) } satisfies LineDraft,
      ]),
    ),
  );
  const [reason, setReason] = useState('');

  function setLine(orderItemId: string, patch: Partial<LineDraft>) {
    setLines(prev => ({
      ...prev,
      [orderItemId]: { ...(prev[orderItemId] ?? { qty: 0, amount: '0.00' }), ...patch },
    }));
  }

  const totalCents = useMemo(() => {
    if (mode === 'full') return refundableCents;
    let sum = 0;
    for (const i of items) {
      const draft = lines[i.orderItemId];
      if (!draft) continue;
      const cents = parseMoneyToCents(draft.amount);
      if (cents !== null && cents > 0 && draft.qty > 0) sum += cents;
    }
    return sum;
  }, [mode, items, lines, refundableCents]);

  function submit() {
    if (refundableCents <= 0) {
      toast.error('Nothing left to refund on this order');
      return;
    }

    let payload: Array<{ orderItemId: string; qty: number; amountCents: number }>;

    if (mode === 'full') {
      // Distribute the remaining refundable balance pro-rata against ordered
      // qty so each line carries a non-zero allocation. The remainder cent
      // (after integer division) is added to the last line.
      const totalQty = items.reduce((s, i) => s + i.qty, 0);
      if (totalQty === 0) {
        toast.error('Order has no items to refund');
        return;
      }
      let remaining = refundableCents;
      payload = items.map((i, idx) => {
        const isLast = idx === items.length - 1;
        const share = isLast
          ? remaining
          : Math.floor((i.qty / totalQty) * refundableCents);
        remaining -= share;
        return { orderItemId: i.orderItemId, qty: i.qty, amountCents: share };
      });
      payload = payload.filter(p => p.amountCents > 0 && p.qty > 0);
    } else {
      payload = [];
      for (const i of items) {
        const draft = lines[i.orderItemId];
        if (!draft) continue;
        const cents = parseMoneyToCents(draft.amount);
        if (cents === null || cents <= 0 || draft.qty <= 0) continue;
        if (draft.qty > i.qty) {
          toast.error(`Qty for ${i.sku} exceeds ordered qty`);
          return;
        }
        payload.push({
          orderItemId: i.orderItemId,
          qty: draft.qty,
          amountCents: cents,
        });
      }
    }

    if (payload.length === 0) {
      toast.error('Enter a quantity and amount > 0 for at least one item');
      return;
    }

    const sumCents = payload.reduce((s, p) => s + p.amountCents, 0);
    if (sumCents > refundableCents) {
      toast.error(
        `Refund total ${formatMoney(sumCents, currency)} exceeds refundable ${formatMoney(refundableCents, currency)}`,
      );
      return;
    }

    startTransition(async () => {
      const res = await refundOrderAction(orderId, {
        items: payload,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      if (res.ok) {
        toast.success(
          res.data.orderRefunded
            ? 'Order fully refunded'
            : 'Refund issued',
        );
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled || refundableCents <= 0}>
          Refund
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Refund</DialogTitle>
          <DialogDescription>
            {`Refundable balance: ${formatMoney(refundableCents, currency)}`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Button
            type="button"
            variant={mode === 'partial' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode('partial')}
          >
            Partial (by item)
          </Button>
          <Button
            type="button"
            variant={mode === 'full' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode('full')}
          >
            Full refund
          </Button>
        </div>

        {mode === 'partial' ? (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="w-24 text-right">Ordered</TableHead>
                  <TableHead className="w-24 text-right">Unit</TableHead>
                  <TableHead className="w-28 text-right">Qty</TableHead>
                  <TableHead className="w-32 text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(i => {
                  const draft = lines[i.orderItemId] ?? { qty: 0, amount: '0.00' };
                  return (
                    <TableRow key={i.orderItemId}>
                      <TableCell>
                        <div className="font-medium">{i.name}</div>
                        <div className="text-xs text-muted-foreground">{i.sku}</div>
                      </TableCell>
                      <TableCell className="text-right">{i.qty}</TableCell>
                      <TableCell className="text-right">
                        {formatMoney(i.unitPriceCents, currency)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min={0}
                          max={i.qty}
                          value={draft.qty}
                          onChange={e =>
                            setLine(i.orderItemId, {
                              qty: Number.parseInt(e.target.value, 10) || 0,
                            })
                          }
                          className="w-20 text-right"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          value={draft.amount}
                          onChange={e =>
                            setLine(i.orderItemId, { amount: e.target.value })
                          }
                          className="w-24 text-right"
                          placeholder={centsToInput(i.lineTotalCents)}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {`Issues a single refund of ${formatMoney(refundableCents, currency)} allocated pro-rata across line items.`}
          </p>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="reason">Reason</Label>
          <Textarea
            id="reason"
            rows={2}
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Optional internal note"
          />
        </div>

        <div className="text-right text-sm">
          <span className="text-muted-foreground">Refund total: </span>
          <span className="font-medium">{formatMoney(totalCents, currency)}</span>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? 'Processing…' : 'Issue refund'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
