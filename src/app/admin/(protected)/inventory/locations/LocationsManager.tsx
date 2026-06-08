'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  createLocationAction,
  updateLocationAction,
  deleteLocationAction,
} from '../actions';
import type { LocationRow, LocationType } from '@/modules/inventory/locations';

const LOCATION_TYPES: LocationType[] = ['warehouse', 'store', 'transit'];

const TYPE_LABELS: Record<LocationType, string> = {
  warehouse: 'Warehouse',
  store: 'Store',
  transit: 'Transit',
};

type DialogMode = 'create' | 'edit';

interface FormState {
  code: string;
  name: string;
  type: LocationType;
}

const EMPTY_FORM: FormState = { code: '', name: '', type: 'warehouse' };

export function LocationsManager({ rows }: { rows: LocationRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [dialogMode, setDialogMode] = useState<DialogMode | null>(null);
  const [editTarget, setEditTarget] = useState<LocationRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletePending, startDeleteTransition] = useTransition();

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditTarget(null);
    setDialogMode('create');
  }

  function openEdit(row: LocationRow) {
    setForm({ code: row.code, name: row.name, type: row.type });
    setEditTarget(row);
    setDialogMode('edit');
  }

  function closeDialog() {
    setDialogMode(null);
    setEditTarget(null);
    setForm(EMPTY_FORM);
  }

  function submit() {
    if (!form.code.trim() || !form.name.trim()) {
      toast.error('Code and name are required');
      return;
    }
    startTransition(async () => {
      let res;
      if (dialogMode === 'create') {
        res = await createLocationAction({
          code: form.code.trim(),
          name: form.name.trim(),
          type: form.type,
        });
      } else if (dialogMode === 'edit' && editTarget) {
        res = await updateLocationAction(editTarget.id, {
          code: form.code.trim(),
          name: form.name.trim(),
          type: form.type,
        });
      } else {
        return;
      }

      if (res.ok) {
        toast.success(dialogMode === 'create' ? 'Location created' : 'Location updated');
        closeDialog();
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function confirmDelete(id: string) {
    setConfirmDeleteId(id);
  }

  function cancelDelete() {
    setConfirmDeleteId(null);
  }

  function doDelete() {
    if (!confirmDeleteId) return;
    const id = confirmDeleteId;
    startDeleteTransition(async () => {
      const res = await deleteLocationAction(id);
      if (res.ok) {
        toast.success('Location deleted');
        setConfirmDeleteId(null);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <>
      <div className="panel">
        <div className="tbar">
          <span className="t-sub">{rows.length} location{rows.length !== 1 ? 's' : ''}</span>
          <button type="button" className="btn btn-sm" onClick={openCreate}>
            New location
          </button>
        </div>
        <table className="dtable">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Type</th>
              <th>Created</th>
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
                  No locations yet. Create one to start tracking stock.
                </td>
              </tr>
            ) : (
              rows.map(row => (
                <tr key={row.id}>
                  <td>
                    <span className="t-strong">{row.code}</span>
                  </td>
                  <td>{row.name}</td>
                  <td>
                    <span className="statpill sp-active">{TYPE_LABELS[row.type]}</span>
                  </td>
                  <td className="t-sub">
                    {new Date(row.createdAt).toLocaleDateString()}
                  </td>
                  <td>
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
                        style={{ color: 'var(--destructive, #e33)' }}
                        onClick={() => confirmDelete(row.id)}
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
      <Dialog open={dialogMode !== null} onOpenChange={o => (o ? null : closeDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogMode === 'create' ? 'New location' : 'Edit location'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="loc-code">Code</Label>
              <Input
                id="loc-code"
                value={form.code}
                onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                placeholder="e.g. WH-01"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="loc-name">Name</Label>
              <Input
                id="loc-name"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Main Warehouse"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="loc-type">Type</Label>
              <Select
                value={form.type}
                onValueChange={v => setForm(f => ({ ...f, type: v as LocationType }))}
              >
                <SelectTrigger id="loc-type">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {LOCATION_TYPES.map(t => (
                    <SelectItem key={t} value={t}>
                      {TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? 'Saving…' : dialogMode === 'create' ? 'Create' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog
        open={confirmDeleteId !== null}
        onOpenChange={o => (o ? null : cancelDelete())}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete location?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This location will be permanently removed. Deletion is blocked if any stock
            levels reference it — drain stock first.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={cancelDelete}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={doDelete}
              disabled={deletePending}
            >
              {deletePending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
