'use client';

import { useState, useTransition } from 'react';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { fulfillOrderAction } from '../actions';

export type FulfillDialogItem = {
  orderItemId: string;
  sku: string;
  name: string;
  /** Quantity still eligible to fulfil (qty ordered minus prior fulfillment qty). */
  remaining: number;
};

export function FulfillDialog({
  orderId,
  items,
  disabled,
}: {
  orderId: string;
  items: FulfillDialogItem[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [qty, setQty] = useState<Record<string, number>>(() =>
    Object.fromEntries(items.map(i => [i.orderItemId, i.remaining])),
  );
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');

  function setItemQty(orderItemId: string, value: number) {
    setQty(prev => ({ ...prev, [orderItemId]: value }));
  }

  function submit() {
    const payload = items
      .map(it => ({
        orderItemId: it.orderItemId,
        qty: Math.max(0, Math.min(qty[it.orderItemId] ?? 0, it.remaining)),
      }))
      .filter(it => it.qty > 0);

    if (payload.length === 0) {
      toast.error('Enter a quantity > 0 for at least one item');
      return;
    }

    startTransition(async () => {
      const res = await fulfillOrderAction(orderId, {
        items: payload,
        ...(carrier.trim() ? { carrier: carrier.trim() } : {}),
        ...(trackingNumber.trim() ? { trackingNumber: trackingNumber.trim() } : {}),
      });
      if (res.ok) {
        toast.success('Fulfillment created');
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  const noneEligible = items.every(i => i.remaining <= 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={disabled || noneEligible}>Fulfill items</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Fulfill items</DialogTitle>
          <DialogDescription>
            Record a fulfillment for unfulfilled line items. Quantities are
            capped at the remaining unfulfilled qty per item.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="w-24 text-right">Remaining</TableHead>
                <TableHead className="w-32 text-right">Qty</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(it => (
                <TableRow key={it.orderItemId}>
                  <TableCell>
                    <div className="font-medium">{it.name}</div>
                    <div className="text-xs text-muted-foreground">{it.sku}</div>
                  </TableCell>
                  <TableCell className="text-right">{it.remaining}</TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      min={0}
                      max={it.remaining}
                      value={qty[it.orderItemId] ?? 0}
                      disabled={it.remaining <= 0}
                      onChange={e =>
                        setItemQty(
                          it.orderItemId,
                          Number.parseInt(e.target.value, 10) || 0,
                        )
                      }
                      className="w-20 text-right"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="carrier">Carrier</Label>
            <Input
              id="carrier"
              value={carrier}
              onChange={e => setCarrier(e.target.value)}
              placeholder="e.g. Delhivery"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="trackingNumber">Tracking number</Label>
            <Input
              id="trackingNumber"
              value={trackingNumber}
              onChange={e => setTrackingNumber(e.target.value)}
              placeholder="e.g. 1234567890"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? 'Saving…' : 'Create fulfillment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
