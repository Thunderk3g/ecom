'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { rebuildSpriteAction, type RebuildSpriteResult } from './actions';

function formatBytes(n: number): string {
  if (n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function RebuildSpriteForm() {
  const [isPending, startTransition] = useTransition();
  const [last, setLast] = useState<RebuildSpriteResult | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      const result = await rebuildSpriteAction();
      setLast(result);
      if (result.ok) {
        toast.success(
          `Sprite rebuilt — ${result.symbols ?? 0} symbol${result.symbols === 1 ? '' : 's'}, ${formatBytes(result.bytes ?? 0)}`,
        );
      } else {
        toast.error(result.error ?? 'Failed to rebuild sprite.');
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Button type="submit" disabled={isPending}>
        {isPending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Rebuilding…
          </>
        ) : (
          'Rebuild SVG sprite'
        )}
      </Button>

      {last?.ok ? (
        <div className="rounded-md border border-border bg-muted/30 p-4 text-sm">
          <div className="font-medium">Sprite rebuilt successfully.</div>
          <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-muted-foreground">
            <dt>URL</dt>
            <dd>
              <a
                href={last.url}
                className="text-primary underline-offset-4 hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                {last.url}
              </a>
            </dd>
            <dt>Symbols</dt>
            <dd>{last.symbols ?? 0}</dd>
            <dt>Size</dt>
            <dd>{formatBytes(last.bytes ?? 0)}</dd>
          </dl>
        </div>
      ) : null}

      {last && !last.ok ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {last.error}
        </div>
      ) : null}
    </form>
  );
}
