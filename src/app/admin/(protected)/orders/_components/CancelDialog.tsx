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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cancelOrderAction } from '../actions';

export function CancelDialog({
  orderId,
  disabled,
}: {
  orderId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState('');

  function submit() {
    startTransition(async () => {
      const res = await cancelOrderAction(orderId, {
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      if (res.ok) {
        toast.success('Order cancelled');
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
        <Button variant="destructive" disabled={disabled}>
          Cancel order
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel order</DialogTitle>
          <DialogDescription>
            This transitions the order to <code>cancelled</code>. The hop is
            terminal — cancelled orders can&apos;t be revived.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="reason">Reason</Label>
          <Textarea
            id="reason"
            rows={3}
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Customer request, fraud check, etc."
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Keep order
          </Button>
          <Button variant="destructive" onClick={submit} disabled={pending}>
            {pending ? 'Cancelling…' : 'Confirm cancel'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
