'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatMoney, centsToInput, parseMoneyToCents } from '@/lib/format';
import {
  createProductAction,
  updateProductAction,
  createVariantAction,
  updateVariantAction,
  deleteVariantAction,
  type ProductBasicsInput,
} from './actions';

export type EditorVariant = {
  id: string;
  sku: string;
  name: string | null;
  priceCents: number;
  compareAtCents: number | null;
  status: 'draft' | 'active' | 'archived';
};

export type ProductEditorProps = {
  mode: 'create' | 'edit';
  productId?: string;
  initial: ProductBasicsInput;
  categories: Array<{ id: string; label: string }>;
  variants: EditorVariant[];
};

const NONE = '__none__';

export function ProductEditor({
  mode,
  productId,
  initial,
  categories,
  variants,
}: ProductEditorProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<ProductBasicsInput>(initial);

  function set<K extends keyof ProductBasicsInput>(key: K, value: ProductBasicsInput[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function saveBasics() {
    startTransition(async () => {
      if (mode === 'create') {
        const res = await createProductAction(form);
        if (res.ok) {
          toast.success('Product created');
          router.push(`/admin/products/${res.data.id}` as Parameters<typeof router.push>[0]);
        } else {
          toast.error(res.error);
        }
      } else if (productId) {
        const res = await updateProductAction(productId, form);
        if (res.ok) toast.success('Product saved');
        else toast.error(res.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      <Tabs defaultValue="basics">
        <TabsList>
          <TabsTrigger value="basics">Basics</TabsTrigger>
          <TabsTrigger value="variants" disabled={mode === 'create'}>
            Variants
          </TabsTrigger>
          <TabsTrigger value="media" disabled={mode === 'create'}>
            Media
          </TabsTrigger>
          <TabsTrigger value="seo">SEO</TabsTrigger>
        </TabsList>

        <TabsContent value="basics">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    value={form.name}
                    onChange={e => set('name', e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="slug">Slug</Label>
                  <Input
                    id="slug"
                    value={form.slug}
                    onChange={e => set('slug', e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="description">Description (Markdown)</Label>
                <Textarea
                  id="description"
                  rows={6}
                  value={form.descriptionMd ?? ''}
                  onChange={e => set('descriptionMd', e.target.value)}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1.5">
                  <Label htmlFor="brand">Brand</Label>
                  <Input
                    id="brand"
                    value={form.brand ?? ''}
                    onChange={e => set('brand', e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Category</Label>
                  <Select
                    value={form.categoryId || NONE}
                    onValueChange={v => set('categoryId', v === NONE ? '' : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>None</SelectItem>
                      {categories.map(c => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Type</Label>
                  <Select value={form.type} onValueChange={v => set('type', v as ProductBasicsInput['type'])}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="simple">Simple</SelectItem>
                      <SelectItem value="bundle">Bundle</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <Select value={form.status} onValueChange={v => set('status', v as ProductBasicsInput['status'])}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="archived">Archived</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="variants">
          {mode === 'edit' && productId ? (
            <VariantsPanel productId={productId} variants={variants} />
          ) : null}
        </TabsContent>

        <TabsContent value="media">
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Media management is delivered by the asset pipeline (SP-8). Product
              images can be attached there once the asset library ships.
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="seo">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="space-y-1.5">
                <Label htmlFor="seoTitle">SEO title</Label>
                <Input
                  id="seoTitle"
                  value={form.seoTitle ?? ''}
                  onChange={e => set('seoTitle', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="seoDescription">SEO description</Label>
                <Textarea
                  id="seoDescription"
                  rows={3}
                  value={form.seoDescription ?? ''}
                  onChange={e => set('seoDescription', e.target.value)}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push('/admin/products' as Parameters<typeof router.push>[0])}>
          Back
        </Button>
        <Button onClick={saveBasics} disabled={pending}>
          {pending ? 'Saving…' : mode === 'create' ? 'Create product' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}

function VariantsPanel({
  productId,
  variants,
}: {
  productId: string;
  variants: EditorVariant[];
}) {
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState({ sku: '', name: '', price: '', status: 'active' as EditorVariant['status'] });

  function addVariant() {
    const priceCents = parseMoneyToCents(draft.price);
    if (!draft.sku.trim()) {
      toast.error('SKU is required');
      return;
    }
    if (priceCents === null) {
      toast.error('Enter a valid price');
      return;
    }
    startTransition(async () => {
      const res = await createVariantAction(productId, {
        sku: draft.sku.trim(),
        name: draft.name.trim() || undefined,
        priceCents,
        status: draft.status,
      });
      if (res.ok) {
        toast.success('Variant added');
        setDraft({ sku: '', name: '', price: '', status: 'active' });
      } else {
        toast.error(res.error);
      }
    });
  }

  function removeVariant(variantId: string) {
    startTransition(async () => {
      const res = await deleteVariantAction(productId, variantId);
      if (res.ok) toast.success('Variant removed');
      else toast.error(res.error);
    });
  }

  function changeStatus(v: EditorVariant, status: EditorVariant['status']) {
    startTransition(async () => {
      const res = await updateVariantAction(productId, v.id, {
        sku: v.sku,
        name: v.name ?? undefined,
        priceCents: v.priceCents,
        compareAtCents: v.compareAtCents,
        status,
      });
      if (res.ok) toast.success('Variant updated');
      else toast.error(res.error);
    });
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="space-y-2">
          {variants.length === 0 ? (
            <p className="text-sm text-muted-foreground">No variants yet.</p>
          ) : (
            variants.map(v => (
              <div
                key={v.id}
                className="flex items-center justify-between rounded-md border p-3 text-sm"
              >
                <div>
                  <div className="font-medium">{v.name ?? v.sku}</div>
                  <div className="text-xs text-muted-foreground">
                    {v.sku} · {formatMoney(v.priceCents)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={v.status === 'active' ? 'default' : 'secondary'}>
                    {v.status}
                  </Badge>
                  <Select
                    value={v.status}
                    onValueChange={s => changeStatus(v, s as EditorVariant['status'])}
                  >
                    <SelectTrigger className="h-8 w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="archived">Archived</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => removeVariant(v.id)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="grid items-end gap-3 border-t pt-4 sm:grid-cols-5">
          <div className="space-y-1.5">
            <Label htmlFor="vsku">SKU</Label>
            <Input id="vsku" value={draft.sku} onChange={e => setDraft({ ...draft, sku: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vname">Name</Label>
            <Input id="vname" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vprice">Price</Label>
            <Input
              id="vprice"
              value={draft.price}
              onChange={e => setDraft({ ...draft, price: e.target.value })}
              placeholder={centsToInput(0)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={draft.status} onValueChange={s => setDraft({ ...draft, status: s as EditorVariant['status'] })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={addVariant} disabled={pending}>
            Add variant
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
