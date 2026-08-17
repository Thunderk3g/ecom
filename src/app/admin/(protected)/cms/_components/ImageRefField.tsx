'use client';

import { useCallback, useEffect, useState } from 'react';
import { ImageIcon, Loader2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { listImageAssetsAction, type PickableAsset } from '../_lib/actions';

/**
 * Image reference editor for CMS blocks.
 *
 * Replaces the raw JSON textarea that used to back `image` fields — authors had
 * to hand-type `{"assetId":"<uuid>"}`, with no way to see what an id pointed at
 * and no feedback when it pointed at nothing.
 *
 * Picking from the library stores `{ assetId, alt }` and deliberately drops any
 * previous `url`: the storefront derives the URL at render time (see
 * `resolveBlockAssets`), so persisting one here would go stale the moment the
 * media provider or its bucket changes. The external-URL escape hatch remains
 * for images that genuinely live off-platform.
 */

interface ImageRef {
  assetId?: string;
  url?: string;
  alt?: string;
}

/**
 * One in-flight fetch shared by every field on the page — a page with a hero
 * and three banners should cost one request, not four. The cache lives as long
 * as the client bundle does, so an upload made in another tab (or on the Assets
 * page in this one) won't appear until the dialog's Refresh button clears it.
 */
let assetsPromise: Promise<PickableAsset[]> | null = null;
function loadAssets(force = false): Promise<PickableAsset[]> {
  if (force || !assetsPromise) {
    assetsPromise = listImageAssetsAction()
      .then(res => (res.ok ? res.assets : []))
      .catch(() => []);
  }
  return assetsPromise;
}

export function ImageRefField({
  id,
  value,
  onChange,
  required,
  help,
}: {
  id: string;
  value: unknown;
  onChange: (value: ImageRef | undefined) => void;
  required: boolean;
  help?: string;
}) {
  const ref: ImageRef =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as ImageRef)
      : {};

  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<PickableAsset[] | null>(null);
  const [loading, setLoading] = useState(false);

  const ensureAssets = useCallback(
    (force = false) => {
      if (assets !== null && !force) return;
      setLoading(true);
      void loadAssets(force).then(list => {
        setAssets(list);
        setLoading(false);
      });
    },
    [assets],
  );

  // Resolve a preview for an already-stored assetId so reopening the editor
  // shows the actual image rather than a bare uuid.
  useEffect(() => {
    if (ref.assetId && assets === null) ensureAssets();
  }, [ref.assetId, assets, ensureAssets]);

  const selected = ref.assetId ? assets?.find(a => a.id === ref.assetId) : undefined;
  const previewUrl = ref.url ?? selected?.thumbUrl ?? null;

  function patch(next: Partial<ImageRef>, drop: (keyof ImageRef)[] = []) {
    const merged: ImageRef = { ...ref, ...next };
    for (const k of drop) delete merged[k];
    for (const k of Object.keys(merged) as (keyof ImageRef)[]) {
      if (merged[k] === undefined || merged[k] === '') delete merged[k];
    }
    // An image ref with neither assetId nor url fails server validation, so an
    // emptied field must become "absent" rather than "{}".
    onChange(merged.assetId || merged.url ? merged : undefined);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- admin preview of an arbitrary remote/derived URL
            <img src={previewUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImageIcon className="h-6 w-6 text-muted-foreground" aria-hidden />
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                ensureAssets();
                setOpen(true);
              }}
            >
              {ref.assetId || ref.url ? 'Replace image' : 'Choose from library'}
            </Button>
            {ref.assetId || ref.url ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange(undefined)}
              >
                <X className="mr-1 h-3.5 w-3.5" />
                Clear
              </Button>
            ) : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {ref.assetId
              ? selected
                ? `Library: ${selected.filename}`
                : assets === null
                  ? 'Library asset — loading…'
                  : 'Library asset no longer exists — pick another.'
              : ref.url
                ? `External: ${ref.url}`
                : required
                  ? 'Required — no image selected yet.'
                  : 'No image selected.'}
          </p>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`${id}-alt`} className="text-xs">
            Alt text
          </Label>
          <Input
            id={`${id}-alt`}
            value={ref.alt ?? ''}
            placeholder="Describe the image"
            onChange={e => patch({ alt: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-url`} className="text-xs">
            …or external URL
          </Label>
          <Input
            id={`${id}-url`}
            value={ref.url ?? ''}
            placeholder="https://…"
            // An external URL and a library asset are mutually exclusive.
            onChange={e => patch({ url: e.target.value }, e.target.value ? ['assetId'] : [])}
          />
        </div>
      </div>

      {help ? <p className="text-xs text-muted-foreground">{help}</p> : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Choose an image</DialogTitle>
            <DialogDescription>
              Images and SVGs from this store&apos;s asset library, newest first.
            </DialogDescription>
          </DialogHeader>

          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={loading}
              onClick={() => ensureAssets(true)}
            >
              Refresh library
            </Button>
          </div>

          {loading || assets === null ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading library…
            </div>
          ) : assets.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No images yet. Upload some under Assets, then come back.
            </p>
          ) : (
            <div className="grid max-h-[60vh] grid-cols-3 gap-3 overflow-y-auto sm:grid-cols-4">
              {assets.map(asset => (
                <button
                  key={asset.id}
                  type="button"
                  // A pending row is an upload that never finalized: there are no
                  // bytes behind the key, so selecting it would render nothing.
                  disabled={asset.pending}
                  title={asset.pending ? `${asset.filename} — upload never finished` : asset.filename}
                  onClick={() => {
                    patch({ assetId: asset.id }, ['url']);
                    setOpen(false);
                  }}
                  className={`group overflow-hidden rounded border text-left transition ${
                    asset.pending
                      ? 'cursor-not-allowed opacity-40'
                      : 'hover:border-primary hover:shadow-sm'
                  } ${ref.assetId === asset.id ? 'border-primary ring-2 ring-primary' : ''}`}
                >
                  <div className="flex aspect-square items-center justify-center bg-muted">
                    {asset.thumbUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- provider-derived URL
                      <img
                        src={asset.thumbUrl}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <ImageIcon className="h-5 w-5 text-muted-foreground" aria-hidden />
                    )}
                  </div>
                  <p className="truncate px-2 py-1 text-[11px] text-muted-foreground">
                    {asset.pending ? 'unfinished · ' : ''}
                    {asset.filename}
                  </p>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
