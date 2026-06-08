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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { setThresholdAction } from '../actions';
import type { ThresholdRow } from '@/modules/inventory/thresholds';
import type { LocationRow } from '@/modules/inventory/locations';

type VariantRef = { id: string; sku: string; name: string | null };

interface Props {
  thresholds: ThresholdRow[];
  variants: VariantRef[];
  locations: LocationRow[];
}

interface DialogState {
  mode: 'new' | 'edit';
  variantId: string;
  locationId: string;
  reorderPoint: string;
  reorderQty: string;
}

function emptyDialog(): DialogState {
  return { mode: 'new', variantId: '', locationId: '', reorderPoint: '', reorderQty: '' };
}

export function ThresholdsManager({ thresholds, variants, locations }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(emptyDialog());
  const [pending, startTransition] = useTransition();

  function openNew() {
    setDialog(emptyDialog());
    setOpen(true);
  }

  function openEdit(t: ThresholdRow) {
    setDialog({
      mode: 'edit',
      variantId: t.variantId,
      locationId: t.locationId,
      reorderPoint: String(t.reorderPoint),
      reorderQty: String(t.reorderQty),
    });
    setOpen(true);
  }

  function closeDialog() {
    setOpen(false);
  }

  function submit() {
    const rp = Number.parseInt(dialog.reorderPoint, 10);
    const rq = Number.parseInt(dialog.reorderQty, 10);

    if (!dialog.variantId) {
      toast.error('Select a variant');
      return;
    }
    if (!dialog.locationId) {
      toast.error('Select a location');
      return;
    }
    if (!Number.isFinite(rp) || rp < 0) {
      toast.error('Reorder point must be a non-negative integer');
      return;
    }
    if (!Number.isFinite(rq) || rq < 0) {
      toast.error('Reorder qty must be a non-negative integer');
      return;
    }

    startTransition(async () => {
      const res = await setThresholdAction({
        variantId: dialog.variantId,
        locationId: dialog.locationId,
        reorderPoint: rp,
        reorderQty: rq,
      });
      if (res.ok) {
        toast.success(dialog.mode === 'new' ? 'Threshold set' : 'Threshold updated');
        closeDialog();
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function variantLabel(variantId: string) {
    const v = variants.find(x => x.id === variantId);
    if (!v) return variantId;
    return v.name ? `${v.sku} — ${v.name}` : v.sku;
  }

  function locationLabel(locationId: string) {
    return locations.find(x => x.id === locationId)?.name ?? locationId;
  }

  const isEdit = dialog.mode === 'edit';

  return (
    <>
      <div className="panel">
        <div className="tbar">
          <span className="t-sub">{thresholds.length} threshold{thresholds.length !== 1 ? 's' : ''}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={openNew}>
            Set threshold
          </button>
        </div>
        <table className="dtable">
          <thead>
            <tr>
              <th>Variant</th>
              <th>Location</th>
              <th className="num">Reorder point</th>
              <th className="num">Reorder qty</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {thresholds.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '40px 16px' }}>
                  No thresholds configured. Use &ldquo;Set threshold&rdquo; to add one.
                </td>
              </tr>
            ) : (
              thresholds.map(t => {
                const v = variants.find(x => x.id === t.variantId);
                const loc = locations.find(x => x.id === t.locationId);
                return (
                  <tr key={`${t.variantId}:${t.locationId}`}>
                    <td>
                      <div className="t-strong">{v?.sku ?? t.variantId}</div>
                      {v?.name ? <div className="t-sub">{v.name}</div> : null}
                    </td>
                    <td>{loc?.name ?? t.locationId}</td>
                    <td className="num">{t.reorderPoint}</td>
                    <td className="num">{t.reorderQty}</td>
                    <td className="num">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => openEdit(t)}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={o => (o ? null : closeDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isEdit ? 'Edit threshold' : 'Set threshold'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="thresh-variant">Variant</Label>
              {isEdit ? (
                <p className="text-sm text-muted-foreground">{variantLabel(dialog.variantId)}</p>
              ) : (
                <Select
                  value={dialog.variantId}
                  onValueChange={v => setDialog(d => ({ ...d, variantId: v }))}
                >
                  <SelectTrigger id="thresh-variant">
                    <SelectValue placeholder="Select variant…" />
                  </SelectTrigger>
                  <SelectContent>
                    {variants.map(v => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name ? `${v.sku} — ${v.name}` : v.sku}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="thresh-location">Location</Label>
              {isEdit ? (
                <p className="text-sm text-muted-foreground">{locationLabel(dialog.locationId)}</p>
              ) : (
                <Select
                  value={dialog.locationId}
                  onValueChange={v => setDialog(d => ({ ...d, locationId: v }))}
                >
                  <SelectTrigger id="thresh-location">
                    <SelectValue placeholder="Select location…" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map(loc => (
                      <SelectItem key={loc.id} value={loc.id}>
                        {loc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="thresh-rp">Reorder point</Label>
              <Input
                id="thresh-rp"
                type="number"
                min={0}
                value={dialog.reorderPoint}
                onChange={e => setDialog(d => ({ ...d, reorderPoint: e.target.value }))}
                placeholder="e.g. 10"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="thresh-rq">Reorder qty</Label>
              <Input
                id="thresh-rq"
                type="number"
                min={0}
                value={dialog.reorderQty}
                onChange={e => setDialog(d => ({ ...d, reorderQty: e.target.value }))}
                placeholder="e.g. 50"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? 'Saving…' : isEdit ? 'Update' : 'Set threshold'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
