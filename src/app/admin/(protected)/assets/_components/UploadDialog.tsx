'use client';

import { useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

type UploadUrlResponse = {
  data: {
    assetId: string;
    key: string;
    uploadUrl: string;
    headers: Record<string, string>;
    kind: string;
  };
};

type FileState = {
  name: string;
  status: 'pending' | 'uploading' | 'finalizing' | 'done' | 'error';
  error?: string;
};

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function UploadDialog({ csrfToken }: { csrfToken: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<FileState[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadOne = useCallback(
    async (file: File, idx: number): Promise<boolean> => {
      const setStatus = (status: FileState['status'], error?: string) =>
        setFiles(prev => prev.map((f, i) => (i === idx ? { ...f, status, error } : f)));

      try {
        setStatus('uploading');
        // 1. presign
        const presignRes = await fetch('/api/v1/admin/media/upload-url', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
            'idempotency-key': uuid(),
          },
          body: JSON.stringify({
            filename: file.name,
            mime: file.type || 'application/octet-stream',
            bytes: file.size,
          }),
        });
        if (!presignRes.ok) {
          setStatus('error', `Presign failed (${presignRes.status})`);
          return false;
        }
        const presign = (await presignRes.json()) as UploadUrlResponse;
        const { assetId, uploadUrl, headers } = presign.data;

        // 2. PUT bytes to the (stub or R2) upload URL
        const putRes = await fetch(uploadUrl, {
          method: 'PUT',
          headers,
          body: file,
        });
        if (!putRes.ok) {
          setStatus('error', `Upload failed (${putRes.status})`);
          return false;
        }

        // 3. finalize — read dimensions for images when possible
        setStatus('finalizing');
        const dims = await readImageDimensions(file);
        const finalizeRes = await fetch(`/api/v1/admin/media/${assetId}/finalize`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
            'idempotency-key': uuid(),
          },
          body: JSON.stringify({
            bytes: file.size,
            ...(dims ? { width: dims.width, height: dims.height } : {}),
          }),
        });
        if (!finalizeRes.ok) {
          setStatus('error', `Finalize failed (${finalizeRes.status})`);
          return false;
        }
        setStatus('done');
        return true;
      } catch {
        setStatus('error', 'Network error');
        return false;
      }
    },
    [csrfToken],
  );

  const handleFiles = useCallback(
    async (list: FileList) => {
      const selected = Array.from(list);
      if (selected.length === 0) return;
      setFiles(selected.map(f => ({ name: f.name, status: 'pending' as const })));
      setBusy(true);
      let success = 0;
      for (let i = 0; i < selected.length; i++) {
        const ok = await uploadOne(selected[i]!, i);
        if (ok) success += 1;
      }
      setBusy(false);
      if (success > 0) {
        toast.success(`Uploaded ${success} file${success === 1 ? '' : 's'}.`);
        router.refresh();
      }
      if (success < selected.length) {
        toast.error(`${selected.length - success} upload(s) failed.`);
      }
    },
    [router, uploadOne],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!busy) {
          setOpen(next);
          if (!next) setFiles([]);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Upload className="mr-2 h-4 w-4" />
          Upload
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload assets</DialogTitle>
          <DialogDescription>
            Select one or more files. Images, SVGs, and documents are supported.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={e => {
              if (e.target.files) void handleFiles(e.target.files);
            }}
          />
          <Button
            variant="outline"
            className="w-full"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Uploading…
              </>
            ) : (
              'Choose files'
            )}
          </Button>

          {files.length > 0 ? (
            <ul className="max-h-60 space-y-1 overflow-y-auto text-sm">
              {files.map((f, i) => (
                <li
                  key={`${f.name}-${i}`}
                  className="flex items-center justify-between gap-2 rounded border px-3 py-2"
                >
                  <span className="truncate">{f.name}</span>
                  <StatusLabel state={f} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatusLabel({ state }: { state: FileState }) {
  switch (state.status) {
    case 'pending':
      return <span className="text-muted-foreground">Queued</span>;
    case 'uploading':
      return <span className="text-muted-foreground">Uploading…</span>;
    case 'finalizing':
      return <span className="text-muted-foreground">Finalizing…</span>;
    case 'done':
      return <span className="font-medium text-emerald-600">Done</span>;
    case 'error':
      return <span className="font-medium text-destructive">{state.error ?? 'Failed'}</span>;
  }
}

/** Read intrinsic dimensions of an image file in the browser (best effort). */
function readImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
    return Promise.resolve(null);
  }
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}
