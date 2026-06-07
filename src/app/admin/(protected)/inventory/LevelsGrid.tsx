'use client';

import { useState, useTransition, type CSSProperties } from 'react';
import Link from 'next/link';
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
import { adjustStockAction } from './actions';

export type LevelRow = {
  variantId: string;
  locationId: string;
  sku: string;
  variantName: string | null;
  locationName: string;
  onHand: number;
  reserved: number;
  available: number;
  reorderPoint: number | null;
  low: boolean;
};

/** Inline styles matching the `.seg button` / `.seg button.on` look for anchor toggles. */
function segStyle(active: boolean): CSSProperties {
  return {
    padding: '7px 14px',
    borderRadius: 'var(--r-pill)',
    fontSize: '12.5px',
    fontWeight: 600,
    color: active ? 'var(--ink)' : 'var(--ink-3)',
    background: active ? 'var(--card)' : 'none',
    boxShadow: active ? 'var(--shadow-card)' : 'none',
  };
}

export function LevelsGrid({ rows, lowOnly }: { rows: LevelRow[]; lowOnly: boolean }) {
  const [target, setTarget] = useState<LevelRow | null>(null);
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();

  function openAdjust(row: LevelRow) {
    setTarget(row);
    setDelta('');
    setReason('');
  }

  function submit() {
    if (!target) return;
    const d = Number.parseInt(delta, 10);
    if (!Number.isFinite(d) || d === 0) {
      toast.error('Enter a non-zero delta');
      return;
    }
    startTransition(async () => {
      const res = await adjustStockAction({
        variantId: target.variantId,
        locationId: target.locationId,
        delta: d,
        reason: reason.trim() || 'manual_correction',
      });
      if (res.ok) {
        toast.success('Stock adjusted');
        setTarget(null);
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <>
      <div className="panel">
        <div className="tbar">
          <div className="seg">
            <Link
              href={'/admin/inventory' as Parameters<typeof Link>[0]['href']}
              style={segStyle(!lowOnly)}
            >
              All
            </Link>
            <Link
              href={'/admin/inventory?lowOnly=true' as Parameters<typeof Link>[0]['href']}
              style={segStyle(lowOnly)}
            >
              Low stock only
            </Link>
          </div>
        </div>
        <table className="dtable">
          <thead>
            <tr>
              <th>Variant</th>
              <th>Location</th>
              <th className="num">On hand</th>
              <th className="num">Reserved</th>
              <th className="num">Available</th>
              <th className="num">Reorder point</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '40px 16px' }}>
                  No stock records.
                </td>
              </tr>
            ) : (
              rows.map(row => (
                <tr key={`${row.variantId}:${row.locationId}`}>
                  <td>
                    <div className="cellrow">
                      <div>
                        <div className="t-strong">{row.sku}</div>
                        {row.variantName ? (
                          <div className="t-sub">{row.variantName}</div>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td>{row.locationName}</td>
                  <td className="num">{row.onHand}</td>
                  <td className="num">{row.reserved}</td>
                  <td className="num t-strong">{row.available}</td>
                  <td className="num t-sub">{row.reorderPoint ?? '—'}</td>
                  <td>
                    {row.available <= 0 ? (
                      <span className="statpill sp-out">Out</span>
                    ) : row.low ? (
                      <span className="statpill sp-low">Low</span>
                    ) : (
                      <span className="statpill sp-active">In stock</span>
                    )}
                  </td>
                  <td className="num">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => openAdjust(row)}
                    >
                      Adjust
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={target !== null} onOpenChange={o => (o ? null : setTarget(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust stock</DialogTitle>
          </DialogHeader>
          {target ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {target.sku} @ {target.locationName} — currently {target.onHand} on hand.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="delta">Delta (+/-)</Label>
                <Input
                  id="delta"
                  type="number"
                  value={delta}
                  onChange={e => setDelta(e.target.value)}
                  placeholder="e.g. -2 or 10"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reason">Reason</Label>
                <Input
                  id="reason"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="recount / shrinkage / correction"
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? 'Saving…' : 'Apply adjustment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
