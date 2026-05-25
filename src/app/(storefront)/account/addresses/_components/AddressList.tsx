'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { AddressRow, DefaultSlot } from '@/modules/customers/addresses';
import {
  deleteAddressAction,
  setDefaultAddressAction,
} from '../../actions';
import { AddressDialog, type AddressDialogInitialValues } from './AddressDialog';

/**
 * Interactive list of saved addresses.
 *
 * Each row carries:
 *   - "Set as default" buttons (one per applicable semantic slot: billing /
 *     shipping; a `'both'`-typed row exposes both).
 *   - "Edit" — opens the AddressDialog in edit mode.
 *   - "Delete" — confirms via window.confirm to avoid an extra modal layer
 *     since the dialog is already used for create/edit. Failures toast.
 *
 * All mutations run through Server Actions; we use `useTransition` so the UI
 * shows a disabled state while a row's action is in flight without blocking
 * other rows.
 */
type Props = {
  addresses: AddressRow[];
};

export function AddressList({ addresses }: Props) {
  const [pending, startTransition] = useTransition();

  function onDelete(id: string): void {
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm(
        'Delete this address? This cannot be undone.',
      );
      if (!confirmed) return;
    }
    startTransition(async () => {
      const result = await deleteAddressAction(id);
      if (result.ok) {
        toast.success('Address removed');
      } else {
        toast.error(result.error);
      }
    });
  }

  function onSetDefault(id: string, slot: DefaultSlot): void {
    startTransition(async () => {
      const result = await setDefaultAddressAction(id, slot);
      if (result.ok) {
        toast.success(`Default ${slot} address updated`);
      } else {
        toast.error(result.error);
      }
    });
  }

  if (addresses.length === 0) {
    return (
      <Card>
        <CardContent className="space-y-3 py-12 text-center">
          <p className="text-muted-foreground">No saved addresses yet.</p>
          <AddressDialog
            mode="create"
            trigger={<Button size="sm">Add your first address</Button>}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <AddressDialog
          mode="create"
          trigger={<Button size="sm">Add address</Button>}
        />
      </div>
      <ul className="grid gap-4 sm:grid-cols-2">
        {addresses.map(addr => {
          const initial: AddressDialogInitialValues = {
            id: addr.id,
            type: addr.type,
            name: addr.name,
            line1: addr.line1,
            line2: addr.line2,
            city: addr.city,
            region: addr.region,
            postal: addr.postal,
            country: addr.country,
            phone: addr.phone,
          };
          const slots: DefaultSlot[] =
            addr.type === 'both'
              ? ['shipping', 'billing']
              : [addr.type];
          return (
            <li key={addr.id}>
              <Card className="h-full">
                <CardContent className="flex h-full flex-col gap-3 p-6">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <p className="font-medium">{addr.name}</p>
                      <p className="text-xs uppercase tracking-wider text-muted-foreground">
                        {addr.type}
                      </p>
                    </div>
                    {addr.isDefault ? (
                      <Badge variant="secondary">Default</Badge>
                    ) : null}
                  </div>
                  <address className="flex-1 text-sm not-italic leading-relaxed text-muted-foreground">
                    <span className="block">{addr.line1}</span>
                    {addr.line2 ? (
                      <span className="block">{addr.line2}</span>
                    ) : null}
                    <span className="block">
                      {addr.city}, {addr.region} {addr.postal}
                    </span>
                    <span className="block">{addr.country}</span>
                    {addr.phone ? (
                      <span className="block">{addr.phone}</span>
                    ) : null}
                  </address>
                  <div className="flex flex-wrap items-center gap-2 pt-2">
                    <AddressDialog
                      mode="edit"
                      initial={initial}
                      trigger={
                        <Button variant="outline" size="sm" disabled={pending}>
                          Edit
                        </Button>
                      }
                    />
                    {!addr.isDefault
                      ? slots.map(slot => (
                          <Button
                            key={slot}
                            variant="ghost"
                            size="sm"
                            disabled={pending}
                            onClick={() => onSetDefault(addr.id, slot)}
                          >
                            Set as default {slot}
                          </Button>
                        ))
                      : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto text-destructive hover:text-destructive"
                      disabled={pending}
                      onClick={() => onDelete(addr.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
