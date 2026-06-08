'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { type SupplierRow } from '@/modules/inventory/suppliers';
import {
  createSupplierAction,
  updateSupplierAction,
  deleteSupplierAction,
} from '../actions';

type DialogMode = 'create' | 'edit' | 'delete' | null;

interface DialogState {
  mode: DialogMode;
  row: SupplierRow | null;
}

const EMPTY_FORM = { name: '', email: '', phone: '', leadTimeDays: '' };

export function SuppliersManager({ rows }: { rows: SupplierRow[] }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ mode: null, row: null });
  const [form, setForm] = useState(EMPTY_FORM);
  const [pending, startTransition] = useTransition();

  function openCreate() {
    setForm(EMPTY_FORM);
    setDialog({ mode: 'create', row: null });
  }

  function openEdit(row: SupplierRow) {
    setForm({
      name: row.name,
      email: row.contact?.email ?? '',
      phone: row.contact?.phone ?? '',
      leadTimeDays: row.leadTimeDays != null ? String(row.leadTimeDays) : '',
    });
    setDialog({ mode: 'edit', row });
  }

  function openDelete(row: SupplierRow) {
    setDialog({ mode: 'delete', row });
  }

  function close() {
    setDialog({ mode: null, row: null });
  }

  function field(key: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm(prev => ({ ...prev, [key]: e.target.value }));
  }

  function buildInput() {
    return {
      name: form.name.trim(),
      ...(form.email.trim() ? { email: form.email.trim() } : {}),
      ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
      ...(form.leadTimeDays.trim() !== ''
        ? { leadTimeDays: Number.parseInt(form.leadTimeDays, 10) }
        : {}),
    };
  }

  function submitCreate() {
    const input = buildInput();
    if (!input.name) {
      toast.error('Name is required');
      return;
    }
    startTransition(async () => {
      const res = await createSupplierAction(input);
      if (res.ok) {
        toast.success('Supplier created');
        router.refresh();
        close();
      } else {
        toast.error(res.error);
      }
    });
  }

  function submitEdit() {
    if (!dialog.row) return;
    const input = buildInput();
    if (!input.name) {
      toast.error('Name is required');
      return;
    }
    startTransition(async () => {
      const res = await updateSupplierAction(dialog.row!.id, input);
      if (res.ok) {
        toast.success('Supplier updated');
        router.refresh();
        close();
      } else {
        toast.error(res.error);
      }
    });
  }

  function submitDelete() {
    if (!dialog.row) return;
    startTransition(async () => {
      const res = await deleteSupplierAction(dialog.row!.id);
      if (res.ok) {
        toast.success('Supplier deleted');
        router.refresh();
        close();
      } else {
        toast.error(res.error);
      }
    });
  }

  const isCreate = dialog.mode === 'create';
  const isEdit = dialog.mode === 'edit';
  const isDelete = dialog.mode === 'delete';

  return (
    <>
      <div className="panel">
        <div className="tbar">
          <span className="t-sub">{rows.length} supplier{rows.length !== 1 ? 's' : ''}</span>
          <button type="button" className="btn btn-sm" onClick={openCreate}>
            New supplier
          </button>
        </div>
        <table className="dtable">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th className="num">Lead time (days)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '40px 16px' }}
                >
                  No suppliers yet.
                </td>
              </tr>
            ) : (
              rows.map(row => (
                <tr key={row.id}>
                  <td className="t-strong">{row.name}</td>
                  <td className="t-sub">{row.contact?.email ?? '—'}</td>
                  <td className="t-sub">{row.contact?.phone ?? '—'}</td>
                  <td className="num t-sub">{row.leadTimeDays ?? '—'}</td>
                  <td className="num">
                    <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => openEdit(row)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ color: 'var(--err)' }}
                        onClick={() => openDelete(row)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create / Edit dialog */}
      <Dialog open={isCreate || isEdit} onOpenChange={o => (o ? null : close())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isCreate ? 'New supplier' : 'Edit supplier'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="sup-name">Name *</Label>
              <Input
                id="sup-name"
                value={form.name}
                onChange={field('name')}
                placeholder="e.g. Papyrus Co."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sup-email">Email</Label>
              <Input
                id="sup-email"
                type="email"
                value={form.email}
                onChange={field('email')}
                placeholder="orders@supplier.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sup-phone">Phone</Label>
              <Input
                id="sup-phone"
                type="tel"
                value={form.phone}
                onChange={field('phone')}
                placeholder="+91 98765 43210"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sup-lead">Lead time (days)</Label>
              <Input
                id="sup-lead"
                type="number"
                min={0}
                value={form.leadTimeDays}
                onChange={field('leadTimeDays')}
                placeholder="e.g. 7"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button onClick={isCreate ? submitCreate : submitEdit} disabled={pending}>
              {pending ? 'Saving…' : isCreate ? 'Create' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={isDelete} onOpenChange={o => (o ? null : close())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete supplier</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete{' '}
            <span className="font-semibold">{dialog.row?.name}</span>? This cannot be
            undone. Suppliers with active purchase orders cannot be deleted.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={submitDelete} disabled={pending}>
              {pending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
