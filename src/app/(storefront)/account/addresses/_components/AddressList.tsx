'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
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
      <div className="surface pad" style={{ textAlign: 'center', padding: '48px 24px' }}>
        <p className="meta" style={{ marginBottom: '14px' }}>
          No saved addresses yet.
        </p>
        <AddressDialog
          mode="create"
          trigger={
            <button type="button" className="btn btn-clay btn-sm">
              Add your first address
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: '16px' }}>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <AddressDialog
          mode="create"
          trigger={
            <button type="button" className="btn btn-ghost btn-sm">
              + Add address
            </button>
          }
        />
      </div>
      <ul className="grid-2" style={{ gap: '14px', listStyle: 'none', padding: 0, margin: 0 }}>
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
              <div
                className="surface pad"
                style={{
                  position: 'relative',
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                {addr.isDefault ? (
                  <span
                    className="badge badge-soft"
                    style={{ position: 'absolute', top: '18px', right: '18px' }}
                  >
                    Default
                  </span>
                ) : null}
                <div className="cap muted" style={{ marginBottom: '4px', textTransform: 'capitalize' }}>
                  {addr.type}
                </div>
                <div style={{ fontWeight: 600 }}>{addr.name}</div>
                <address
                  className="meta"
                  style={{ fontStyle: 'normal', lineHeight: 1.6, marginTop: '2px', flex: 1 }}
                >
                  {addr.line1}
                  <br />
                  {addr.line2 ? (
                    <>
                      {addr.line2}
                      <br />
                    </>
                  ) : null}
                  {addr.city}, {addr.region} {addr.postal}
                  <br />
                  {addr.country}
                  {addr.phone ? (
                    <>
                      <br />
                      {addr.phone}
                    </>
                  ) : null}
                </address>
                <div
                  className="row"
                  style={{ gap: '14px', marginTop: '14px', flexWrap: 'wrap' }}
                >
                  <AddressDialog
                    mode="edit"
                    initial={initial}
                    trigger={
                      <button
                        type="button"
                        className="ucap link-u muted"
                        disabled={pending}
                        style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
                      >
                        Edit
                      </button>
                    }
                  />
                  {!addr.isDefault
                    ? slots.map(slot => (
                        <button
                          key={slot}
                          type="button"
                          className="ucap link-u muted"
                          disabled={pending}
                          onClick={() => onSetDefault(addr.id, slot)}
                          style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
                        >
                          Set default {slot}
                        </button>
                      ))
                    : null}
                  <button
                    type="button"
                    className="ucap link-u"
                    disabled={pending}
                    onClick={() => onDelete(addr.id)}
                    style={{
                      background: 'none',
                      border: 0,
                      padding: 0,
                      cursor: 'pointer',
                      color: 'var(--sale)',
                      marginLeft: 'auto',
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
