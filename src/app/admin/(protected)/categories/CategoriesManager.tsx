'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
  createCategoryAction,
  updateCategoryAction,
  deleteCategoryAction,
  type CategoryInput,
} from './actions';

export type CategoryListRow = {
  id: string;
  label: string;
  name: string;
  depth: number;
  slug?: string;
  parentId?: string | null;
  description?: string | null;
  sortOrder?: number;
  published?: boolean;
};

const NO_PARENT = '__root__';

const EMPTY: CategoryInput = {
  slug: '',
  name: '',
  parentId: '',
  description: '',
  sortOrder: 0,
  published: true,
};

export function CategoriesManager({
  rows,
  parentOptions,
}: {
  rows: CategoryListRow[];
  parentOptions: Array<{ id: string; label: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CategoryInput>(EMPTY);
  const [pending, startTransition] = useTransition();

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY);
    setOpen(true);
  }

  function openEdit(row: CategoryListRow) {
    setEditingId(row.id);
    setForm({
      slug: row.slug ?? '',
      name: row.name,
      parentId: row.parentId ?? '',
      description: row.description ?? '',
      sortOrder: row.sortOrder ?? 0,
      published: row.published ?? true,
    });
    setOpen(true);
  }

  function save() {
    startTransition(async () => {
      const res = editingId
        ? await updateCategoryAction(editingId, form)
        : await createCategoryAction(form);
      if (res.ok) {
        toast.success(editingId ? 'Category saved' : 'Category created');
        setOpen(false);
      } else {
        toast.error(res.error);
      }
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await deleteCategoryAction(id);
      if (res.ok) toast.success('Category deleted');
      else toast.error(res.error);
    });
  }

  return (
    <>
      <div className="between" style={{ marginBottom: 20 }}>
        <div>
          <h2 className="h-md" style={{ fontFamily: 'var(--serif)' }}>
            Categories
          </h2>
          <span className="t-sub">Organize products into a category tree.</span>
        </div>
        <button type="button" className="btn btn-clay btn-sm" onClick={openCreate}>
          + New category
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId ? 'Edit category' : 'New category'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="cname">Name</Label>
                  <Input id="cname" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cslug">Slug</Label>
                  <Input id="cslug" value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Parent</Label>
                <Select
                  value={form.parentId || NO_PARENT}
                  onValueChange={v => setForm({ ...form, parentId: v === NO_PARENT ? '' : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Top level" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PARENT}>Top level</SelectItem>
                    {parentOptions
                      .filter(o => o.id !== editingId)
                      .map(o => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.label}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cdesc">Description</Label>
                <Textarea
                  id="cdesc"
                  rows={3}
                  value={form.description ?? ''}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="csort">Sort order</Label>
                  <Input
                    id="csort"
                    type="number"
                    value={form.sortOrder}
                    onChange={e => setForm({ ...form, sortOrder: Number(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Published</Label>
                  <Select
                    value={form.published ? 'yes' : 'no'}
                    onValueChange={v => setForm({ ...form, published: v === 'yes' })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="yes">Published</SelectItem>
                      <SelectItem value="no">Hidden</SelectItem>
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
          <h3>Category tree</h3>
        </div>
        <table className="dtable">
          <thead>
            <tr>
              <th>Name</th>
              <th>Slug</th>
              <th>Visibility</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '40px 16px' }}>
                  No categories yet.
                </td>
              </tr>
            ) : (
              rows.map(row => (
                <tr key={row.id}>
                  <td>
                    <span style={{ paddingLeft: `${row.depth * 16}px` }} className="t-strong">
                      {row.name}
                    </span>
                  </td>
                  <td className="t-sub" style={{ fontFamily: 'ui-monospace,monospace' }}>
                    {row.slug ?? '—'}
                  </td>
                  <td>
                    {row.published ? (
                      <span className="statpill sp-active">Published</span>
                    ) : (
                      <span className="statpill sp-draft">Hidden</span>
                    )}
                  </td>
                  <td className="num">
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
