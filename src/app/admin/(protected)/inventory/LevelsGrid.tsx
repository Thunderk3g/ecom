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
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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

export function LevelsGrid({ rows }: { rows: LevelRow[] }) {
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
      <div className="rounded-md border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Location</TableHead>
              <TableHead className="text-right">On hand</TableHead>
              <TableHead className="text-right">Reserved</TableHead>
              <TableHead className="text-right">Available</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  No stock records.
                </TableCell>
              </TableRow>
            ) : (
              rows.map(row => (
                <TableRow key={`${row.variantId}:${row.locationId}`}>
                  <TableCell>
                    <div className="font-medium">{row.sku}</div>
                    {row.variantName ? (
                      <div className="text-xs text-muted-foreground">{row.variantName}</div>
                    ) : null}
                  </TableCell>
                  <TableCell>{row.locationName}</TableCell>
                  <TableCell className="text-right">{row.onHand}</TableCell>
                  <TableCell className="text-right">{row.reserved}</TableCell>
                  <TableCell className="text-right">
                    <span className="inline-flex items-center gap-2">
                      {row.available}
                      {row.low ? <Badge variant="destructive">Low</Badge> : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => openAdjust(row)}>
                      Adjust
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
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
