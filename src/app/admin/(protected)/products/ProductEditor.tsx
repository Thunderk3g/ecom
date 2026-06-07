'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

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
  const [tab, setTab] = useState<'basics' | 'variants' | 'media' | 'seo'>('basics');

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

  const tabs: Array<{ id: typeof tab; label: string; disabled?: boolean }> = [
    { id: 'basics', label: 'General' },
    { id: 'variants', label: 'Variants', disabled: mode === 'create' },
    { id: 'media', label: 'Media', disabled: mode === 'create' },
    { id: 'seo', label: 'SEO' },
  ];

  return (
    <>
      <div className="adm-tabs">
        {tabs.map(t => (
          <a
            key={t.id}
            href="#"
            className={tab === t.id ? 'on' : undefined}
            aria-disabled={t.disabled || undefined}
            onClick={e => {
              e.preventDefault();
              if (!t.disabled) setTab(t.id);
            }}
            style={t.disabled ? { opacity: 0.45, pointerEvents: 'none' } : undefined}
          >
            {t.label}
          </a>
        ))}
      </div>

      <div className="adm-form-grid">
        <div className="stack" style={{ gap: 16 }}>
          {tab === 'basics' ? (
            <div className="panel panel-pad">
              <h3 style={{ fontFamily: 'var(--serif)', fontSize: 16, marginBottom: 16 }}>
                Details
              </h3>
              <div className="grid-2" style={{ gap: 16 }}>
                <div className="field full">
                  <label htmlFor="name">Product name</label>
                  <input
                    id="name"
                    className="input"
                    value={form.name}
                    onChange={e => set('name', e.target.value)}
                  />
                </div>
                <div className="field full">
                  <label htmlFor="slug">URL slug</label>
                  <input
                    id="slug"
                    className="input"
                    style={{ fontFamily: 'ui-monospace,monospace', fontSize: 13 }}
                    value={form.slug}
                    onChange={e => set('slug', e.target.value)}
                  />
                </div>
                <div className="field full">
                  <label htmlFor="description">
                    Description <span className="muted">· Markdown</span>
                  </label>
                  <textarea
                    id="description"
                    className="input"
                    rows={6}
                    value={form.descriptionMd ?? ''}
                    onChange={e => set('descriptionMd', e.target.value)}
                  />
                </div>
              </div>
            </div>
          ) : null}

          {tab === 'variants' ? (
            mode === 'edit' && productId ? (
              <VariantsPanel productId={productId} variants={variants} />
            ) : null
          ) : null}

          {tab === 'media' ? (
            <div className="panel panel-pad t-sub">
              Media management is delivered by the asset pipeline (SP-8). Product
              images can be attached there once the asset library ships.
            </div>
          ) : null}

          {tab === 'seo' ? (
            <div className="panel panel-pad">
              <h3 style={{ fontFamily: 'var(--serif)', fontSize: 16, marginBottom: 16 }}>
                SEO
              </h3>
              <div className="stack" style={{ gap: 16 }}>
                <div className="field">
                  <label htmlFor="seoTitle">SEO title</label>
                  <input
                    id="seoTitle"
                    className="input"
                    value={form.seoTitle ?? ''}
                    onChange={e => set('seoTitle', e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="seoDescription">SEO description</label>
                  <textarea
                    id="seoDescription"
                    className="input"
                    rows={3}
                    value={form.seoDescription ?? ''}
                    onChange={e => set('seoDescription', e.target.value)}
                  />
                </div>
              </div>
            </div>
          ) : null}

          <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() =>
                router.push('/admin/products' as Parameters<typeof router.push>[0])
              }
            >
              Back
            </button>
            <button
              type="button"
              className="btn btn-clay btn-sm"
              onClick={saveBasics}
              disabled={pending}
            >
              {pending ? 'Saving…' : mode === 'create' ? 'Create product' : 'Save changes'}
            </button>
          </div>
        </div>

        <aside className="stack" style={{ gap: 16 }}>
          <div className="panel panel-pad">
            <h3 style={{ fontFamily: 'var(--serif)', fontSize: 16, marginBottom: 14 }}>
              Status
            </h3>
            <div className="field" style={{ marginBottom: 14 }}>
              <label htmlFor="status">Visibility</label>
              <select
                id="status"
                className="select"
                value={form.status}
                onChange={e => set('status', e.target.value as ProductBasicsInput['status'])}
              >
                <option value="active">Active — visible</option>
                <option value="draft">Draft — hidden</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="type">Type</label>
              <select
                id="type"
                className="select"
                value={form.type}
                onChange={e => set('type', e.target.value as ProductBasicsInput['type'])}
              >
                <option value="simple">Simple</option>
                <option value="bundle">Bundle</option>
              </select>
            </div>
          </div>

          <div className="panel panel-pad">
            <h3 style={{ fontFamily: 'var(--serif)', fontSize: 16, marginBottom: 14 }}>
              Organisation
            </h3>
            <div className="field" style={{ marginBottom: 12 }}>
              <label htmlFor="brand">Brand</label>
              <input
                id="brand"
                className="input"
                value={form.brand ?? ''}
                onChange={e => set('brand', e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="category">Category</label>
              <select
                id="category"
                className="select"
                value={form.categoryId || NONE}
                onChange={e => set('categoryId', e.target.value === NONE ? '' : e.target.value)}
              >
                <option value={NONE}>None</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </aside>
      </div>
    </>
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
    <div className="panel">
      <div className="panel-head">
        <h3>
          Variants{' '}
          <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
            · {variants.length}
          </span>
        </h3>
      </div>

      {variants.length === 0 ? (
        <div className="panel-pad t-sub">No variants yet.</div>
      ) : (
        <table className="dtable">
          <thead>
            <tr>
              <th>Variant</th>
              <th>SKU</th>
              <th className="num">Price</th>
              <th className="num">Compare-at</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {variants.map(v => (
              <tr key={v.id}>
                <td className="t-strong">{v.name ?? v.sku}</td>
                <td className="t-sub">{v.sku}</td>
                <td className="num">{formatMoney(v.priceCents)}</td>
                <td className="num muted">
                  {v.compareAtCents != null ? formatMoney(v.compareAtCents) : '—'}
                </td>
                <td>
                  <select
                    className="select"
                    aria-label={`Status for ${v.name ?? v.sku}`}
                    value={v.status}
                    onChange={e =>
                      changeStatus(v, e.target.value as EditorVariant['status'])
                    }
                    style={{ height: 32, padding: '4px 28px 4px 10px', fontSize: 12.5 }}
                  >
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                    <option value="archived">Archived</option>
                  </select>
                </td>
                <td className="num">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={pending}
                    onClick={() => removeVariant(v.id)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="panel-pad" style={{ borderTop: '1px solid var(--line)' }}>
        <div
          className="grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: 12,
            alignItems: 'end',
          }}
        >
          <div className="field">
            <label htmlFor="vsku">SKU</label>
            <input
              id="vsku"
              className="input"
              value={draft.sku}
              onChange={e => setDraft({ ...draft, sku: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="vname">Name</label>
            <input
              id="vname"
              className="input"
              value={draft.name}
              onChange={e => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="vprice">Price</label>
            <input
              id="vprice"
              className="input"
              value={draft.price}
              onChange={e => setDraft({ ...draft, price: e.target.value })}
              placeholder={centsToInput(0)}
            />
          </div>
          <div className="field">
            <label htmlFor="vstatus">Status</label>
            <select
              id="vstatus"
              className="select"
              value={draft.status}
              onChange={e =>
                setDraft({ ...draft, status: e.target.value as EditorVariant['status'] })
              }
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <button
            type="button"
            className="btn btn-clay btn-sm"
            onClick={addVariant}
            disabled={pending}
          >
            Add variant
          </button>
        </div>
      </div>
    </div>
  );
}
