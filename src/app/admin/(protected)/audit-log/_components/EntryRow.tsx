'use client';

import { useState } from 'react';
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

const ACTOR_PILL: Record<string, string> = {
  user: 'sp-active',
  system: 'sp-draft',
  webhook: 'sp-low',
  job: 'sp-low',
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
      <tr>
        <td className="t-sub" style={{ whiteSpace: 'nowrap' }}>
          {formatDateTime(entry.createdAt)}
        </td>
        <td>
          <div className="cellrow">
            <div>
              <span className={`statpill ${ACTOR_PILL[entry.actorType] ?? 'sp-draft'}`}>
                {entry.actorType}
              </span>
              <div className="t-sub" style={{ marginTop: 4 }}>{actorLabel}</div>
            </div>
          </div>
        </td>
        <td className="t-sub" style={{ fontFamily: 'ui-monospace,monospace' }}>
          {entry.action}
        </td>
        <td>
          <div>
            <div className="t-strong">{entry.entityType}</div>
            <div
              className="t-sub"
              style={{ fontFamily: 'ui-monospace,monospace' }}
              title={entry.entityId ?? ''}
            >
              {shortenId(entry.entityId)}
            </div>
          </div>
        </td>
        <td className="t-sub">{summary}</td>
        <td className="num">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setOpen(o => !o)}
            disabled={!hasPayload}
            aria-expanded={open}
            aria-controls={`audit-payload-${entry.id}`}
          >
            {open ? 'Hide' : 'View'}
          </button>
        </td>
      </tr>
      {open && hasPayload ? (
        <tr>
          <td colSpan={6} style={{ background: 'var(--paper-2)' }}>
            <pre
              id={`audit-payload-${entry.id}`}
              style={{
                maxHeight: '24rem',
                overflow: 'auto',
                borderRadius: 'var(--r-sm)',
                background: 'var(--card)',
                padding: 12,
                fontSize: 12,
              }}
            >
              {JSON.stringify(entry.diff, null, 2)}
            </pre>
          </td>
        </tr>
      ) : null}
    </>
  );
}
