'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableCell, TableRow } from '@/components/ui/table';
import { formatDateTime } from '@/lib/format';

export type AuditEntry = {
  id: string;
  createdAt: string;
  actorType: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  diff: Record<string, unknown> | null;
};

const ACTOR_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  user: 'default',
  system: 'secondary',
  webhook: 'outline',
  job: 'outline',
};

/**
 * Best-effort one-line summary of the diff payload. Shows the changed keys for
 * `{ before, after }` shaped diffs; falls back to the top-level keys otherwise.
 */
function summarize(diff: Record<string, unknown> | null): string {
  if (!diff) return '—';
  const before = (diff as { before?: unknown }).before;
  const after = (diff as { after?: unknown }).after;
  if (
    before !== undefined &&
    after !== undefined &&
    before !== null &&
    after !== null &&
    typeof before === 'object' &&
    typeof after === 'object'
  ) {
    const keys = new Set<string>([
      ...Object.keys(before as Record<string, unknown>),
      ...Object.keys(after as Record<string, unknown>),
    ]);
    const changed: string[] = [];
    for (const k of keys) {
      const b = (before as Record<string, unknown>)[k];
      const a = (after as Record<string, unknown>)[k];
      if (JSON.stringify(b) !== JSON.stringify(a)) changed.push(k);
    }
    if (changed.length === 0) return 'no field changes';
    return `${changed.length} field${changed.length === 1 ? '' : 's'}: ${changed.slice(0, 4).join(', ')}${changed.length > 4 ? '…' : ''}`;
  }
  const topKeys = Object.keys(diff);
  if (topKeys.length === 0) return '—';
  return topKeys.slice(0, 4).join(', ') + (topKeys.length > 4 ? '…' : '');
}

function shortenId(id: string | null): string {
  if (!id) return '—';
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

export function EntryRow({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = useState(false);
  const actorLabel = entry.actorEmail ?? entry.actorType;
  const summary = summarize(entry.diff);
  const hasPayload = entry.diff !== null;

  return (
    <>
      <TableRow>
        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
          {formatDateTime(entry.createdAt)}
        </TableCell>
        <TableCell>
          <div className="flex flex-col gap-1">
            <Badge variant={ACTOR_VARIANT[entry.actorType] ?? 'secondary'}>
              {entry.actorType}
            </Badge>
            <span className="text-xs text-muted-foreground">{actorLabel}</span>
          </div>
        </TableCell>
        <TableCell className="font-mono text-xs">{entry.action}</TableCell>
        <TableCell>
          <div className="flex flex-col">
            <span className="text-sm">{entry.entityType}</span>
            <span
              className="font-mono text-xs text-muted-foreground"
              title={entry.entityId ?? ''}
            >
              {shortenId(entry.entityId)}
            </span>
          </div>
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {summary}
        </TableCell>
        <TableCell className="text-right">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setOpen(o => !o)}
            disabled={!hasPayload}
            aria-expanded={open}
            aria-controls={`audit-payload-${entry.id}`}
          >
            {open ? 'Hide' : 'View'}
          </Button>
        </TableCell>
      </TableRow>
      {open && hasPayload ? (
        <TableRow>
          <TableCell colSpan={6} className="bg-muted/30">
            <pre
              id={`audit-payload-${entry.id}`}
              className="max-h-96 overflow-auto rounded-md bg-background p-3 text-xs"
            >
              {JSON.stringify(entry.diff, null, 2)}
            </pre>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}
