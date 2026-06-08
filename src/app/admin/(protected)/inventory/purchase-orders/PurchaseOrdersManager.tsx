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
import {
  createPurchaseOrderAction,
  updatePurchaseOrderStatusAction,
  receivePurchaseOrderAction,
} from '../actions';
import type { PurchaseOrderRow, PoStatus } from '@/modules/inventory/purchase-orders';
import type { SupplierRow } from '@/modules/inventory/suppliers';
import type { LocationRow } from '@/modules/inventory/locations';
import type { VariantRef } from './page';

// ─── Pill mapping ──────────────────────────────────────────────────────────────

const STATUS_PILL: Record<PoStatus, string> = {
  draft: 'statpill sp-draft',
  placed: 'statpill sp-active',
  partial: 'statpill sp-low',
  received: 'statpill sp-active',
  cancelled: 'statpill sp-out',
};

const STATUS_LABELS: Record<PoStatus, string> = {
  draft: 'Draft',
  placed: 'Placed',
  partial: 'Partial',
  received: 'Received',
  cancelled: 'Cancelled',
};

const ALL_STATUSES: PoStatus[] = ['draft', 'placed', 'partial', 'received', 'cancelled'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: Date | null): string {
  if (!d) return '—';
  // deterministic ISO slice avoids locale/tz hydration mismatch
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

function totalCents(items: PurchaseOrderRow['items']): number {
  return items.reduce((s, it) => s + it.costCents * it.qtyOrdered, 0);
}

function fmtRupees(cents: number): string {
  return `₹${(cents / 100).toFixed(2)}`;
}

// ─── Create dialog state ──────────────────────────────────────────────────────

type LineItemDraft = {
  variantId: string;
  qtyOrdered: string;
  costCents: string;
};

const EMPTY_LINE: LineItemDraft = { variantId: '', qtyOrdered: '', costCents: '' };

// ─── Receive dialog state ─────────────────────────────────────────────────────

type ReceiveLine = {
  variantId: string;
  qty: string;
};

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  pos: PurchaseOrderRow[];
  suppliers: SupplierRow[];
  variants: VariantRef[];
  locations: LocationRow[];
};

export function PurchaseOrdersManager({ pos, suppliers, variants, locations }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // supplier id→name map
  const supplierMap = new Map(suppliers.map(s => [s.id, s.name]));
  // variant id→{sku,name} map
  const variantMap = new Map(variants.map(v => [v.id, v]));

  // ── Create PO dialog ───────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [createSupplierId, setCreateSupplierId] = useState('');
  const [lineItems, setLineItems] = useState<LineItemDraft[]>([{ ...EMPTY_LINE }]);

  function resetCreate() {
    setCreateSupplierId('');
    setLineItems([{ ...EMPTY_LINE }]);
  }

  function addLine() {
    setLineItems(prev => [...prev, { ...EMPTY_LINE }]);
  }

  function removeLine(idx: number) {
    setLineItems(prev => prev.filter((_, i) => i !== idx));
  }

  function updateLine(idx: number, patch: Partial<LineItemDraft>) {
    setLineItems(prev => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function submitCreate() {
    if (!createSupplierId) {
      toast.error('Select a supplier');
      return;
    }
    const parsedItems = lineItems
      .map(l => ({
        variantId: l.variantId,
        qtyOrdered: parseInt(l.qtyOrdered, 10),
        costCents: parseInt(l.costCents, 10),
      }))
      .filter(it => it.variantId && it.qtyOrdered > 0 && it.costCents >= 0);

    if (parsedItems.length === 0) {
      toast.error('Add at least one valid line item (variant, qty > 0, cost ≥ 0)');
      return;
    }

    startTransition(async () => {
      const res = await createPurchaseOrderAction({
        supplierId: createSupplierId,
        items: parsedItems,
      });
      if (res.ok) {
        toast.success('Purchase order created');
        setCreateOpen(false);
        resetCreate();
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  // ── Status update ─────────────────────────────────────────────────────────
  function changeStatus(id: string, status: PoStatus) {
    startTransition(async () => {
      const res = await updatePurchaseOrderStatusAction(id, status);
      if (res.ok) {
        toast.success('Status updated');
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  // ── Receive dialog ────────────────────────────────────────────────────────
  const [receivePo, setReceivePo] = useState<PurchaseOrderRow | null>(null);
  const [receiveLocationId, setReceiveLocationId] = useState('');
  const [receiveLines, setReceiveLines] = useState<ReceiveLine[]>([]);

  function openReceive(po: PurchaseOrderRow) {
    setReceivePo(po);
    setReceiveLocationId(locations[0]?.id ?? '');
    setReceiveLines(
      po.items.map(it => ({
        variantId: it.variantId,
        qty: String(it.qtyOrdered - it.qtyReceived),
      })),
    );
  }

  function updateReceiveLine(variantId: string, qty: string) {
    setReceiveLines(prev =>
      prev.map(l => (l.variantId === variantId ? { ...l, qty } : l)),
    );
  }

  function submitReceive() {
    if (!receivePo) return;
    if (!receiveLocationId) {
      toast.error('Select a destination location');
      return;
    }
    const items = receiveLines
      .map(l => ({ variantId: l.variantId, qty: parseInt(l.qty, 10), locationId: receiveLocationId }))
      .filter(it => it.qty > 0);

    if (items.length === 0) {
      toast.error('Enter a quantity > 0 for at least one item');
      return;
    }

    startTransition(async () => {
      const res = await receivePurchaseOrderAction({ poId: receivePo.id, items });
      if (res.ok) {
        toast.success('Items received');
        setReceivePo(null);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Create PO dialog trigger */}
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="btn btn-clay btn-sm"
          onClick={() => {
            resetCreate();
            setCreateOpen(true);
          }}
        >
          + New purchase order
        </button>
      </div>

      {/* PO table */}
      <div className="panel">
        <table className="dtable">
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Status</th>
              <th>Placed</th>
              <th className="num">Items</th>
              <th className="num">Total</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {pos.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '40px 16px' }}
                >
                  No purchase orders yet.
                </td>
              </tr>
            ) : (
              pos.map(po => {
                const canReceive = po.status === 'placed' || po.status === 'partial';
                return (
                  <tr key={po.id}>
                    <td className="t-strong">
                      {supplierMap.get(po.supplierId) ?? po.supplierId}
                    </td>
                    <td>
                      <span className={STATUS_PILL[po.status]}>
                        {STATUS_LABELS[po.status]}
                      </span>
                    </td>
                    <td className="t-sub">{fmtDate(po.placedAt)}</td>
                    <td className="num">{po.items.length}</td>
                    <td className="num">{fmtRupees(totalCents(po.items))}</td>
                    <td>
                      <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                        <Select
                          value={po.status}
                          onValueChange={v => changeStatus(po.id, v as PoStatus)}
                          disabled={pending}
                        >
                          <SelectTrigger className="btn btn-ghost btn-sm" style={{ width: 120 }}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ALL_STATUSES.map(s => (
                              <SelectItem key={s} value={s}>
                                {STATUS_LABELS[s]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {canReceive ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => openReceive(po)}
                            disabled={pending}
                          >
                            Receive
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Create PO dialog ──────────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={open => { if (!open) { setCreateOpen(false); resetCreate(); } else { setCreateOpen(true); } }}>
        <DialogContent style={{ maxWidth: 600 }}>
          <DialogHeader>
            <DialogTitle>New purchase order</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Supplier */}
            <div className="space-y-1.5">
              <Label>Supplier</Label>
              <Select value={createSupplierId} onValueChange={setCreateSupplierId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a supplier…" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Line items */}
            <div>
              <Label>Line items</Label>
              <div className="space-y-2" style={{ marginTop: 6 }}>
                {lineItems.map((line, idx) => (
                  <div key={idx} className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
                    {/* Variant */}
                    <div style={{ flex: 3 }}>
                      <Select
                        value={line.variantId}
                        onValueChange={v => updateLine(idx, { variantId: v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Variant…" />
                        </SelectTrigger>
                        <SelectContent>
                          {variants.map(v => (
                            <SelectItem key={v.id} value={v.id}>
                              {v.sku}{v.name ? ` — ${v.name}` : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Qty */}
                    <div style={{ flex: 1 }}>
                      <Input
                        type="number"
                        min={1}
                        placeholder="Qty"
                        value={line.qtyOrdered}
                        onChange={e => updateLine(idx, { qtyOrdered: e.target.value })}
                      />
                    </div>

                    {/* Cost cents */}
                    <div style={{ flex: 1 }}>
                      <Input
                        type="number"
                        min={0}
                        placeholder="Cost (¢)"
                        value={line.costCents}
                        onChange={e => updateLine(idx, { costCents: e.target.value })}
                      />
                    </div>

                    {/* Remove */}
                    {lineItems.length > 1 ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => removeLine(idx)}
                        style={{ flexShrink: 0 }}
                      >
                        ✕
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={addLine}
                style={{ marginTop: 8 }}
              >
                + Add line
              </button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateOpen(false); resetCreate(); }}>
              Cancel
            </Button>
            <Button onClick={submitCreate} disabled={pending}>
              {pending ? 'Creating…' : 'Create PO'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Receive dialog ─────────────────────────────────────────────────── */}
      <Dialog open={receivePo !== null} onOpenChange={open => { if (!open) setReceivePo(null); }}>
        <DialogContent style={{ maxWidth: 560 }}>
          <DialogHeader>
            <DialogTitle>
              Receive — {receivePo ? (supplierMap.get(receivePo.supplierId) ?? 'PO') : ''}
            </DialogTitle>
          </DialogHeader>

          {receivePo ? (
            <div className="space-y-4">
              {/* Destination location */}
              <div className="space-y-1.5">
                <Label>Destination location</Label>
                <Select value={receiveLocationId} onValueChange={setReceiveLocationId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select location…" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map(loc => (
                      <SelectItem key={loc.id} value={loc.id}>
                        {loc.name} ({loc.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Per-item received qty */}
              <div>
                <Label>Quantities to receive</Label>
                <div className="space-y-2" style={{ marginTop: 6 }}>
                  {receiveLines.map(line => {
                    const poItem = receivePo.items.find(it => it.variantId === line.variantId);
                    const outstanding = poItem ? poItem.qtyOrdered - poItem.qtyReceived : 0;
                    const vref = variantMap.get(line.variantId);
                    const label = vref ? `${vref.sku}${vref.name ? ` — ${vref.name}` : ''}` : line.variantId;
                    return (
                      <div key={line.variantId} className="row" style={{ gap: 8, alignItems: 'center' }}>
                        <span style={{ flex: 3, fontSize: 13 }}>
                          {label}
                          <span className="t-sub" style={{ marginLeft: 6 }}>
                            (outstanding: {outstanding})
                          </span>
                        </span>
                        <div style={{ flex: 1 }}>
                          <Input
                            type="number"
                            min={0}
                            max={outstanding}
                            value={line.qty}
                            onChange={e => updateReceiveLine(line.variantId, e.target.value)}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setReceivePo(null)}>
              Cancel
            </Button>
            <Button onClick={submitReceive} disabled={pending}>
              {pending ? 'Recording…' : 'Record receipt'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
