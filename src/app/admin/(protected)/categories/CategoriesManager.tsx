'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate}>New category</Button>
          </DialogTrigger>
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
      </div>

      <div className="rounded-md border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Visibility</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                  No categories yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map(row => (
                <TableRow key={row.id}>
                  <TableCell>
                    <span style={{ paddingLeft: `${row.depth * 16}px` }} className="font-medium">
                      {row.name}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.slug ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={row.published ? 'default' : 'secondary'}>
                      {row.published ? 'Published' : 'Hidden'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(row)}>
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => remove(row.id)}
                    >
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
