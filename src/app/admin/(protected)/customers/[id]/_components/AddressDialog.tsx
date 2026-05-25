'use client';

import { useEffect, useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createAddressAction, updateAddressAction } from '../../actions';

export type AddressDialogValue = {
  type: 'billing' | 'shipping' | 'both';
  name: string;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postal: string;
  country: string;
  phone: string;
  isDefault: boolean;
};

const EMPTY: AddressDialogValue = {
  type: 'shipping',
  name: '',
  line1: '',
  line2: '',
  city: '',
  region: '',
  postal: '',
  country: 'IN',
  phone: '',
  isDefault: false,
};

export function AddressDialog({
  open,
  onOpenChange,
  customerId,
  mode,
  addressId,
  initial,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  customerId: string;
  mode: 'create' | 'edit';
  addressId: string | null;
  initial: AddressDialogValue | null;
}) {
  const [form, setForm] = useState<AddressDialogValue>(initial ?? EMPTY);
  const [pending, startTransition] = useTransition();

  // Re-sync form when the dialog reopens with a different target.
  useEffect(() => {
    if (open) setForm(initial ?? EMPTY);
  }, [open, initial]);

  function set<K extends keyof AddressDialogValue>(
    key: K,
    value: AddressDialogValue[K],
  ) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function submit() {
    const trimmed = {
      type: form.type,
      name: form.name.trim(),
      line1: form.line1.trim(),
      line2: form.line2.trim() ? form.line2.trim() : null,
      city: form.city.trim(),
      region: form.region.trim(),
      postal: form.postal.trim(),
      country: form.country.trim(),
      phone: form.phone.trim() ? form.phone.trim() : null,
      isDefault: form.isDefault,
    };

    if (
      !trimmed.name ||
      !trimmed.line1 ||
      !trimmed.city ||
      !trimmed.region ||
      !trimmed.postal ||
      trimmed.country.length < 2
    ) {
      toast.error('Fill in all required address fields.');
      return;
    }

    startTransition(async () => {
      if (mode === 'create') {
        const res = await createAddressAction(customerId, trimmed);
        if (res.ok) {
          toast.success('Address added');
          onOpenChange(false);
        } else {
          toast.error(res.error);
        }
      } else if (addressId) {
        const res = await updateAddressAction(customerId, addressId, trimmed);
        if (res.ok) {
          toast.success('Address updated');
          onOpenChange(false);
        } else {
          toast.error(res.error);
        }
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Add address' : 'Edit address'}</DialogTitle>
          <DialogDescription>
            Saved addresses are used to pre-fill checkout and to manage default
            billing/shipping targets.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="addr-type">Type</Label>
            <Select
              value={form.type}
              onValueChange={v => set('type', v as AddressDialogValue['type'])}
            >
              <SelectTrigger id="addr-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="shipping">Shipping</SelectItem>
                <SelectItem value="billing">Billing</SelectItem>
                <SelectItem value="both">Both</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="addr-name">Name</Label>
            <Input
              id="addr-name"
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="Recipient or label"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="addr-line1">Line 1</Label>
            <Input
              id="addr-line1"
              value={form.line1}
              onChange={e => set('line1', e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="addr-line2">Line 2 (optional)</Label>
            <Input
              id="addr-line2"
              value={form.line2}
              onChange={e => set('line2', e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="addr-city">City</Label>
            <Input
              id="addr-city"
              value={form.city}
              onChange={e => set('city', e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="addr-region">Region / State</Label>
            <Input
              id="addr-region"
              value={form.region}
              onChange={e => set('region', e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="addr-postal">Postal code</Label>
            <Input
              id="addr-postal"
              value={form.postal}
              onChange={e => set('postal', e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="addr-country">Country (ISO)</Label>
            <Input
              id="addr-country"
              value={form.country}
              onChange={e => set('country', e.target.value)}
              maxLength={3}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="addr-phone">Phone (optional)</Label>
            <Input
              id="addr-phone"
              value={form.phone}
              onChange={e => set('phone', e.target.value)}
            />
          </div>
          {mode === 'create' ? (
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={e => set('isDefault', e.target.checked)}
              />
              Set as default for this type
            </label>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {mode === 'create' ? 'Add address' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
