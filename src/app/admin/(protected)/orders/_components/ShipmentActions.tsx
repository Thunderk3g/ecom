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
import { shipShipmentAction, deliverShipmentAction } from '../actions';

/**
 * Ship / Deliver buttons for a single fulfillment (paired 1:1 with a shipment
 * in this stream). Renders only the actions that are legal for the current
 * fulfillment status.
 */
export function ShipmentActions({
  orderId,
  fulfillmentId,
  status,
  carrier,
  trackingNumber,
}: {
  orderId: string;
  fulfillmentId: string;
  status: string;
  carrier: string | null;
  trackingNumber: string | null;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {status === 'pending' ? (
        <ShipButton
          orderId={orderId}
          fulfillmentId={fulfillmentId}
          initialCarrier={carrier ?? ''}
          initialTrackingNumber={trackingNumber ?? ''}
        />
      ) : null}
      {status === 'shipped' ? (
        <DeliverButton orderId={orderId} fulfillmentId={fulfillmentId} />
      ) : null}
    </div>
  );
}

function ShipButton({
  orderId,
  fulfillmentId,
  initialCarrier,
  initialTrackingNumber,
}: {
  orderId: string;
  fulfillmentId: string;
  initialCarrier: string;
  initialTrackingNumber: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [carrier, setCarrier] = useState(initialCarrier);
  const [trackingNumber, setTrackingNumber] = useState(initialTrackingNumber);

  function submit() {
    startTransition(async () => {
      const res = await shipShipmentAction(orderId, fulfillmentId, {
        ...(carrier.trim() ? { carrier: carrier.trim() } : {}),
        ...(trackingNumber.trim() ? { trackingNumber: trackingNumber.trim() } : {}),
      });
      if (res.ok) {
        toast.success('Shipment marked shipped');
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
        <Button size="sm" variant="outline">
          Mark shipped
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark shipped</DialogTitle>
          <DialogDescription>
            Record carrier and tracking number. The order won&apos;t change
            status; it transitions on full delivery.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ship-carrier">Carrier</Label>
            <Input
              id="ship-carrier"
              value={carrier}
              onChange={e => setCarrier(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ship-tracking">Tracking number</Label>
            <Input
              id="ship-tracking"
              value={trackingNumber}
              onChange={e => setTrackingNumber(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? 'Saving…' : 'Mark shipped'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeliverButton({
  orderId,
  fulfillmentId,
}: {
  orderId: string;
  fulfillmentId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const res = await deliverShipmentAction(orderId, fulfillmentId);
      if (res.ok) {
        toast.success('Shipment marked delivered');
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <Button size="sm" variant="outline" onClick={submit} disabled={pending}>
      {pending ? 'Saving…' : 'Mark delivered'}
    </Button>
  );
}
