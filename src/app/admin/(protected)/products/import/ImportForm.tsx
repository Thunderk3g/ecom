'use client';

import { useState } from 'react';
import { toast } from 'sonner';

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function ImportForm() {
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      toast.error('Choose a CSV file first');
      return;
    }
    setSubmitting(true);
    setJobId(null);
    try {
      const body = new FormData();
      body.set('file', file);
      const res = await fetch('/api/v1/admin/catalog/products/import', {
        method: 'POST',
        headers: { 'Idempotency-Key': uuid() },
        body,
      });
      if (res.status === 202) {
        const json = (await res.json()) as { data?: { jobId?: string | null } };
        setJobId(json.data?.jobId ?? null);
        toast.success('Import queued');
      } else {
        const json = (await res.json().catch(() => null)) as { detail?: string } | null;
        toast.error(json?.detail ?? `Upload failed (${res.status})`);
      }
    } catch {
      toast.error('Upload failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>CSV upload</h3>
      </div>
      <div className="panel-pad stack" style={{ gap: 16 }}>
        <p className="t-sub">
          Columns: <code>slug, name, brand, category_slug, sku, price, status</code>.
          Each row maps to a product + its primary variant. The worker validates
          and reports per-row errors after processing.
        </p>
        <form onSubmit={submit} className="stack" style={{ gap: 16 }}>
          <div className="field">
            <label htmlFor="file">CSV file</label>
            <input
              id="file"
              className="input"
              type="file"
              accept=".csv,text/csv"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="row">
            <button type="submit" className="btn btn-clay btn-sm" disabled={submitting}>
              {submitting ? 'Uploading…' : 'Upload & queue'}
            </button>
          </div>
        </form>
        {jobId ? (
          <p className="t-sub">
            Queued as job <code>{jobId}</code>. Results appear once the worker
            finishes processing.
          </p>
        ) : null}
      </div>
    </div>
  );
}
