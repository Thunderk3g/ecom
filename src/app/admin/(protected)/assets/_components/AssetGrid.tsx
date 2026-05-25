'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, ImageOff, Trash2, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  addTagAction,
  deleteAssetAction,
  removeTagAction,
} from '../_lib/actions';

export type GridAsset = {
  id: string;
  kind: 'image' | 'svg' | 'doc';
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  key: string;
  originalFilename: string | null;
  thumbUrl: string | null;
  pending: boolean;
  tags: string[];
  createdAt: string;
};

function formatBytes(n: number): string {
  if (n <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function AssetGrid({ assets }: { assets: GridAsset[] }) {
  const [selected, setSelected] = useState<GridAsset | null>(null);

  if (assets.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
        No assets match these filters. Upload your first file to get started.
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {assets.map(a => (
          <button
            key={a.id}
            type="button"
            onClick={() => setSelected(a)}
            className="group flex flex-col overflow-hidden rounded-lg border bg-background text-left transition-colors hover:border-primary"
          >
            <Thumb asset={a} />
            <div className="space-y-1 p-2">
              <p className="truncate text-xs font-medium" title={a.originalFilename ?? a.key}>
                {a.originalFilename ?? a.key}
              </p>
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span className="uppercase">{a.kind}</span>
                <span>{formatBytes(a.bytes)}</span>
              </div>
              {a.pending ? (
                <Badge variant="secondary" className="text-[10px]">
                  Processing…
                </Badge>
              ) : null}
            </div>
          </button>
        ))}
      </div>

      <AssetDetailDialog
        asset={selected}
        onClose={() => setSelected(null)}
      />
    </>
  );
}

function Thumb({ asset }: { asset: GridAsset }) {
  const base = 'flex aspect-square w-full items-center justify-center bg-muted';
  if (asset.kind === 'doc') {
    return (
      <div className={base}>
        <FileText className="h-10 w-10 text-muted-foreground" />
      </div>
    );
  }
  if (asset.thumbUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary tenant asset URLs (stub/R2), not optimized through next/image
    return (
      <img
        src={asset.thumbUrl}
        alt={asset.originalFilename ?? ''}
        className="aspect-square w-full bg-muted object-cover"
        loading="lazy"
      />
    );
  }
  return (
    <div className={base}>
      <ImageOff className="h-10 w-10 text-muted-foreground" />
    </div>
  );
}

function AssetDetailDialog({
  asset,
  onClose,
}: {
  asset: GridAsset | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newTag, setNewTag] = useState('');

  if (!asset) return null;

  const runDelete = () => {
    startTransition(async () => {
      const res = await deleteAssetAction(asset.id);
      if (res.ok) {
        toast.success('Asset deleted.');
        onClose();
        router.refresh();
      } else {
        toast.error(res.error ?? 'Delete failed.');
        setConfirmDelete(false);
      }
    });
  };

  const addTag = () => {
    const tag = newTag.trim();
    if (!tag) return;
    startTransition(async () => {
      const res = await addTagAction(asset.id, tag);
      if (res.ok) {
        setNewTag('');
        router.refresh();
      } else {
        toast.error(res.error ?? 'Could not add tag.');
      }
    });
  };

  const dropTag = (tag: string) => {
    startTransition(async () => {
      const res = await removeTagAction(asset.id, tag);
      if (res.ok) router.refresh();
      else toast.error(res.error ?? 'Could not remove tag.');
    });
  };

  return (
    <Dialog open={asset !== null} onOpenChange={next => { if (!next) { setConfirmDelete(false); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="truncate">{asset.originalFilename ?? asset.key}</DialogTitle>
          <DialogDescription>{asset.mime}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex justify-center rounded-lg border bg-muted p-2">
            {asset.kind !== 'doc' && asset.thumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- arbitrary tenant asset URL
              <img src={asset.thumbUrl} alt="" className="max-h-48 object-contain" />
            ) : (
              <FileText className="h-16 w-16 text-muted-foreground" />
            )}
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Kind</dt>
            <dd className="uppercase">{asset.kind}</dd>
            <dt className="text-muted-foreground">Size</dt>
            <dd>{formatBytes(asset.bytes)}</dd>
            <dt className="text-muted-foreground">Dimensions</dt>
            <dd>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : '—'}</dd>
            <dt className="text-muted-foreground">Key</dt>
            <dd className="truncate" title={asset.key}>{asset.key}</dd>
          </dl>

          <div className="space-y-2">
            <p className="text-sm font-medium">Tags</p>
            <div className="flex flex-wrap gap-1">
              {asset.tags.length === 0 ? (
                <span className="text-xs text-muted-foreground">No tags yet.</span>
              ) : (
                asset.tags.map(tag => (
                  <Badge key={tag} variant="secondary" className="gap-1">
                    {tag}
                    <button type="button" onClick={() => dropTag(tag)} disabled={pending} aria-label={`Remove ${tag}`}>
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))
              )}
            </div>
            <div className="flex gap-2">
              <Input
                value={newTag}
                onChange={e => setNewTag(e.target.value)}
                placeholder="Add a tag"
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTag();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addTag} disabled={pending || !newTag.trim()}>
                Add
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          {confirmDelete ? (
            <div className="flex w-full items-center justify-between gap-2">
              <span className="text-sm text-destructive">Delete permanently?</span>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={pending}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={runDelete} disabled={pending}>
                  {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                  Delete
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="destructive" onClick={() => setConfirmDelete(true)} disabled={pending}>
              <Trash2 className="mr-2 h-4 w-4" />
              Delete asset
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
