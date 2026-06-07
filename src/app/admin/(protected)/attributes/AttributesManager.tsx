'use client';

import { useState, useTransition } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  createAttributeAction,
  updateAttributeAction,
  deleteAttributeAction,
  type AttributeInput,
} from './actions';

type DataType = 'string' | 'number' | 'bool' | 'enum';

export type AttributeRow = {
  id: string;
  key: string;
  label: string;
  dataType: DataType;
  unit: string | null;
  enumValues: string[];
  filterable: boolean;
  required: boolean;
};

type FormState = {
  key: string;
  label: string;
  dataType: DataType;
  unit: string;
  enumValues: string;
  filterable: boolean;
  required: boolean;
};

const EMPTY: FormState = {
  key: '',
  label: '',
  dataType: 'string',
  unit: '',
  enumValues: '',
  filterable: false,
  required: false,
};

function toInput(form: FormState): AttributeInput {
  return {
    key: form.key.trim(),
    label: form.label.trim(),
    dataType: form.dataType,
    unit: form.unit.trim() || undefined,
    enumValues: form.enumValues
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
    filterable: form.filterable,
    required: form.required,
  };
}

export function AttributesManager({ rows }: { rows: AttributeRow[] }) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [pending, startTransition] = useTransition();

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY);
    setOpen(true);
  }

  function openEdit(row: AttributeRow) {
    setEditingId(row.id);
    setForm({
      key: row.key,
      label: row.label,
      dataType: row.dataType,
      unit: row.unit ?? '',
      enumValues: row.enumValues.join(', '),
      filterable: row.filterable,
      required: row.required,
    });
    setOpen(true);
  }

  function save() {
    startTransition(async () => {
      const input = toInput(form);
      const res = editingId
        ? await updateAttributeAction(editingId, input)
        : await createAttributeAction(input);
      if (res.ok) {
        toast.success(editingId ? 'Attribute saved' : 'Attribute created');
        setOpen(false);
      } else {
        toast.error(res.error);
      }
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await deleteAttributeAction(id);
      if (res.ok) toast.success('Attribute deleted');
      else toast.error(res.error);
    });
  }

  return (
    <>
      <div className="between" style={{ marginBottom: 20 }}>
        <div>
          <h2 className="h-md" style={{ fontFamily: 'var(--serif)' }}>
            Attributes
          </h2>
          <span className="t-sub">
            Define the product attribute registry used for facets and validation.
          </span>
        </div>
        <button type="button" className="btn btn-clay btn-sm" onClick={openCreate}>
          + New attribute
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId ? 'Edit attribute' : 'New attribute'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="akey">Key</Label>
                  <Input
                    id="akey"
                    value={form.key}
                    disabled={editingId !== null}
                    onChange={e => setForm({ ...form, key: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="alabel">Label</Label>
                  <Input id="alabel" value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Data type</Label>
                  <Select value={form.dataType} onValueChange={v => setForm({ ...form, dataType: v as DataType })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="string">String</SelectItem>
                      <SelectItem value="number">Number</SelectItem>
                      <SelectItem value="bool">Boolean</SelectItem>
                      <SelectItem value="enum">Enum</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="aunit">Unit</Label>
                  <Input id="aunit" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} />
                </div>
              </div>
              {form.dataType === 'enum' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="aenum">Enum values (comma-separated)</Label>
                  <Input
                    id="aenum"
                    value={form.enumValues}
                    onChange={e => setForm({ ...form, enumValues: e.target.value })}
                  />
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Filterable</Label>
                  <Select value={form.filterable ? 'yes' : 'no'} onValueChange={v => setForm({ ...form, filterable: v === 'yes' })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="no">No</SelectItem>
                      <SelectItem value="yes">Yes</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Required</Label>
                  <Select value={form.required ? 'yes' : 'no'} onValueChange={v => setForm({ ...form, required: v === 'yes' })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="no">No</SelectItem>
                      <SelectItem value="yes">Yes</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={save} disabled={pending}>
                {pending ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      <div className="panel">
        <div className="panel-head">
          <h3>Attribute registry</h3>
        </div>
        <table className="dtable">
          <thead>
            <tr>
              <th>Label</th>
              <th>Key</th>
              <th>Type</th>
              <th>Enum values</th>
              <th>Filterable</th>
              <th>Required</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '40px 16px' }}>
                  No attributes defined.
                </td>
              </tr>
            ) : (
              rows.map(row => (
                <tr key={row.id}>
                  <td className="t-strong">{row.label}</td>
                  <td className="t-sub" style={{ fontFamily: 'ui-monospace,monospace' }}>
                    {row.key}
                  </td>
                  <td>
                    {row.dataType}
                    {row.unit ? ` (${row.unit})` : ''}
                  </td>
                  <td className="t-sub">
                    {row.enumValues.length > 0 ? row.enumValues.join(', ') : '—'}
                  </td>
                  <td>
                    {row.filterable ? (
                      <span className="statpill sp-active">Yes</span>
                    ) : (
                      <span className="statpill sp-draft">No</span>
                    )}
                  </td>
                  <td>
                    {row.required ? (
                      <span className="statpill sp-active">Yes</span>
                    ) : (
                      <span className="statpill sp-draft">No</span>
                    )}
                  </td>
                  <td className="num">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEdit(row)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={pending}
                      onClick={() => remove(row.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
