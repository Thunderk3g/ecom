'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { centsToInput, parseMoneyToCents } from '@/lib/format';
import {
  createPromotionAction,
  updatePromotionAction,
  archivePromotionAction,
  type PromotionFormInput,
  type PromotionType,
  type PromotionStatus,
} from '../actions';

export type PromotionFormProps = {
  mode: 'create' | 'edit';
  promotionId?: string;
  initial: PromotionFormInput;
};

const PROMOTION_TYPES: Array<{ value: PromotionType; label: string }> = [
  { value: 'percent', label: 'Percent off' },
  { value: 'amount', label: 'Amount off' },
  { value: 'free_shipping', label: 'Free shipping' },
  { value: 'bxgy', label: 'Buy X get Y' },
];

const PROMOTION_STATUSES: Array<{ value: PromotionStatus; label: string }> = [
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'archived', label: 'Archived' },
];

/**
 * Convert a Date / ISO string into the value that an
 * `<input type="datetime-local">` expects (yyyy-MM-ddTHH:mm). Returns an
 * empty string when the input is null / empty / invalid.
 */
function toLocalInput(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** Convert a datetime-local string back to an ISO string. */
function fromLocalInput(value: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
}

export function PromotionForm({ mode, promotionId, initial }: PromotionFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<PromotionFormInput>(initial);

  // Local string state for the money / numeric inputs so users can type
  // freely (e.g. "12." while entering "12.50") without losing focus.
  const [valueInput, setValueInput] = useState(centsToInput(initial.valueCents));
  const [minSubtotalInput, setMinSubtotalInput] = useState(
    centsToInput(initial.minSubtotalCents),
  );
  const [startsAtLocal, setStartsAtLocal] = useState(toLocalInput(initial.startsAt));
  const [endsAtLocal, setEndsAtLocal] = useState(toLocalInput(initial.endsAt));

  function set<K extends keyof PromotionFormInput>(key: K, value: PromotionFormInput[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function buildSubmit(): PromotionFormInput {
    return {
      ...form,
      valueCents: form.type === 'amount' ? parseMoneyToCents(valueInput) : null,
      minSubtotalCents: minSubtotalInput.trim()
        ? parseMoneyToCents(minSubtotalInput)
        : null,
      startsAt: fromLocalInput(startsAtLocal),
      endsAt: fromLocalInput(endsAtLocal),
    };
  }

  function save() {
    const payload = buildSubmit();
    startTransition(async () => {
      if (mode === 'create') {
        const res = await createPromotionAction(payload);
        if (res.ok) {
          toast.success('Promotion created');
          router.push(
            `/admin/promotions/${res.data.id}` as Parameters<typeof router.push>[0],
          );
        } else {
          toast.error(res.error);
        }
      } else if (promotionId) {
        const res = await updatePromotionAction(promotionId, payload);
        if (res.ok) toast.success('Promotion saved');
        else toast.error(res.error);
      }
    });
  }

  function archive() {
    if (!promotionId) return;
    if (!window.confirm('Archive this promotion? It will stop applying immediately.')) {
      return;
    }
    startTransition(async () => {
      const res = await archivePromotionAction(promotionId);
      if (res.ok) {
        toast.success('Promotion archived');
        router.push('/admin/promotions' as Parameters<typeof router.push>[0]);
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="adm-form-grid">
      <div className="stack" style={{ gap: 16 }}>
        <div className="panel panel-pad">
          <h3 style={{ fontFamily: 'var(--serif)', fontSize: 16, marginBottom: 16 }}>
            Details
          </h3>
          <div className="grid-2" style={{ gap: 16 }}>
            <div className="field">
              <label htmlFor="name">Name</label>
              <input
                id="name"
                className="input"
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="Diwali sale"
              />
            </div>
            <div className="field">
              <label htmlFor="code">Code</label>
              <input
                id="code"
                className="input"
                value={form.code}
                onChange={e => set('code', e.target.value)}
                placeholder="Leave blank for auto-promo"
                style={{ fontFamily: 'ui-monospace,monospace' }}
              />
              <p className="t-sub" style={{ marginTop: 6 }}>
                Leave empty to make this an automatic promotion (no coupon required).
              </p>
            </div>
          </div>
        </div>

        <div className="panel panel-pad">
          <h3 style={{ fontFamily: 'var(--serif)', fontSize: 16, marginBottom: 4 }}>
            Value
          </h3>
          <p className="t-sub" style={{ marginBottom: 16 }}>
            Fields below depend on the promotion type.
          </p>

          {form.type === 'percent' ? (
            <div className="field" style={{ maxWidth: 320 }}>
              <label htmlFor="percent">Percent off</label>
              <input
                id="percent"
                className="input"
                type="number"
                min={0}
                max={100}
                value={form.percent ?? ''}
                onChange={e => {
                  const v = e.target.value;
                  set('percent', v === '' ? null : Math.max(0, Math.min(100, Number(v))));
                }}
                placeholder="10"
              />
              <p className="t-sub" style={{ marginTop: 6 }}>
                Between 0 and 100.
              </p>
            </div>
          ) : null}

          {form.type === 'amount' ? (
            <div className="field" style={{ maxWidth: 320 }}>
              <label htmlFor="amount">Amount off</label>
              <input
                id="amount"
                className="input"
                value={valueInput}
                onChange={e => setValueInput(e.target.value)}
                placeholder="100.00"
              />
              <p className="t-sub" style={{ marginTop: 6 }}>
                Major-unit amount; stored as integer minor units.
              </p>
            </div>
          ) : null}

          {form.type === 'free_shipping' ? (
            <p className="t-sub">
              Free shipping zeroes the shipping line at checkout. No additional fields
              are required.
            </p>
          ) : null}

          {form.type === 'bxgy' ? (
            <div className="grid-2" style={{ gap: 16, maxWidth: 440 }}>
              <div className="field">
                <label htmlFor="bxgy-buy">Buy quantity</label>
                <input
                  id="bxgy-buy"
                  className="input"
                  type="number"
                  min={1}
                  value={form.bxgyBuy ?? ''}
                  onChange={e => {
                    const v = e.target.value;
                    set('bxgyBuy', v === '' ? null : Math.max(1, Number(v)));
                  }}
                  placeholder="2"
                />
              </div>
              <div className="field">
                <label htmlFor="bxgy-get">Get quantity (free)</label>
                <input
                  id="bxgy-get"
                  className="input"
                  type="number"
                  min={1}
                  value={form.bxgyGet ?? ''}
                  onChange={e => {
                    const v = e.target.value;
                    set('bxgyGet', v === '' ? null : Math.max(1, Number(v)));
                  }}
                  placeholder="1"
                />
              </div>
            </div>
          ) : null}
        </div>

        <div className="panel panel-pad">
          <h3 style={{ fontFamily: 'var(--serif)', fontSize: 16, marginBottom: 16 }}>
            Eligibility &amp; window
          </h3>

          <div className="field" style={{ marginBottom: 16 }}>
            <label htmlFor="minSubtotal">Minimum cart subtotal</label>
            <input
              id="minSubtotal"
              className="input"
              value={minSubtotalInput}
              onChange={e => setMinSubtotalInput(e.target.value)}
              placeholder="0.00"
              style={{ maxWidth: 320 }}
            />
            <p className="t-sub" style={{ marginTop: 6 }}>
              Leave blank for no minimum.
            </p>
          </div>

          <div className="grid-2" style={{ gap: 16, marginBottom: 16 }}>
            <div className="field">
              <label htmlFor="startsAt">Starts at</label>
              <input
                id="startsAt"
                className="input"
                type="datetime-local"
                value={startsAtLocal}
                onChange={e => setStartsAtLocal(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="endsAt">Ends at</label>
              <input
                id="endsAt"
                className="input"
                type="datetime-local"
                value={endsAtLocal}
                onChange={e => setEndsAtLocal(e.target.value)}
              />
            </div>
          </div>

          <div className="grid-2" style={{ gap: 16 }}>
            <div className="field">
              <label htmlFor="usageLimit">Usage limit (total)</label>
              <input
                id="usageLimit"
                className="input"
                type="number"
                min={1}
                value={form.usageLimit ?? ''}
                onChange={e => {
                  const v = e.target.value;
                  set('usageLimit', v === '' ? null : Math.max(1, Number(v)));
                }}
                placeholder="Unlimited"
              />
            </div>
            <div className="field">
              <label htmlFor="perCustomerLimit">Usage limit (per customer)</label>
              <input
                id="perCustomerLimit"
                className="input"
                type="number"
                min={1}
                value={form.perCustomerLimit ?? ''}
                onChange={e => {
                  const v = e.target.value;
                  set('perCustomerLimit', v === '' ? null : Math.max(1, Number(v)));
                }}
                placeholder="Unlimited"
              />
            </div>
          </div>
        </div>
      </div>

      <aside className="stack" style={{ gap: 16 }}>
        <div className="panel panel-pad">
          <h3 style={{ fontFamily: 'var(--serif)', fontSize: 16, marginBottom: 14 }}>
            Configuration
          </h3>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Type</label>
            <Select
              value={form.type}
              onValueChange={v => set('type', v as PromotionType)}
              disabled={mode === 'edit'}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROMOTION_TYPES.map(t => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {mode === 'edit' ? (
              <p className="t-sub" style={{ marginTop: 6 }}>
                Type cannot be changed after creation.
              </p>
            ) : null}
          </div>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Status</label>
            <Select
              value={form.status}
              onValueChange={v => set('status', v as PromotionStatus)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROMOTION_STATUSES.map(s => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="field">
            <label htmlFor="stackable">Stackable</label>
            <Select
              value={form.stackable ? 'yes' : 'no'}
              onValueChange={v => set('stackable', v === 'yes')}
            >
              <SelectTrigger id="stackable">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="no">No</SelectItem>
                <SelectItem value="yes">Yes</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="panel panel-pad">
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => router.push('/admin/promotions' as Parameters<typeof router.push>[0])}
            >
              Back
            </button>
            {mode === 'edit' && form.status !== 'archived' ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={archive}
                disabled={pending}
              >
                Archive
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-clay btn-sm"
              onClick={save}
              disabled={pending}
            >
              {pending ? 'Saving…' : mode === 'create' ? 'Create promotion' : 'Save changes'}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
