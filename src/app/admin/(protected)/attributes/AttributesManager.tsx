'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate}>New attribute</Button>
          </DialogTrigger>
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
      </div>

      <div className="rounded-md border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Filterable</TableHead>
              <TableHead>Required</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  No attributes defined.
                </TableCell>
              </TableRow>
            ) : (
              rows.map(row => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.label}</TableCell>
                  <TableCell className="text-muted-foreground">{row.key}</TableCell>
                  <TableCell>
                    {row.dataType}
                    {row.unit ? ` (${row.unit})` : ''}
                  </TableCell>
                  <TableCell>
                    {row.filterable ? <Badge>Yes</Badge> : <Badge variant="secondary">No</Badge>}
                  </TableCell>
                  <TableCell>
                    {row.required ? <Badge>Yes</Badge> : <Badge variant="secondary">No</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(row)}>
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => remove(row.id)}>
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
