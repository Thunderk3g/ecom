'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
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
    <div className="stack" style={{ gap: 12 }}>
      <div className="between">
        <span className="t-sub">Saved addresses</span>
        <button type="button" className="btn btn-clay btn-sm" onClick={startCreate}>
          + Add address
        </button>
      </div>

      {addresses.length === 0 ? (
        <p className="t-sub">No saved addresses for this customer.</p>
      ) : (
        <ul className="stack" style={{ gap: 10, listStyle: 'none', padding: 0 }}>
          {addresses.map(a => {
            const canBeBillingDefault = a.type === 'billing' || a.type === 'both';
            const canBeShippingDefault =
              a.type === 'shipping' || a.type === 'both';
            return (
              <li
                key={a.id}
                style={{
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--r-sm)',
                  padding: 16,
                }}
              >
                <div className="between" style={{ alignItems: 'flex-start', gap: 12 }}>
                  <div>
                    <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                      <span className="t-strong">{a.name}</span>
                      <span className="statpill sp-draft">{a.type}</span>
                      {a.isDefault ? (
                        <span className="statpill sp-active">Default</span>
                      ) : null}
                    </div>
                    <div className="t-sub" style={{ lineHeight: 1.6 }}>
                      {a.line1}
                      {a.line2 ? `, ${a.line2}` : ''}
                      <br />
                      {a.city}, {a.region} {a.postal}, {a.country}
                      {a.phone ? (
                        <>
                          <br />
                          {a.phone}
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={pending}
                      onClick={() => startEdit(a)}
                    >
                      Edit
                    </button>
                    {canBeBillingDefault ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={pending}
                        onClick={() => setDefault(a.id, 'billing')}
                      >
                        Set default billing
                      </button>
                    ) : null}
                    {canBeShippingDefault ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={pending}
                        onClick={() => setDefault(a.id, 'shipping')}
                      >
                        Set default shipping
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={pending}
                      onClick={() => remove(a.id)}
                    >
                      Delete
                    </button>
                  </div>
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
