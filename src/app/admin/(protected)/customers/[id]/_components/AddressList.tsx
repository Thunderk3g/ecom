'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  deleteAddressAction,
  setDefaultAddressAction,
} from '../../actions';
import { AddressDialog, type AddressDialogValue } from './AddressDialog';

export type AddressEntry = {
  id: string;
  type: 'billing' | 'shipping' | 'both';
  name: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string;
  postal: string;
  country: string;
  phone: string | null;
  isDefault: boolean;
};

export function AddressList({
  customerId,
  addresses,
}: {
  customerId: string;
  addresses: AddressEntry[];
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AddressEntry | null>(null);
  const [pending, startTransition] = useTransition();

  function startCreate() {
    setEditing(null);
    setOpen(true);
  }

  function startEdit(entry: AddressEntry) {
    setEditing(entry);
    setOpen(true);
  }

  function remove(addressId: string) {
    startTransition(async () => {
      const res = await deleteAddressAction(customerId, addressId);
      if (res.ok) toast.success('Address removed');
      else toast.error(res.error);
    });
  }

  function setDefault(addressId: string, slot: 'billing' | 'shipping') {
    startTransition(async () => {
      const res = await setDefaultAddressAction(customerId, addressId, slot);
      if (res.ok) toast.success(`Set as default ${slot}`);
      else toast.error(res.error);
    });
  }

  const initialValue: AddressDialogValue | null = editing
    ? {
        type: editing.type,
        name: editing.name,
        line1: editing.line1,
        line2: editing.line2 ?? '',
        city: editing.city,
        region: editing.region,
        postal: editing.postal,
        country: editing.country,
        phone: editing.phone ?? '',
        isDefault: editing.isDefault,
      }
    : null;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={startCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Add address
        </Button>
      </div>

      {addresses.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No saved addresses for this customer.
        </p>
      ) : (
        <ul className="space-y-2">
          {addresses.map(a => {
            const canBeBillingDefault = a.type === 'billing' || a.type === 'both';
            const canBeShippingDefault =
              a.type === 'shipping' || a.type === 'both';
            return (
              <li
                key={a.id}
                className="flex flex-col gap-3 rounded-md border p-4 text-sm md:flex-row md:items-start md:justify-between"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{a.name}</span>
                    <Badge variant="secondary">{a.type}</Badge>
                    {a.isDefault ? <Badge>Default</Badge> : null}
                  </div>
                  <div className="text-muted-foreground">
                    {a.line1}
                    {a.line2 ? `, ${a.line2}` : ''}
                  </div>
                  <div className="text-muted-foreground">
                    {a.city}, {a.region} {a.postal}, {a.country}
                  </div>
                  {a.phone ? (
                    <div className="text-muted-foreground">{a.phone}</div>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => startEdit(a)}
                  >
                    Edit
                  </Button>
                  {canBeBillingDefault ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => setDefault(a.id, 'billing')}
                    >
                      Set default billing
                    </Button>
                  ) : null}
                  {canBeShippingDefault ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => setDefault(a.id, 'shipping')}
                    >
                      Set default shipping
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => remove(a.id)}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <AddressDialog
        open={open}
        onOpenChange={setOpen}
        customerId={customerId}
        mode={editing ? 'edit' : 'create'}
        addressId={editing?.id ?? null}
        initial={initialValue}
      />
    </div>
  );
}
