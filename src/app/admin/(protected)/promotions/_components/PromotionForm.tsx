'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
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
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="Diwali sale"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="code">Code</Label>
              <Input
                id="code"
                value={form.code}
                onChange={e => set('code', e.target.value)}
                placeholder="Leave blank for auto-promo"
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to make this an automatic promotion (no coupon required).
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Type</Label>
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
                <p className="text-xs text-muted-foreground">
                  Type cannot be changed after creation.
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
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
            <div className="space-y-1.5">
              <Label htmlFor="stackable">Stackable</Label>
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
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div>
            <h2 className="text-sm font-semibold">Value</h2>
            <p className="text-xs text-muted-foreground">
              Fields below depend on the promotion type.
            </p>
          </div>
          <Separator />

          {form.type === 'percent' ? (
            <div className="space-y-1.5 sm:max-w-xs">
              <Label htmlFor="percent">Percent off</Label>
              <Input
                id="percent"
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
              <p className="text-xs text-muted-foreground">
                Between 0 and 100.
              </p>
            </div>
          ) : null}

          {form.type === 'amount' ? (
            <div className="space-y-1.5 sm:max-w-xs">
              <Label htmlFor="amount">Amount off</Label>
              <Input
                id="amount"
                value={valueInput}
                onChange={e => setValueInput(e.target.value)}
                placeholder="100.00"
              />
              <p className="text-xs text-muted-foreground">
                Major-unit amount; stored as integer minor units.
              </p>
            </div>
          ) : null}

          {form.type === 'free_shipping' ? (
            <p className="text-sm text-muted-foreground">
              Free shipping zeroes the shipping line at checkout. No additional fields
              are required.
            </p>
          ) : null}

          {form.type === 'bxgy' ? (
            <div className="grid gap-4 sm:grid-cols-2 sm:max-w-md">
              <div className="space-y-1.5">
                <Label htmlFor="bxgy-buy">Buy quantity</Label>
                <Input
                  id="bxgy-buy"
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
              <div className="space-y-1.5">
                <Label htmlFor="bxgy-get">Get quantity (free)</Label>
                <Input
                  id="bxgy-get"
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
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <h2 className="text-sm font-semibold">Eligibility &amp; window</h2>
          <Separator />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="minSubtotal">Minimum cart subtotal</Label>
              <Input
                id="minSubtotal"
                value={minSubtotalInput}
                onChange={e => setMinSubtotalInput(e.target.value)}
                placeholder="0.00"
              />
              <p className="text-xs text-muted-foreground">
                Leave blank for no minimum.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="startsAt">Starts at</Label>
              <Input
                id="startsAt"
                type="datetime-local"
                value={startsAtLocal}
                onChange={e => setStartsAtLocal(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="endsAt">Ends at</Label>
              <Input
                id="endsAt"
                type="datetime-local"
                value={endsAtLocal}
                onChange={e => setEndsAtLocal(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="usageLimit">Usage limit (total)</Label>
              <Input
                id="usageLimit"
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
            <div className="space-y-1.5">
              <Label htmlFor="perCustomerLimit">Usage limit (per customer)</Label>
              <Input
                id="perCustomerLimit"
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
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => router.push('/admin/promotions' as Parameters<typeof router.push>[0])}
        >
          Back
        </Button>
        {mode === 'edit' && form.status !== 'archived' ? (
          <Button variant="outline" onClick={archive} disabled={pending}>
            Archive
          </Button>
        ) : null}
        <Button onClick={save} disabled={pending}>
          {pending ? 'Saving…' : mode === 'create' ? 'Create promotion' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}
